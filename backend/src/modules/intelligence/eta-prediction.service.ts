import { prisma } from "../../lib/prisma";
import { getOrLoad } from "../../lib/memory-cache";

const FALLBACK_SPEED_KMH = 35; // mismo valor ya usado en tracking.service.ts antes de esta pasada
const MIN_SAMPLE_SIZE_FOR_TRUST = 5; // ya filtrado en el job (HAVING count(*) >= 5), doble check aquí
const CALIBRATION_CACHE_TTL_MS = 30 * 60 * 1000; // 30 min — el job de calibración corre 1 vez/día

export interface SpeedEstimate {
  speedKmh: number;
  source: "historical_calibration" | "fallback_static";
  sampleSize: number | null;
}

/**
 * Documento 16-inteligencia-artificial-TMS.md, "Predicción de ETA": ajusta
 * la estimación estática (Haversine + velocidad fija, ya usada en
 * tracking.service.ts desde la pasada 2) con el histórico real de
 * velocidad de ESE transportista en ESA provincia y a ESA hora del día —
 * un transportista puede ser sistemáticamente más lento en polígonos con
 * mucho tráfico a las 8:00 que a las 11:00, por ejemplo.
 *
 * Si no hay calibración con muestra suficiente (transportista nuevo, zona
 * sin histórico todavía), se degrada de forma segura al valor fijo
 * anterior — nunca se inventa una velocidad sin respaldo de datos reales.
 */
export async function getEstimatedSpeedKmh(
  companyId: string,
  carrierId: string,
  province: string,
  atDate: Date = new Date()
): Promise<SpeedEstimate> {
  const hourBucket = atDate.getHours();
  const cacheKey = `route-speed:${companyId}:${carrierId}:${province}:${hourBucket}`;

  const calibration = await getOrLoad(cacheKey, CALIBRATION_CACHE_TTL_MS, () =>
    prisma.routeSpeedCalibration.findUnique({
      where: {
        companyId_carrierId_province_hourBucket: {
          companyId,
          carrierId,
          province,
          hourBucket,
        } as any,
      },
    })
  );

  if (calibration && calibration.sampleSize >= MIN_SAMPLE_SIZE_FOR_TRUST) {
    return {
      speedKmh: Number(calibration.avgSpeedKmh),
      source: "historical_calibration",
      sampleSize: calibration.sampleSize,
    };
  }

  return { speedKmh: FALLBACK_SPEED_KMH, source: "fallback_static", sampleSize: null };
}
