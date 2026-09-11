import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { computeLineWeightKg } from "./lib/line-weight";
import { classifyOrder } from "@/modules/segmentation/segmentation.service";
import { buildOrdersImportTemplate, startOrdersExcelImportJob } from "./orders-excel-import.service";
import { getImportJob } from "./lib/import-jobs.store";
import { renderDeliveryNotePdf, signDocumentToken } from "@/modules/documents/document-pdf.service";

export const ordersRouter = Router();

const orderLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().positive(),
  unit: z.string().min(1), // "UD" | "PAL" (palés completos) | otros
});

const orderSchema = z.object({
  orderNumber: z.string().min(1),
  customerId: z.string().uuid(),
  deliveryPointId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  priority: z.enum(["standard", "urgent"]).optional(),
  requestedDeliveryDate: z.coerce.date(),
  deliveryTimeWindowFrom: z.string().optional(),
  deliveryTimeWindowTo: z.string().optional(),
  notes: z.string().optional(),
  // Los 4 segmentos reales (columna `service_type`, ver ServiceType en el schema
  // de Prisma) — antes aceptaba "full_truck"/"pallet", 2 valores heredados que ya
  // no existen en el enum de la base de datos y hacían fallar cualquier alta con
  // ese campo relleno. Si se omite, el pedido se clasifica automáticamente por
  // peso/palés al crearlo (mismo motor que usa el bridge de importación ERP).
  serviceType: z.enum(["paqueteria", "paleteria", "paleteria_pesada", "gran_volumen"]).optional(),
  // Fase 8Q: necesidad de equipamiento especial en el vehículo para esta
  // entrega (grúa/plataforma elevadora) -- ver comentario en
  // Order.requiresCrane/requiresLiftgate en schema.prisma. Se usan como
  // restricción real en el motor de compatibilidad (optimization.routes.ts).
  requiresCrane: z.boolean().optional(),
  requiresLiftgate: z.boolean().optional(),
  lines: z.array(orderLineSchema).min(1),
});

ordersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    // Fase 8O: buscador por nº de pedido, aparte del desplegable de estados
    // ya existente -- antes solo se podía filtrar por estado o recorrer
    // páginas a mano para encontrar un pedido concreto.
    const orderNumber = (req.query.orderNumber as string | undefined)?.trim();
    const page = parseInt((req.query.page as string) ?? "1", 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "25", 10), 100);

    const where = {
      companyId: req.auth!.companyId,
      ...(status ? { status: status as any } : {}),
      ...(orderNumber ? { orderNumber: { contains: orderNumber, mode: "insensitive" as const } } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { requestedDeliveryDate: "asc" },
        include: {
          customer: { select: { businessCode: true, legalName: true } },
          deliveryPoint: { select: { id: true, address: true, city: true, lat: true, lng: true } },
          warehouse: { select: { id: true, name: true, lat: true, lng: true } },
          lines: true,
        },
      }),
      prisma.order.count({ where }),
    ]);

    const withTotals = items.map((o) => ({
      ...o,
      totalWeightKg: o.lines.reduce((acc, l) => acc + Number(l.lineWeightKg ?? 0), 0),
    }));

    res.json({ items: withTotals, total, page, pageSize });
  })
);

// Carga de pedidos por Excel (instrucciones ampliadas: "Recepción de pedidos
// desde cualquier origen -- ERP, API o carga manual"). Montadas ANTES de
// GET "/:id" porque si no, Express interpretaría "import" y "import/template"
// como un :id literal y nunca llegarían aquí.
//
// El archivo se manda en base64 dentro del JSON (en vez de multipart/multer)
// para no añadir una dependencia nueva solo para subir un fichero -- el
// límite de tamaño del body (ver app.ts) ya se subió para admitirlo.
ordersRouter.get(
  "/import/template",
  asyncHandler(async (_req, res) => {
    const buffer = buildOrdersImportTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla-carga-pedidos.xlsx"');
    res.send(buffer);
  })
);

const importOrdersSchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
});

// Responde de inmediato con un identificador de trabajo -- el procesamiento
// real ocurre en segundo plano (ver startOrdersExcelImportJob) porque un
// lote grande puede tardar varios minutos, y esperar aquí a que termine dejó
// la petición HTTP colgada hasta que el proxy la cortaba con un error de red.
ordersRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { fileBase64 } = importOrdersSchema.parse(req.body);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, "base64");
    } catch {
      throw HttpError.badRequest("El archivo no es un base64 válido");
    }
    if (buffer.length === 0) throw HttpError.badRequest("El archivo está vacío");

    const { importId, totalOrders } = startOrdersExcelImportJob(req.auth!.companyId, buffer);
    res.json({ importId, totalOrders });
  })
);

