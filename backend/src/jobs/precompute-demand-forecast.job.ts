import { prisma } from "../lib/prisma";
import { precomputeDemandForecasts } from "../modules/intelligence/demand-forecast.service";

export async function runDemandForecastPrecomputation(): Promise<{
  companiesProcessed: number;
  totalForecastsWritten: number;
}> {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });

  let totalForecastsWritten = 0;
  for (const company of companies) {
    const result = await precomputeDemandForecasts(company.id);
    totalForecastsWritten += result.forecastsWritten;
  }

  return { companiesProcessed: companies.length, totalForecastsWritten };
}
