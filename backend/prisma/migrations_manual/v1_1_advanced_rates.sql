-- ============================================================================
-- v1.1 (pasada 3) — Motor de tarifas avanzado + chat + disputas.
-- Ejecutar tras `npx prisma db push` con los modelos/campos de
-- schema.delta.prisma §9-10 ya aplicados.
-- ============================================================================

BEGIN;

-- Ajuste de nombre de columna asumido en surcharge.service.ts
-- (valid_from ya existe en rate_surcharge desde el schema base, Fase 3;
--  se deja como referencia por si tu columna real se llama distinto)
-- ALTER TABLE "rate_surcharge" RENAME COLUMN "valid_from" TO "valid_from"; -- no-op, documental

-- Seed de ejemplo de festivos nacionales 2026 (España) — sustituir/ampliar
-- según calendario real de la empresa.
INSERT INTO "holiday_calendar" (id, company_id, date, label, province, created_at)
SELECT gen_random_uuid(), c.id, d.holiday_date, d.label, NULL, now()
FROM "company" c
CROSS JOIN (VALUES
  ('2026-01-01'::date, 'Año Nuevo'),
  ('2026-01-06'::date, 'Epifanía del Señor'),
  ('2026-04-03'::date, 'Viernes Santo'),
  ('2026-05-01'::date, 'Fiesta del Trabajo'),
  ('2026-08-15'::date, 'Asunción de la Virgen'),
  ('2026-10-12'::date, 'Fiesta Nacional de España'),
  ('2026-11-01'::date, 'Todos los Santos'),
  ('2026-12-06'::date, 'Día de la Constitución'),
  ('2026-12-08'::date, 'Inmaculada Concepción'),
  ('2026-12-25'::date, 'Natividad del Señor')
) AS d(holiday_date, label)
ON CONFLICT DO NOTHING;

-- Seed de ejemplo de índice de combustible (sustituir por lectura real /
-- integración con boletín petrolero oficial cuando exista, campo `source`
-- ya preparado para distinguir 'manual' de 'cores_api').
INSERT INTO "fuel_index_reading" (id, company_id, effective_on, index_value, source, created_at)
SELECT gen_random_uuid(), c.id, CURRENT_DATE, 1.45, 'manual', now()
FROM "company" c
ON CONFLICT DO NOTHING;

COMMIT;
