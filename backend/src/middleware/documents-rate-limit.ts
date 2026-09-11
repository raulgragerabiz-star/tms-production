import rateLimit from "express-rate-limit";

// Límite por IP para /api/documents/public/* -- endpoint público (sin login,
// a propósito: lo escanea un control de carretera desde el QR del propio
// documento) así que necesita su propia contención, mismo patrón que
// tracking-rate-limit.ts. El token JWT ya impide adivinar documentos al
// azar; esto es solo para evitar abuso/flood del endpoint en sí.
const WINDOW_MS = Number(process.env.DOCUMENTS_RATE_LIMIT_WINDOW_MS ?? 60_000); // 1 minuto
const MAX_REQUESTS_PER_IP = Number(process.env.DOCUMENTS_RATE_LIMIT_MAX_PER_IP ?? 30);

export const documentsRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limit_exceeded",
    detail: `Demasiadas consultas. Inténtalo de nuevo en ${Math.ceil(WINDOW_MS / 1000)} segundos.`,
  },
});
