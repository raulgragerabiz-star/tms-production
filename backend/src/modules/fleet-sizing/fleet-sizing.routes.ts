// Fase 17: API de "Zonas / Vehículos" -- ver fleet-sizing.service.ts para el
// porqué y el criterio de cálculo. Mismo estilo que demand-forecast.routes.ts
// (asyncHandler/req.auth!), pero se calcula al vuelo en el GET (como
// dashboard.routes.ts /accumulated) en vez de precalcularse con un botón --
// no hace falta job en segundo plano, el volumen de datos es el mismo orden
// que el resto de analítica de esta fase.
import { Router } from "express";
import { asyncHandler } from "@/utils/async-handler";
import { computeFleetSizing } from "./fleet-sizing.service";

export const fleetSizingRouter = Router();

fleetSizingRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const result = await computeFleetSizing(req.auth!.companyId);
    res.json(result);
  })
);
