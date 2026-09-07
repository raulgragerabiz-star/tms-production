import { prisma } from "../lib/prisma";

/**
 * Documento 16-inteligencia-artificial-TMS.md, "Predicción de ETA": "modelo
 * que combina distancia/tiempo teórico de ruta con histórico real de
 * tracking_event por transportista/zona/franja horaria". Este job calcula
 * ese histórico; eta-prediction.service.ts lo consume en tiempo de
 * consulta.
 *
 * Cálculo: para cada par de tracking_event consecutivos (mismo shipment,
 * tipo gps_ping) se obtiene distancia (Haversine) y tiempo transcurrido;
 * velocidad = distancia/tiempo. Se agrupa por transportista + provincia
 * del almacén de origen + hora local de captura, y se promedia — LAG()
 * hace el cálculo de "punto anterior" sin traer todo a memoria de Node.
 *
 * Se descartan tramos con velocidad implausible (< 2 km/h = prácticamente
 * parado, no aporta señal de velocidad de tránsito; > 130 km/h = error de
 * GPS o salto de posición, no una velocidad real de reparto urbano/
 * carretera secundaria que es el contexto de este negocio).
 */
export async function calibrateRouteSpeeds(): Promise<{ upserts: number; companiesProcessed: number }> {
  const companies = await prisma.company.findMany({ where: { active: true }, select: { id: true } });
  let totalUpserts = 0;

  for (const company of companies) {
    const rows = await prisma.$queryRaw<
      { carrier_id: string; province: string; hour_bucket: number; avg_speed_kmh: number; sample_size: bigint }[]
    >`
      WITH ordered_events AS (
        SELECT
          te.shipment_id,
          te.lat,
          te.lng,
          te.occurred_at,
          LAG(te.lat) OVER w AS prev_lat,
          LAG(te.lng) OVER w AS prev_lng,
          LAG(te.occurred_at) OVER w AS prev_occurred_at,
          s.carrier_id,
          r.warehouse_id
        FROM tracking_event te
        JOIN shipment s ON s.id = te.shipment_id
        JOIN route r ON r.id = s.route_id
        WHERE te.event_type = 'gps_ping'
          AND r.company_id = ${company.id}
          AND te.occurred_at >= now() - interval '30 days'
        WINDOW w AS (PARTITION BY te.shipment_id ORDER BY te.occurred_at)
      ),
      segments AS (
        SELECT
          carrier_id,
          w.province,
          EXTRACT(HOUR FROM occurred_at)::int AS hour_bucket,
          -- Haversine en SQL (mismo radio 6371km usado en el código TS)
          2 * 6371 * asin(least(1, sqrt(
            sin(radians(lat - prev_lat) / 2) ^ 2 +
            cos(radians(prev_lat)) * cos(radians(lat)) *
            sin(radians(lng - prev_lng) / 2) ^ 2
          ))) AS distance_km,
          EXTRACT(EPOCH FROM (occurred_at - prev_occurred_at)) / 3600.0 AS hours_elapsed
        FROM ordered_events oe
        JOIN warehouse w ON w.id = oe.warehouse_id
        WHERE prev_lat IS NOT NULL
      )
      SELECT
        carrier_id,
        province,
        hour_bucket,
        avg(distance_km / NULLIF(hours_elapsed, 0)) AS avg_speed_kmh,
        count(*) AS sample_size
      FROM segments
      WHERE hours_elapsed > 0
        AND (distance_km / hours_elapsed) BETWEEN 2 AND 130
      GROUP BY carrier_id, province, hour_bucket
      HAVING count(*) >= 5
    `;

    for (const row of rows) {
      await prisma.routeSpeedCalibration.upsert({
        where: {
          companyId_carrierId_province_hourBucket: {
            companyId: company.id,
            carrierId: row.carrier_id,
            province: row.province,
            hourBucket: row.hour_bucket,
          } as any,
        },
        create: {
          companyId: company.id,
          carrierId: row.carrier_id,
          province: row.province,
          hourBucket: row.hour_bucket,
          avgSpeedKmh: row.avg_speed_kmh,
          sampleSize: Number(row.sample_size),
        },
        update: {
          avgSpeedKmh: row.avg_speed_kmh,
          sampleSize: Number(row.sample_size),
          calculatedAt: new Date(),
        },
      });
      totalUpserts++;
    }
  }

  return { upserts: totalUpserts, companiesProcessed: companies.length };
}
