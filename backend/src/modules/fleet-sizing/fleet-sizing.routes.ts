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
import { Router } from "express";
import { asyncHandler } from "@/utils/async-handler";
import { computeFleetSizing } from "./fleet-sizing.service";
import { computeDistanceAnalytics } from "./fleet-sizing-distance.service";

export const fleetSizingRouter = Router();

fleetSizingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const [fleetSizing, distanceAnalytics] = await Promise.all([
      computeFleetSizing(req.auth!.companyId),
      computeDistanceAnalytics(req.auth!.companyId),
    ]);
    res.json({ ...fleetSizing, ...distanceAnalytics });
  })
);
