import rateLimit from "express-rate-limit";

// Límite por IP para /api/tracking/* -- es un endpoint público (sin login,
// a propósito: ver tracking.routes.ts) así que necesita su propia
// contención para que nadie lo use para ir probando números de pedido o
// códigos postales al azar. Mismo patrón que erpclaud-rate-limit.ts.
const WINDOW_MS = Number(process.env.TRACKING_RATE_LIMIT_WINDOW_MS ?? 60_000); // 1 minuto
const MAX_REQUESTS_PER_IP = Number(process.env.TRACKING_RATE_LIMIT_MAX_PER_IP ?? 20);

export const trackingRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_IP,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limit_exceeded",
    detail: `Demasiadas consultas. Inténtalo de nuevo en ${Math.ceil(WINDOW_MS / 1000)} segundos.`,
  },
});
