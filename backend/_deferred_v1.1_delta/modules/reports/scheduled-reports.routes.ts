import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middleware/requireAuth";
import { prisma } from "../../lib/prisma";
import { DIMENSIONS, METRICS } from "../kpi/kpi.service";

const router = Router();

const dimensionKeys = Object.keys(DIMENSIONS) as [string, ...string[]];
const metricKeys = Object.keys(METRICS) as [string, ...string[]];

const ScheduledReportSchema = z.object({
  name: z.string().min(3).max(120),
  metrics: z.array(z.enum(metricKeys)).min(1),
  dimensions: z.array(z.enum(dimensionKeys)).default([]),
  period: z.enum(["day", "week", "month"]).optional(),
  filters: z.record(z.string()).optional(),
  format: z.enum(["csv", "xlsx", "pdf"]),
  cronExpression: z.string().min(9), // validación de sintaxis real la hace cron-parser al primer disparo
  recipientEmails: z.array(z.string().email()).min(1),
});

router.get("/", requireAuth, async (req, res, next) => {
  try {
    const reports = await prisma.scheduledReport.findMany({
      where: { companyId: req.auth!.companyId },
      orderBy: { createdAt: "desc" },
    });
    return res.status(200).json({ reports });
  } catch (err) {
    next(err);
  }
});

router.post("/", requireAuth, async (req, res, next) => {
  try {
    const data = ScheduledReportSchema.parse(req.body);
    const report = await prisma.scheduledReport.create({
      data: {
        companyId: req.auth!.companyId,
        createdBy: req.auth!.userId,
        name: data.name,
        metrics: data.metrics,
        dimensions: data.dimensions,
        period: data.period ?? null,
        filters: data.filters ?? {},
        format: data.format,
        cronExpression: data.cronExpression,
        recipientEmails: data.recipientEmails,
      },
    });
    return res.status(201).json({ report });
  } catch (err) {
    next(err);
  }
});

router.patch("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const ToggleSchema = z.object({ active: z.boolean() });
    const { active } = ToggleSchema.parse(req.body);

    const report = await prisma.scheduledReport.updateMany({
      where: { id, companyId: req.auth!.companyId },
      data: { active },
    });

    if (report.count === 0) return res.status(404).json({ error: "report_not_found" });
    return res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await prisma.scheduledReport.deleteMany({
      where: { id, companyId: req.auth!.companyId },
    });
    if (result.count === 0) return res.status(404).json({ error: "report_not_found" });
    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
