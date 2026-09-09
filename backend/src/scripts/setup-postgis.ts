// Fase 6: aplica prisma/postgis-setup.sql contra la base de datos configurada
// en DATABASE_URL, usando el mismo Prisma Client que ya usa el backend (sin
// depender de tener el cliente `psql` instalado en el Codespace). Cada
// sentencia se ejecuta por separado y de forma best-effort: si una falla (por
// ejemplo, porque el plan de Neon no permite crear la extensión PostGIS
// todavía), se avisa claramente por consola y se sigue con el resto -- el
// resto del sistema (Fase 6 completa) funciona igual sin PostGIS, solo que
// GET /shipments/:id/track devuelve los puntos sin simplificar (ver esa ruta).
//
// Uso: npm run postgis:setup (dentro de backend/).
import { prisma } from "@/lib/prisma";

const STATEMENTS: { label: string; sql: string }[] = [
  { label: "Extensión PostGIS", sql: `CREATE EXTENSION IF NOT EXISTS postgis` },
  {
    label: "Columna geom en tracking_event",
    sql: `ALTER TABLE tracking_event ADD COLUMN IF NOT EXISTS geom geography(Point, 4326)`,
  },
  {
    label: "Función de sincronización geom<-lat/lng",
    sql: `
      CREATE OR REPLACE FUNCTION tracking_event_set_geom() RETURNS trigger AS $$
      BEGIN
        IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
          NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
        ELSE
          NEW.geom := NULL;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `,
  },
  { label: "Eliminar trigger anterior (si existe)", sql: `DROP TRIGGER IF EXISTS trg_tracking_event_set_geom ON tracking_event` },
  {
    label: "Trigger de sincronización geom<-lat/lng",
    sql: `
      CREATE TRIGGER trg_tracking_event_set_geom
        BEFORE INSERT OR UPDATE OF lat, lng ON tracking_event
        FOR EACH ROW
        EXECUTE FUNCTION tracking_event_set_geom()
    `,
  },
  {
    label: "Backfill de filas existentes",
    sql: `
      UPDATE tracking_event
      SET geom = ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
      WHERE geom IS NULL AND lat IS NOT NULL AND lng IS NOT NULL
    `,
  },
  { label: "Índice espacial", sql: `CREATE INDEX IF NOT EXISTS idx_tracking_event_geom ON tracking_event USING GIST (geom)` },
];

async function main() {
  console.log("=== Fase 6: configurando PostGIS (histórico de posiciones) ===\n");
  let anyFailed = false;

  for (const { label, sql } of STATEMENTS) {
    try {
      await prisma.$executeRawUnsafe(sql);
      console.log(`OK: ${label}`);
    } catch (err) {
      anyFailed = true;
      console.warn(`AVISO: "${label}" falló -- ${(err as Error).message}`);
    }
  }

  console.log("");
  if (anyFailed) {
    console.log(
      "Alguna sentencia falló (revisa los avisos de arriba). El resto de la Fase 6 sigue funcionando igual: " +
        "GET /shipments/:id/track cae automáticamente a devolver los puntos sin simplificar si PostGIS no está disponible."
    );
  } else {
    console.log("PostGIS configurado correctamente. El histórico de posiciones ya se puede consultar simplificado.");
  }
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Fallo inesperado configurando PostGIS:", err);
  await prisma.$disconnect();
  process.exit(1);
});
