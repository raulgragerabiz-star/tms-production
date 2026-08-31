-- ============================================================================
-- v1.1 — Migración manual (usar con `prisma db push` + este script de datos,
-- coherente con la decisión ya tomada del proyecto de usar db push en vez de
-- `migrate deploy` en Codespaces).
-- Ejecutar DESPUÉS de `npx prisma db push` (que crea las columnas/enum nuevos).
-- ============================================================================

BEGIN;

-- 1. Añadir el nuevo enum de 4 valores como columna temporal, migrar, y sustituir.
-- (Prisma db push ya habrá creado order.service_type_new si se define así en el
--  schema; si prefieres migración en dos pasos explícita, usa este patrón:)

ALTER TABLE "order" ADD COLUMN IF NOT EXISTS "service_type_v11" TEXT;

UPDATE "order"
SET "service_type_v11" = CASE
  WHEN "service_type" = 'full_truck' THEN 'gran_volumen'
  WHEN "service_type" = 'pallet'     THEN 'paleteria'
  ELSE 'paleteria'
END;

-- Renombrar columnas (ajustar nombres exactos a los que genere tu Prisma):
ALTER TABLE "order" RENAME COLUMN "service_type" TO "service_type_legacy_v10";
ALTER TABLE "order" RENAME COLUMN "service_type_v11" TO "service_type";

-- 2. Re-etiquetar tarifas existentes según lo indicado en el documento v1.1 §2.3:
--    full_truck_rate -> aplicable a {gran_volumen}
--    pallet_rate     -> aplicable a {paleteria, paleteria_pesada}
-- (si tienes tabla de aplicabilidad explícita, insertar aquí; si no, se resuelve
--  en código en rate-resolution.service.ts según el segment del pedido)

-- 3. Seed de service_segmentation_rule (valores por defecto §2.2 del documento,
--    marcados (config) — ajustables sin tocar código)
INSERT INTO "service_segmentation_rule"
  (id, company_id, segment, max_weight_kg, max_pallets, max_weight_per_pallet_kg, max_volume_m3, priority, active, created_at, updated_at)
SELECT
  gen_random_uuid(), c.id, 'paqueteria', 30, 0, NULL, 0.5, 1, true, now(), now()
FROM "company" c
ON CONFLICT DO NOTHING;

INSERT INTO "service_segmentation_rule"
  (id, company_id, segment, max_weight_kg, max_pallets, max_weight_per_pallet_kg, max_volume_m3, priority, active, created_at, updated_at)
SELECT
  gen_random_uuid(), c.id, 'paleteria', 800, 4, 400, 6, 2, true, now(), now()
FROM "company" c
ON CONFLICT DO NOTHING;

INSERT INTO "service_segmentation_rule"
  (id, company_id, segment, max_weight_kg, max_pallets, max_weight_per_pallet_kg, max_volume_m3, priority, active, created_at, updated_at)
SELECT
  gen_random_uuid(), c.id, 'paleteria_pesada', 3000, 6, 1200, 12, 3, true, now(), now()
FROM "company" c
ON CONFLICT DO NOTHING;

INSERT INTO "service_segmentation_rule"
  (id, company_id, segment, max_weight_kg, max_pallets, max_weight_per_pallet_kg, max_volume_m3, priority, active, created_at, updated_at)
SELECT
  gen_random_uuid(), c.id, 'gran_volumen', NULL, NULL, NULL, NULL, 4, true, now(), now()
FROM "company" c
ON CONFLICT DO NOTHING;

-- 4. audit_log: relajar NOT NULL en company_id/user_id para admitir
--    auditoría de jobs transversales del sistema (ver jobs/scheduler.ts).
--    Aditivo/no destructivo: DROP NOT NULL nunca invalida filas existentes.
ALTER TABLE "audit_log" ALTER COLUMN "company_id" DROP NOT NULL;
ALTER TABLE "audit_log" ALTER COLUMN "user_id" DROP NOT NULL;

COMMIT;
