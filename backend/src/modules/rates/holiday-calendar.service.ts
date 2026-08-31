import { prisma } from "../../lib/prisma";

/**
 * Un día es festivo si hay una entrada nacional (province = NULL) O una
 * entrada específica de la provincia consultada, para esa fecha exacta.
 * Documento 10-gestion-tarifas-TMS.md: "festivos (recargo % sobre tarifa
 * base si route_date cae en festivo del calendario configurado)".
 */
export async function isHoliday(
  companyId: string,
  date: Date,
  province: string | null
): Promise<boolean> {
  const dayOnly = new Date(date);
  dayOnly.setHours(0, 0, 0, 0);
  const nextDay = new Date(dayOnly);
  nextDay.setDate(nextDay.getDate() + 1);

  const match = await prisma.holidayCalendar.findFirst({
    where: {
      companyId,
      date: { gte: dayOnly, lt: nextDay },
      OR: [{ province: null }, ...(province ? [{ province }] : [])],
    },
  });

  return match != null;
}
