import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const jwtSecret = required("JWT_SECRET", "dev_secret_change_me");

// Salvaguarda de arranque: nunca permitir que producción corra con el secreto de
// desarrollo por defecto (fallo silencioso muy costoso si se despliega sin configurar).
if (nodeEnv === "production" && jwtSecret === "dev_secret_change_me") {
  throw new Error(
    "JWT_SECRET no está configurado (o usa el valor de desarrollo por defecto) con NODE_ENV=production. " +
      "Define un secreto fuerte y único antes de arrancar en producción."
  );
}

// CORS_ORIGIN admite una lista separada por comas, ya que el backend sirve a 3 frontends
// distintos (backoffice, Portal Transportista, App Conductor), cada uno en su propio origen.
const corsOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173,http://localhost:5174,http://localhost:5175")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

export const env = {
  port: parseInt(process.env.PORT ?? "4000", 10),
  nodeEnv,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "8h",
  corsOrigins,
  // Fase 6 (integración OpenRouteService): opcional a propósito -- si no está
  // configurada, todo el sistema sigue funcionando exactamente igual que
  // antes (routing.service.ts cae automáticamente a la aproximación por
  // línea recta ya existente, y la geocodificación automática simplemente no
  // se intenta). Así esta fase se puede aplicar antes de tener la clave
  // puesta en el .env, sin romper nada mientras tanto.
  orsApiKey: process.env.ORS_API_KEY || undefined,
  // Perfil de OpenRouteService para el cálculo de rutas -- "driving-hgv" está
  // pensado para camiones (restricciones de altura/peso/mercancías
  // peligrosas), "driving-car" es el perfil genérico. Configurable porque no
  // todas las flotas son de camión pesado.
  orsProfile: process.env.ORS_PROFILE || "driving-hgv",
  // Cache compartida (Fase 6): si se configura, el cliente de OpenRouteService
  // (geocodificación, rutas, optimización) cachea en Redis en vez de en
  // memoria del proceso -- necesario en cuanto el backend corra en más de una
  // instancia, y recomendable siempre para no agotar la cuota diaria gratuita
  // de la API repitiendo la misma consulta. Sin configurar, cae a una cache en
  // memoria (ver lib/shared-cache.ts) -- funciona igual de bien con una sola
  // instancia, solo que no se comparte entre procesos ni sobrevive a un reinicio.
  redisUrl: process.env.REDIS_URL || undefined,
};
