// Fase 17: API de "Zonas / Vehículos" -- ver fleet-sizing.service.ts para el
// porqué y el criterio de cálculo. Mismo estilo que demand-forecast.routes.ts
// (asyncHandler/req.auth!), pero se calcula al vuelo en el GET (como
// dashboard.routes.ts /accumulated) en vez de precalcularse con un botón --
// no hace falta job en segundo plano, el volumen de datos es el mismo orden
// que el resto de analítica de esta fase.
//
// Fase 19: se añaden aquí, en la misma respuesta (una sola llamada de red
// para el frontend, calculadas en paralelo), "criterio de asignación por
// distancia" y "dispersión geográfica de las rutas actuales" -- ver
// fleet-sizing-distance.service.ts. Aditivo: el resultado de
// computeFleetSizing no cambia de forma, solo se le añaden más campos.
//
// Fase 22: `?warehouseId=` (opcional, query string) filtra toda la
// respuesta por centro de origen -- petición explícita de Raúl, ver el
// comentario en fleet-sizing.service.ts / fleet-sizing-distance.service.ts
// para el porqué exacto de cómo se filtra cada bloque.
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "@/utils/async-handler";
import { computeFleetSizing } from "./fleet-sizing.service";
import { computeDistanceAnalytics } from "./fleet-sizing-distance.service";

export const fleetSizingRouter = Router();

const querySchema = z.object({ warehouseId: z.string().uuid().optional() });

fleetSizingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { warehouseId } = querySchema.parse(req.query);
    const [fleetSizing, distanceAnalytics] = await Promise.all([
      computeFleetSizing(req.auth!.companyId, warehouseId),
      computeDistanceAnalytics(req.auth!.companyId, warehouseId),
    ]);
    res.json({ ...fleetSizing, ...distanceAnalytics });
  })
);
