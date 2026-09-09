-- Fase 6: histórico de posiciones vía PostGIS.
--
-- Deliberadamente al margen de las migraciones de Prisma (no se toca
-- schema.prisma ni se corre `prisma migrate`): así esta pieza se puede aplicar
-- de forma independiente, con `npm run postgis:setup` (ver
-- src/scripts/setup-postgis.ts), sin arrastrar a Prisma a gestionar un tipo de
-- columna (`geography`) que no entiende de forma nativa. La aplicación nunca
-- lee/escribe la columna `geom` a través de Prisma Client -- solo con SQL en
-- bruto (`$queryRaw`, ver shipments.routes.ts GET /:id/track), así que no hay
-- riesgo de desincronización con el schema de Prisma.
--
-- Todo idempotente (se puede ejecutar tantas veces como haga falta sin
-- romper nada ni duplicar objetos).

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE tracking_event ADD COLUMN IF NOT EXISTS geom geography(Point, 4326);

-- Rellena `geom` automáticamente a partir de lat/lng en cada inserción o
-- actualización -- así el código de la aplicación sigue escribiendo
-- únicamente lat/lng (como siempre ha hecho) y esta columna se mantiene
-- sincronizada sola, sin tener que tocar ni una línea de TypeScript más allá
-- de las consultas de lectura que ya usan PostGIS (ST_Simplify/ST_MakeLine).
CREATE OR REPLACE FUNCTION tracking_event_set_geom() RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tracking_event_set_geom ON tracking_event;
CREATE TRIGGER trg_tracking_event_set_geom
  BEFORE INSERT OR UPDATE OF lat, lng ON tracking_event
  FOR EACH ROW
  EXECUTE FUNCTION tracking_event_set_geom();

-- Backfill de las filas ya existentes (si las hay) que todavía no tienen geom.
UPDATE tracking_event
SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
WHERE geom IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

-- Índice espacial -- necesario para que las consultas por proximidad/histórico
-- (ST_MakeLine, ST_Simplify, futuras búsquedas "vehículos cerca de X") sean
-- rápidas también cuando la tabla crezca.
CREATE INDEX IF NOT EXISTS idx_tracking_event_geom ON tracking_event USING GIST (geom);
