import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { requireRole } from "@/middleware/auth";
import { deleteCarrierCascade } from "./carrier-delete.service";

export const carriersRouter = Router();

const carrierSchema = z.object({
  legalName: z.string().min(1),
  taxId: z.string().min(1),
  city: z.string().optional(),
  province: z.string().optional(),
  // Fase 8X: datos completos del transportista para el DeCA -- ver
  // comentario en el modelo Carrier (schema.prisma).
  address: z.string().optional(),
  postalCode: z.string().optional(),
  phone: z.string().optional(),
  serviceType: z.enum(["full_truck", "pallet", "both"]).optional(),
  ownsFleet: z.boolean().optional(),
  temperatureCapability: z.enum(["ambient", "refrigerated", "frozen", "mixed"]).optional(),
  notes: z.string().optional(),
  // Fase 8k: jornada laboral máxima (horas) admitida para los conductores de
  // este transportista -- ver comentario en el modelo Carrier (schema.prisma).
  maxRouteDurationHours: z.number().positive().max(24).optional(),
});

// Fase 8: se incluye qué tipos de vehículo declara poder aportar cada
// transportista (checkboxes de la pestaña "Transportistas" de "Flota y
// Transportistas") -- aditivo, el resto de la respuesta no cambia.
const carrierListInclude = {
  _count: { select: { vehicles: true } },
  vehicleTypeOfferings: { select: { vehicleType: { select: { id: true, name: true } } } },
} as const;

carriersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const items = await prisma.carrier.findMany({
      where: { companyId: req.auth!.companyId, deletedAt: null },
      orderBy: { legalName: "asc" },
      include: carrierListInclude,
    });
    res.json({ items, total: items.length });
  })
);

carriersRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      include: {
        vehicles: { include: { vehicleType: true } },
        fullTruckRates: { orderBy: { validFrom: "desc" } },
        palletRates: { orderBy: { validFrom: "desc" } },
      },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    res.json(carrier);
  })
);

carriersRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = carrierSchema.parse(req.body);
    // Fase 18 (corrección): `taxId` es único en toda la base de datos
    // (`@unique` en schema.prisma), pero hasta ahora no se comprobaba antes
    // de crear -- un NIF repetido (typo, o un alta anterior que sí llegó a
    // completarse) reventaba con un error de restricción de Prisma sin
    // capturar (P2002), que el usuario solo veía como "Error interno del
    // servidor" sin ninguna pista de qué había pasado. Mismo criterio que ya
    // se usa en delivery-zones.routes.ts para el nombre de circuito
    // duplicado: comprobarlo antes y devolver un 409 con mensaje claro.
    //
    // Fase 18 (corrección 2): la comprobación (y el propio índice único de
    // la BD) no distinguía transportistas dados de baja bajo la lógica
    // antigua (Fase 7b: deletedAt+active:false, anterior a la Fase 11, que
    // pasó a borrado físico en cascada). Un transportista así queda invisible
    // en el listado (que sí filtra deletedAt: null) pero seguía bloqueando el
    // alta de cualquier NIF que ya hubiera usado -- de ahí el caso real:
    // "no hay ningún Diego Hernández que borrar" y aun así "ya existe". Se
    // excluyen aquí los ya dados de baja; el NIF de un transportista borrado
    // no debe impedir crear uno nuevo con ese mismo NIF.
    const existing = await prisma.carrier.findFirst({ where: { taxId: data.taxId, deletedAt: null } });
    if (existing) {
      throw HttpError.conflict(
        existing.companyId === req.auth!.companyId
          ? `Ya existe un transportista con el NIF/CIF "${data.taxId}" (${existing.legalName}). Edítalo en vez de crear uno nuevo, o revisa si es un error de escritura.`
          : `Ya existe un transportista con el NIF/CIF "${data.taxId}" en el sistema.`
      );
    }
    // Fase 18 (corrección 2, red de seguridad): además de la comprobación de
    // arriba, se captura aquí un P2002 que se escape igualmente (p.ej. un
    // transportista dado de baja bajo la lógica antigua que aún ocupe ese
    // NIF a nivel de base de datos, o una condición de carrera) para no
    // volver a mostrar "Error interno del servidor" sin explicación.
    try {
      const carrier = await prisma.carrier.create({ data: { ...data, companyId: req.auth!.companyId } });
      res.status(201).json(carrier);
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        throw HttpError.conflict(
          `Ya existe un transportista con el NIF/CIF "${data.taxId}" en el sistema (puede estar dado de baja). Contacta con soporte si crees que es un error.`
        );
      }
      throw err;
    }
  })
);

carriersRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = carrierSchema.partial().parse(req.body);
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    // Fase 18 (corrección): mismo caso que en el alta -- si se edita el NIF
    // y choca con el de otro transportista ya existente, dar un mensaje
    // claro en vez de un 500 genérico. Fase 18 (corrección 2): igual que en
    // el POST, se excluyen los ya dados de baja (ver comentario allí).
    if (data.taxId && data.taxId !== carrier.taxId) {
      const clash = await prisma.carrier.findFirst({
        where: { taxId: data.taxId, id: { not: carrier.id }, deletedAt: null },
      });
      if (clash) throw HttpError.conflict(`Ya existe otro transportista con el NIF/CIF "${data.taxId}" (${clash.legalName}).`);
    }
    try {
      const updated = await prisma.carrier.update({ where: { id: carrier.id }, data });
      res.json(updated);
    } catch (err) {
      if ((err as { code?: string })?.code === "P2002") {
        throw HttpError.conflict(
          `Ya existe otro transportista con el NIF/CIF "${data.taxId}" en el sistema (puede estar dado de baja).`
        );
      }
      throw err;
    }
  })
);

// Fase 11: petición explícita de Raúl -- "quiero poder borrar cualquier dato
// desde el perfil de administrador, incluidos datos que contengan
// histórico". Sustituye la baja lógica de la Fase 7b (deletedAt+active:false)
// por un borrado en cascada total (ver carrier-delete.service.ts): vehículos,
// conductores, envíos, liquidaciones y tarifas de este transportista
// desaparecen con él; sus rutas se conservan, solo se desvinculan. Solo
// admin: es irreversible.
carriersRouter.delete(
  "/:id",
  requireRole("admin_empresa"),
  asyncHandler(async (req, res) => {
    const summary = await deleteCarrierCascade(req.params.id, req.auth!.companyId);
    res.json(summary);
  })
);

// Fase 8: checkboxes de tipo de vehículo en la fila del transportista dentro
// de la nueva pestaña "Transportistas" -- "seleccionar simplemente en la
// línea el tipo de vehículo que tiene". No sustituye a Vehicle (matrículas
// reales); es la capacidad declarada del transportista.
carriersRouter.post(
  "/:id/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");
    const vehicleType = await prisma.vehicleType.findUnique({ where: { id: req.params.vehicleTypeId } });
    if (!vehicleType) throw HttpError.notFound("Tipo de vehículo no encontrado");

    await prisma.carrierVehicleType.upsert({
      where: { carrierId_vehicleTypeId: { carrierId: carrier.id, vehicleTypeId: vehicleType.id } },
      update: {},
      create: { carrierId: carrier.id, vehicleTypeId: vehicleType.id },
    });
    res.status(201).json({ ok: true });
  })
);

carriersRouter.delete(
  "/:id/vehicle-types/:vehicleTypeId",
  asyncHandler(async (req, res) => {
    const carrier = await prisma.carrier.findFirst({
      where: { id: req.params.id, companyId: req.auth!.companyId },
    });
    if (!carrier) throw HttpError.notFound("Transportista no encontrado");

    await prisma.carrierVehicleType.deleteMany({
      where: { carrierId: carrier.id, vehicleTypeId: req.params.vehicleTypeId },
    });
    res.status(204).send();
  })
);
