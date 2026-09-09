// Motor de inteligencia (2/3): API de pronóstico de demanda -- mismo estilo
// que anomaly.routes.ts (asyncHandler/HttpError/req.auth!).
import { Router } from "express";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { precomputeDemandForecasts } from "./demand-forecast.service";

export const demandForecastRouter = Router();

// GET /api/intelligence/demand-forecast?warehouseId=
// Pronósticos ya calculados (ver POST /run), ordenados por fecha y
// almacén -- pensada para una pantalla "Previsión de demanda" en
// Backoffice.
demandForecastRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const warehouseId = req.query.warehouseId as string | undefined;
    const items = await prisma.demandForecast.findMany({
      where: {
        companyId: req.auth!.companyId,
        forecastDate: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: { warehouse: { select: { id: true, name: true } } },
      orderBy: [{ forecastDate: "asc" }, { province: "asc" }],
      take: 500,
    });
    res.json({ items, total: items.length });
  })
);

// POST /api/intelligence/demand-forecast/run
// Sin job programado todavía (mismo caso que la detección de anomalías,
// pieza 1/3): se dispara a mano con un botón en Backoffice.
demandForecastRouter.post(
  "/run",
  asyncHandler(async (req, res) => {
    const result = await precomputeDemandForecasts(req.auth!.companyId);
    res.json(result);
  })
);
