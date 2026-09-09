// Motor de inteligencia (1/3): API de alertas de anomalías -- adaptado de
// `_deferred_v1.1_delta/modules/intelligence/anomaly.routes.ts` al estilo
// del resto de routers ya en producción (asyncHandler/HttpError/req.auth!,
// en vez de try/catch + next manual).
import { Router } from "express";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { asyncHandler } from "@/utils/async-handler";
import { HttpError } from "@/utils/http-error";
import { runAnomalyDetection } from "./anomaly-detection.service";

export const anomalyRouter = Router();

// GET /api/intelligence/anomalies?status=pending
// Lista ordenada por más reciente, pensada para una pantalla de "Alertas"
// en Backoffice (o una futura zona "Atención" en el Dashboard, junto a las
// incidencias operativas ya existentes).
anomalyRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const status = req.query.status as string | undefined;
    const alerts = await prisma.anomalyAlert.findMany({
      where: { companyId: req.auth!.companyId, ...(status ? { status: status as any } : {}) },
      orderBy: { detectedAt: "desc" },
      take: 200,
    });
    res.json({ alerts });
  })
);

// POST /api/intelligence/anomalies/run
// Todavía no hay ningún job/cron corriendo en el backend (el
// `scheduler.ts` del delta v1.1 tampoco llegó a integrarse) -- de momento
// la detección se dispara a mano desde un botón en Backoffice. Cuando haya
// infraestructura de jobs programados se puede llamar a lo mismo
// (`runAnomalyDetection`) desde ahí sin tocar esta lógica.
anomalyRouter.post(
  "/run",
  asyncHandler(async (req, res) => {
    const result = await runAnomalyDetection(req.auth!.companyId);
    res.json(result);
  })
);

const reviewSchema = z.object({ status: z.enum(["reviewed", "dismissed"]) });

// PATCH /api/intelligence/anomalies/:id -- el planificador/gestor de flota
// marca la alerta como revisada o la descarta (falso positivo). Nunca
// corrige datos automáticamente (principio del documento de origen).
anomalyRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const { status } = reviewSchema.parse(req.body);

    const result = await prisma.anomalyAlert.updateMany({
      where: { id: req.params.id, companyId: req.auth!.companyId },
      data: { status, reviewedBy: req.auth!.sub, reviewedAt: new Date() },
    });

    if (result.count === 0) throw HttpError.notFound("Alerta no encontrada");
    res.status(204).send();
  })
);
