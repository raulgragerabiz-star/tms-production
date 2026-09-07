import { prisma } from "../lib/prisma";
import { runAnomalyDetection } from "../modules/intelligence/anomaly-detection.service";

export async function runNightlyAnomalyDetection(): Promise<{
  companiesProcessed: number;
  totalAlertsCreated: number;
}> {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });

  let totalAlertsCreated = 0;
  for (const company of companies) {
    const result = await runAnomalyDetection(company.id);
    totalAlertsCreated +=
      result.weightAnomalies + result.settlementAnomalies + result.occupancyAnomalies + result.distanceAnomalies;
  }

  return { companiesProcessed: companies.length, totalAlertsCreated };
}