// El frontend consulta esto cada poco tiempo mientras el job está
// "processing" (ver ImportOrdersModal.tsx) para mostrar el progreso y, al
// terminar, el mismo resumen que antes devolvía el POST directamente.
ordersRouter.get(
  "/import/:importId/status",
  asyncHandler(async (req, res) => {
    const job = getImportJob(req.params.importId);
    if (!job) throw HttpError.notFound("No se encuentra esa importación (puede que el servidor se haya reiniciado)");
    res.json({
      status: job.status,
      totalOrders: job.totalOrders,
      processedOrders: job.processedOrders,
      summary: job.status === "done" ? job.summary : undefined,
      error: job.status === "error" ? job.error : undefined,
    });
  })
);

// "Ficha única del pedido" (instrucciones del proyecto ampliadas): reúne en
// una sola respuesta todo lo que hasta ahora estaba disperso o sin usar --
// documentos (ya venían en el include pero el frontend no los pintaba),
// incidencias de sus paradas (antes no se pedían aquí en absoluto), y una
// trazabilidad completa combinando los eventos de seguimiento reales (llegada
// a parada, cambios de estado del envío -- se excluye el gps_ping suelto,
// demasiado granular para una ficha legible) de todos los envíos por los que
// ha pasado el pedido. Todo aditivo: ningún campo que ya se devolvía cambia
// de forma ni de nombre.
ordersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        customer: true,
        deliveryPoint: true,
        warehouse: true,
        lines: { include: { product: true } },
        documents: true,
        routeStops: {
          include: {
            route: {
              include: {
                warehouse: { select: { name: true } },
                carrier: { select: { legalName: true } },
                vehicle: { select: { plate: true } },
                shipment: { select: { id: true, status: true, departedAt: true, finishedAt: true } },
              },
            },
            pod: true,
            incidents: true,
          },
        },
        // Fase 8O: la valoración de satisfacción que el cliente deja desde
        // el portal (Portal Cliente / seguimiento público) ya se guarda
        // desde hace tiempo (DeliveryFeedback), pero esta ficha nunca la
        // pedía -- así que en el Backoffice se veía todo el resto de la
        // ficha (documentos, incidencias, trazabilidad, justificante) menos
        // la valoración del cliente. Aditivo: no cambia nada de lo ya
        // devuelto.
        deliveryFeedback: true,
      },
    });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const shipmentIds = order.routeStops
      .map((s) => s.route.shipment?.id)
      .filter((id): id is string => !!id);

    const timeline =
      shipmentIds.length > 0
        ? await prisma.trackingEvent.findMany({
            where: { shipmentId: { in: shipmentIds }, eventType: { not: "gps_ping" } },
            orderBy: { occurredAt: "asc" },
          })
        : [];

    res.json({ ...order, timeline });
  })
);

// Fase 8Q2: albarán de entrega en PDF -- petición explícita de Raúl
// ("documentación real asociada a los pedidos"), tercer punto que había
// quedado aplazado del backlog de "Ficha única del pedido". Usa el mismo
// `DocumentType.delivery_note` que ya existía en el schema sin generador
// ninguno. `?download=1` fuerza la descarga; sin él, el PDF se sirve
// "inline" para que el navegador (Backoffice o el móvil del conductor) lo
// muestre directamente en pantalla -- cubre a la vez las dos formas de
// acceso que pidió Raúl (PDF descargable + pantalla) con un único endpoint.
ordersRouter.get(
  "/:id/documents/delivery-note.pdf",
  asyncHandler(async (req, res) => {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        customer: { select: { legalName: true, taxId: true } },
        deliveryPoint: true,
        warehouse: true,
        lines: { include: { product: { select: { sku: true, description: true, ean: true } } } },
        routeStops: { include: { pod: true }, orderBy: { id: "desc" } },
      },
    });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const company = await prisma.company.findUniqueOrThrow({ where: { id: req.auth!.companyId } });
    const pod = order.routeStops.find((s) => s.pod)?.pod ?? null;

    const token = signDocumentToken({ typ: "delivery_note", id: order.id });
    const verifyUrl = `${req.protocol}://${req.get("host")}/api/documents/public/delivery-note/${order.id}?token=${token}`;

    const pdf = await renderDeliveryNotePdf(
      { ...order, pod: pod ? { signatureUrl: pod.signatureUrl, receivedByName: pod.receivedByName, deliveredAt: pod.deliveredAt } : null },
      company,
      verifyUrl
    );

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `${req.query.download ? "attachment" : "inline"}; filename="albaran-${order.orderNumber}.pdf"`
    );
    res.send(pdf);
  })
);

ordersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = orderSchema.parse(req.body);

    const [customer, deliveryPoint, warehouse] = await Promise.all([
      prisma.customer.findFirst({ where: { id: data.customerId, companyId: req.auth!.companyId } }),
      prisma.deliveryPoint.findFirst({ where: { id: data.deliveryPointId, customerId: data.customerId } }),
      prisma.warehouse.findFirst({ where: { id: data.warehouseId, companyId: req.auth!.companyId } }),
    ]);
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    if (!deliveryPoint) throw HttpError.notFound("Punto de entrega no válido para este cliente");
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const productIds = data.lines.map((l) => l.productId);
    const products = await prisma.product.findMany({ where: { id: { in: productIds }, companyId: req.auth!.companyId } });
    if (products.length !== new Set(productIds).size) {
      throw HttpError.badRequest("Uno o más productos de las líneas no existen en el catálogo");
    }
    const productMap = new Map(products.map((p) => [p.id, p]));

    const order = await prisma.order.create({
      data: {
        companyId: req.auth!.companyId,
        orderNumber: data.orderNumber,
        customerId: data.customerId,
        deliveryPointId: data.deliveryPointId,
        warehouseId: data.warehouseId,
        priority: data.priority ?? "standard",
        requestedDeliveryDate: data.requestedDeliveryDate,
        deliveryTimeWindowFrom: data.deliveryTimeWindowFrom,
        deliveryTimeWindowTo: data.deliveryTimeWindowTo,
        notes: data.notes,
        serviceType: data.serviceType,
        // Fase 8Q: `as any` a nivel del objeto `data` completo (más abajo) --
        // requiresCrane/requiresLiftgate todavía no están en el Prisma
        // Client de este sandbox (sin red para regenerarlo).
        requiresCrane: data.requiresCrane ?? false,
        requiresLiftgate: data.requiresLiftgate ?? false,
        status: "validated",
        lines: {
          create: data.lines.map((l) => {
            const product = productMap.get(l.productId)!;
            return {
              productId: l.productId,
              quantity: l.quantity,
              unit: l.unit,
              lineWeightKg: computeLineWeightKg(l.unit, l.quantity, {
                grossWeightKg: product.grossWeightKg == null ? null : Number(product.grossWeightKg),
                fullPalletWeightKg: product.fullPalletWeightKg == null ? null : Number(product.fullPalletWeightKg),
              }),
            };
          }),
        },
      } as any,
      include: { lines: true },
    });

    // Si el planificador no fijó un tipo de servicio explícito, se clasifica
    // automáticamente por peso/palés — mismo motor que usa el bridge de
    // importación del ERP, para que un pedido manual y uno importado se
    // traten igual en vez de depender de que la persona adivine el segmento.
    if (!data.serviceType) {
      await prisma.$transaction((tx) => classifyOrder(tx, req.auth!.companyId, order.id));
    }

    const finalOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
    res.status(201).json(finalOrder);
  })
);

const statusTransitions: Record<string, string[]> = {
  received: ["validated", "cancelled"],
  validated: ["planned", "cancelled"],
  planned: ["loading", "cancelled"],
  loading: ["dispatched"],
  dispatched: ["in_transit"],
  in_transit: ["delivered", "incident"],
  incident: ["in_transit", "delivered"],
  delivered: [],
  cancelled: [],
};

ordersRouter.patch(
  "/:id/status",
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(Object.keys(statusTransitions) as [string, ...string[]]) });
    const { status } = schema.parse(req.body);

    const order = await prisma.order.findFirst({ where: { id: req.params.id, companyId: req.auth!.companyId } });
    if (!order) throw HttpError.notFound("Pedido no encontrado");

    const allowed = statusTransitions[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw HttpError.badRequest(`Transición no permitida: ${order.status} -> ${status}`);
    }

    const updated = await prisma.order.update({ where: { id: order.id }, data: { status: status as any } });
    res.json(updated);
  })
);
