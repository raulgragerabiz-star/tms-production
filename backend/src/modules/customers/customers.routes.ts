import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireRole } from "@/middleware/auth";
import { buildCustomerMasterTemplate, runCustomerMasterImport } from "./customer-master-import.service";
import { deleteCustomerCascade } from "./customer-delete.service";
import { upsertDefaultDeliveryPoint } from "./customer-default-address.service";

export const customersRouter = Router();

const customerSchema = z.object({
  businessCode: z.string().min(1).max(10),
  legalName: z.string().min(1),
  commercialName: z.string().optional(),
  taxId: z.string().optional(),
  active: z.boolean().optional(),
  // Fase 8: circuito de reparto (ver DeliveryZone) -- opcional, se puede
  // reasignar en cualquier momento sin afectar a nada más de la ficha.
  deliveryZoneId: z.string().uuid().optional().nullable(),
  // Fase 16: dirección de entrega por defecto -- petición explícita de Raúl
  // para poder indicarla a mano desde el alta/edición manual (hasta ahora
  // solo se podía cargar importando el maestro de clientes en Excel). Se usa
  // para geolocalizar al cliente de cara al mapa de Inicio (ver
  // customer-default-address.service.ts) y como dirección de pedido por
  // defecto cuando un pedido no trae la suya propia.
  defaultAddress: z.string().optional(),
  defaultCity: z.string().optional(),
  defaultProvince: z.string().optional(),
  defaultPostalCode: z.string().optional(),
});

// Carga del maestro de clientes/socios (Código, Nombre, Dirección completa)
// -- ver customer-master-import.service.ts. Montadas ANTES de GET "/:id" por
// el mismo motivo que en orders.routes.ts: si no, Express interpretaría
// "import" y "import/template" como un :id literal.
//
// El archivo se manda en base64 dentro del JSON, igual que en la
// importación de pedidos, para no añadir multer solo para esto (el límite
// del body ya está subido a 15mb en app.ts).
customersRouter.get(
  "/import/template",
  asyncHandler(async (_req, res) => {
    const buffer = buildCustomerMasterTemplate();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="plantilla-maestro-clientes.xlsx"');
    res.send(buffer);
  })
);

const importCustomersSchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
});

// A diferencia de /api/orders/import, este responde directamente con el
// resumen (sin job en segundo plano): el maestro de clientes tiene como
// mucho un puñado de miles de filas (una por cliente, no una por línea de
// pedido), muchísimo menos que un lote de pedidos, así que no hay riesgo de
// repetir el error de red por timeout que sí tenía la importación de
// pedidos con archivos grandes.
customersRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    const { fileBase64 } = importCustomersSchema.parse(req.body);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, "base64");
    } catch {
      throw HttpError.badRequest("El archivo no es un base64 válido");
    }
    if (buffer.length === 0) throw HttpError.badRequest("El archivo está vacío");

    const summary = await runCustomerMasterImport(req.auth!.companyId, buffer);
    res.json(summary);
  })
);

// GET /api/customers?search=&page=&pageSize=
customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const search = (req.query.search as string) ?? "";
    // Mejora (2026-09-14): filtro por circuito de reparto (DeliveryZone) --
    // petición explícita de Raúl para poder ver/segmentar qué clientes
    // pertenecen a cada ruta (MAD1, Portu 4...). "sin-circuito" es un valor
    // especial para encontrar los clientes todavía sin asignar.
    const deliveryZoneId = req.query.deliveryZoneId as string | undefined;
    const page = parseInt((req.query.page as string) ?? "1", 10);
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "25", 10), 100);

    const where = {
      companyId,
      deletedAt: null,
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: "insensitive" as const } },
              { businessCode: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
      ...(deliveryZoneId === "sin-circuito"
        ? { deliveryZoneId: null }
        : deliveryZoneId
          ? { deliveryZoneId }
          : {}),
    };

    const [items, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { legalName: "asc" },
        include: {
          _count: { select: { deliveryPoints: true } },
          deliveryZone: { select: { id: true, name: true } },
        },
      }),
      prisma.customer.count({ where }),
    ]);

    res.json({ items, total, page, pageSize });
  })
);

customersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId, deletedAt: null },
      include: { deliveryPoints: { where: { deletedAt: null } } },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");
    res.json(customer);
  })
);

customersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = customerSchema.parse(req.body);
    const existing = await prisma.customer.findFirst({
      where: { companyId: req.auth!.companyId, businessCode: data.businessCode },
    });
    if (existing) throw HttpError.conflict("Ya existe un cliente con ese código de negocio");

    const customer = await prisma.customer.create({
      data: { ...data, companyId: req.auth!.companyId },
    });

    // Fase 16: si se ha indicado dirección desde el propio alta manual, se
    // crea (y se geocodifica en el momento, best-effort) su punto de entrega
    // por defecto -- sin esto, un cliente dado de alta a mano nunca aparecía
    // en el mapa de Inicio aunque se le hubiera puesto dirección y CP.
    if (data.defaultAddress) {
      await upsertDefaultDeliveryPoint(customer.id, {
        address: data.defaultAddress,
        postalCode: data.defaultPostalCode,
        city: data.defaultCity,
        province: data.defaultProvince,
      });
    }
    res.status(201).json(customer);
  })
);

customersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = customerSchema.partial().parse(req.body);
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const updated = await prisma.customer.update({ where: { id: customer.id }, data });

    // Fase 16: mismo criterio que en el alta -- si el formulario de edición
    // manda dirección (el modal siempre manda los 4 campos juntos, aunque no
    // se hayan tocado), se actualiza/crea y se geocodifica el punto de
    // entrega por defecto del cliente.
    if (data.defaultAddress !== undefined) {
      await upsertDefaultDeliveryPoint(customer.id, {
        address: data.defaultAddress,
        postalCode: data.defaultPostalCode,
        city: data.defaultCity,
        province: data.defaultProvince,
      });
    }
    res.json(updated);
  })
);

// Fase 15: circuito de reparto por almacén -- petición explícita de Raúl
// ("al seleccionar el almacén de salida, si cambiara el almacén pero en otro
// también tiene entregas ese cliente, figurará otra ruta distinta"). Ver el
// comentario largo en el modelo CustomerDeliveryZone (schema.prisma) y en
// customer-zone-resolution.ts. `deliveryZoneId` de la ficha del cliente
// sigue siendo el circuito POR DEFECTO -- estas filas son solo las
// excepciones "para el almacén X, este cliente usa este otro circuito".
customersRouter.get(
  "/:id/delivery-zones",
  asyncHandler(async (req, res) => {
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId, deletedAt: null },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const items = await prisma.customerDeliveryZone.findMany({
      where: { customerId: customer.id },
      include: {
        warehouse: { select: { id: true, name: true } },
        deliveryZone: { select: { id: true, name: true } },
      },
      orderBy: { warehouse: { name: "asc" } },
    });
    res.json({ items });
  })
);

const zoneOverrideSchema = z.object({ deliveryZoneId: z.string().uuid().nullable() });

customersRouter.put(
  "/:id/delivery-zones/:warehouseId",
  asyncHandler(async (req, res) => {
    const companyId = req.auth!.companyId;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.id, companyId, deletedAt: null },
    });
    if (!customer) throw HttpError.notFound("Cliente no encontrado");

    const warehouse = await prisma.warehouse.findFirst({
      where: { id: req.params.warehouseId, companyId },
    });
    if (!warehouse) throw HttpError.notFound("Almacén no encontrado");

    const { deliveryZoneId } = zoneOverrideSchema.parse(req.body);

    // deliveryZoneId = null -> se quita la excepción para este almacén: el
    // cliente vuelve a usar su circuito por defecto ahí.
    if (!deliveryZoneId) {
      await prisma.customerDeliveryZone.deleteMany({
        where: { customerId: customer.id, warehouseId: warehouse.id },
      });
      res.status(204).send();
      return;
    }

    const zone = await prisma.deliveryZone.findFirst({ where: { id: deliveryZoneId, companyId } });
    if (!zone) throw HttpError.notFound("Circuito no encontrado");

    const saved = await prisma.customerDeliveryZone.upsert({
      where: { customerId_warehouseId: { customerId: customer.id, warehouseId: warehouse.id } },
      create: { customerId: customer.id, warehouseId: warehouse.id, deliveryZoneId: zone.id },
      update: { deliveryZoneId: zone.id },
      include: {
        warehouse: { select: { id: true, name: true } },
        deliveryZone: { select: { id: true, name: true } },
      },
    });
    res.json(saved);
  })
);

// Fase 11: petición explícita de Raúl -- "quiero poder borrar cualquier dato
// desde el perfil de administrador, incluidos datos que contengan
// histórico". Sustituye la baja lógica anterior por un borrado en cascada
// total (ver customer-delete.service.ts): sus pedidos, direcciones de
// entrega, tarifas, facturas y devoluciones desaparecen con él. Solo admin:
// es irreversible.
customersRouter.delete(
  "/:id",
  requireRole("admin_empresa", "admin_plataforma"),
  asyncHandler(async (req, res) => {
    const summary = await deleteCustomerCascade(req.params.id, req.auth!.companyId);
    res.json(summary);
  })
);
