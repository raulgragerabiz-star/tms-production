-- ============================================================================
-- v1.1 (pasada 5) — KPIs/BI ampliado (17-kpis-bi-TMS.md).
--
-- Enfoque: UNA vista materializada de hechos ("facts"), grano = parada de
-- ruta (route_stop) ya completada o fallida, con todas las dimensiones de
-- corte como columnas y todas las métricas base ya calculadas por fila.
-- Los 150+ KPIs del documento se generan DESPUÉS, en kpi.service.ts, como
-- combinaciones de GROUP BY sobre esta única vista — "todos con la misma
-- lógica de cálculo subyacente" (17-kpis-bi-TMS.md, sección "Enfoque"),
-- en vez de mantener 150 queries distintas.
--
-- Ejecutar tras `npx prisma db push` (aunque esto no es una tabla Prisma
-- gestionada — Prisma no modela vistas materializadas nativamente; se
-- ejecuta como SQL manual, igual que el resto de `migrations_manual/`).
-- ============================================================================

BEGIN;

-- Ajustar nombres exactos de columna/tabla si difieren de los asumidos
-- aquí (se han usado los nombres tal y como aparecen en 04-modelo-bd-TMS.md,
-- pero snake_case real generado por Prisma puede variar ligeramente).

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_kpi_shipment_facts AS
SELECT
  rs.id                              AS route_stop_id,
  r.company_id                       AS company_id,
  r.warehouse_id                     AS warehouse_id,
  r.carrier_id                       AS carrier_id,
  r.vehicle_id                       AS vehicle_id,
  v.vehicle_type_id                  AS vehicle_type_id,
  s.driver_id                        AS driver_id,
  o.customer_id                      AS customer_id,
  o.id                               AS order_id,
  s.id                               AS shipment_id,
  o.service_type                     AS service_type,
  dp.province                        AS province,
  r.route_date                       AS stop_date,
  rs.eta                             AS planned_eta,
  pod.delivered_at                   AS delivered_at,

  -- OTIF: entregado dentro de la ventana horaria comprometida del punto de
  -- entrega (delivery_time_window_from/to en Order, ya existente Fase 3).
  CASE
    WHEN pod.delivered_at IS NULL THEN NULL
    WHEN o.delivery_time_window_from IS NULL THEN 1
    WHEN pod.delivered_at::time BETWEEN o.delivery_time_window_from AND o.delivery_time_window_to THEN 1
    ELSE 0
  END                                 AS otif_flag,

  -- Peso/palés de la parada = suma de las líneas del pedido asociado.
  COALESCE(ol_agg.total_weight_kg, 0) AS weight_kg,
  COALESCE(ol_agg.total_pallets, 0)   AS pallets,

  -- Coste estimado/real prorrateado por peso entre las paradas de la
  -- misma ruta — misma regla de negocio ya fijada en
  -- 09-motor-optimizacion-TMS.md ("Coste por pedido: coste de la parada
  -- repartido entre los pedidos que la componen, proporcional a su peso").
  CASE WHEN route_weight.total_route_weight_kg > 0 THEN
    cs.estimated_cost * (COALESCE(ol_agg.total_weight_kg, 0) / route_weight.total_route_weight_kg)
  ELSE NULL END                       AS cost_estimated,

  CASE WHEN route_weight.total_route_weight_kg > 0 THEN
    sl.amount * (COALESCE(ol_agg.total_weight_kg, 0) / route_weight.total_route_weight_kg)
  ELSE NULL END                       AS cost_real,

  r.distance_planned_km               AS distance_planned_km,  -- 🔧 columna nueva aditiva en Route si no existe aún
  r.distance_real_km                  AS distance_real_km,      -- 🔧 idem, alimentada desde tracking_event al cerrar el shipment

  (SELECT count(*) FROM incident i WHERE i.route_stop_id = rs.id) AS incident_count,
  (SELECT avg(EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60)
     FROM incident i WHERE i.route_stop_id = rs.id AND i.status = 'resolved') AS avg_incident_resolution_minutes

FROM route_stop rs
JOIN route r            ON r.id = rs.route_id
JOIN "order" o           ON o.id = rs.order_id
JOIN delivery_point dp   ON dp.id = o.delivery_point_id
LEFT JOIN vehicle v      ON v.id = r.vehicle_id
LEFT JOIN shipment s     ON s.route_id = r.id
LEFT JOIN proof_of_delivery pod ON pod.route_stop_id = rs.id
LEFT JOIN cost_simulation cs ON cs.route_id = r.id AND cs.is_selected = true
LEFT JOIN settlement_line sl ON sl.shipment_id = s.id
LEFT JOIN LATERAL (
  SELECT
    sum(ol.line_weight_kg) AS total_weight_kg,
    sum(ol.quantity / NULLIF(p.units_per_pallet, 0)) AS total_pallets
  FROM order_line ol
  JOIN product p ON p.id = ol.product_id
  WHERE ol.order_id = o.id
) ol_agg ON true
LEFT JOIN LATERAL (
  SELECT sum(ol2.line_weight_kg) AS total_route_weight_kg
  FROM route_stop rs2
  JOIN "order" o2 ON o2.id = rs2.order_id
  JOIN order_line ol2 ON ol2.order_id = o2.id
  WHERE rs2.route_id = r.id
) route_weight ON true
WHERE rs.status IN ('completed', 'failed');

-- Índices sobre la vista materializada — sin ellos, cada GROUP BY del
-- kpi.service.ts haría un seq scan completo de la vista en cada consulta.
CREATE UNIQUE INDEX IF NOT EXISTS mv_kpi_shipment_facts_pk
  ON mv_kpi_shipment_facts (route_stop_id);
CREATE INDEX IF NOT EXISTS mv_kpi_shipment_facts_company_date
  ON mv_kpi_shipment_facts (company_id, stop_date);
CREATE INDEX IF NOT EXISTS mv_kpi_shipment_facts_carrier
  ON mv_kpi_shipment_facts (carrier_id, stop_date);
CREATE INDEX IF NOT EXISTS mv_kpi_shipment_facts_warehouse
  ON mv_kpi_shipment_facts (warehouse_id, stop_date);

COMMIT;

-- ============================================================================
-- Notas:
-- 1. `REFRESH MATERIALIZED VIEW CONCURRENTLY` (usado por
--    refresh-kpi-views.job.ts) requiere el índice único ya creado arriba
--    — sin él, el refresh concurrente falla.
-- 2. Si `route.distance_planned_km`/`distance_real_km` no existen todavía,
--    añadirlos como columnas aditivas nullable en `Route`
--    (schema.delta.prisma §12) antes de crear esta vista, o comentar esas
--    dos líneas del SELECT hasta que existan.
-- 3. Esta vista NO incluye Retornos (omitido explícitamente del alcance
--    del proyecto) ni CO2 (pendiente del dato de tipo de combustible por
--    vehículo, ya marcado como ampliación futura en 17-kpis-bi-TMS.md).
-- ============================================================================
