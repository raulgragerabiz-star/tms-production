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
};
