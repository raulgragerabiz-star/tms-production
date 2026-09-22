// Fase 25 ("usuarios app" sub-fase 3): gestión desde Backoffice (Maestros >
// Almacenes, "Rutas de este almacén") del QR de ruta -- ver comentario en
// route-qr.service.ts y en el modelo RouteQrToken (schema.prisma). Mismo
// criterio de alcance que el resto de escritura por centro (Fase 23): un
// Planificador solo puede generar el QR de circuitos de SU propio centro; un
// Administrador global, de cualquiera. Sin requireRole -- igual que el QR de
// vehículo (vehicles.routes.ts), no es una acción reservada al Administrador.
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { getWarehouseScope, assertWarehouseWriteAccess } from "@/middleware/warehouse-scope";
import { issueRouteQrToken, findActiveRouteQrToken } from "./route-qr.service";

export const routeQrRouter = Router();

const scopeSchema = z.object({
  warehouseId: z.string().uuid(),
  deliveryZoneId: z.string().uuid(),
  carrierId: z.string().uuid(),
});

// Valida que el centro, el circuito y el transportista existen y son de la
// empresa del usuario -- defensa básica multi-empresa, igual que el resto de
// endpoints que cruzan varias entidades por id.
async function assertScopeBelongsToCompany(companyId: string, scope: z.infer<typeof scopeSchema>) {
  const [warehouse, deliveryZone, carrier] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: scope.warehouseId, companyId } }),
    prisma.deliveryZone.findFirst({ where: { id: scope.deliveryZoneId, companyId } }),
    prisma.carrier.findFirst({ where: { id: scope.carrierId, companyId } }),
  ]);
  if (!warehouse) throw HttpError.notFound("Almacén no encontrado");
  if (!deliveryZone) throw HttpError.notFound("Circuito no encontrado");
  if (!carrier) throw HttpError.notFound("Transportista no encontrado");
  return warehouse;
}

routeQrRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.query);
    await assertScopeBelongsToCompany(req.auth!.companyId, scope);
    const active = await findActiveRouteQrToken(scope);
    res.json({ token: active?.token ?? null });
  })
);

routeQrRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeSchema.parse(req.body);
    const warehouse = await assertScopeBelongsToCompany(req.auth!.companyId, scope);
    assertWarehouseWriteAccess(getWarehouseScope(req), warehouse.id, `el almacén "${warehouse.name}"`);
    const token = await issueRouteQrToken({ companyId: req.auth!.companyId, ...scope });
    res.status(201).json({ token });
  })
);
