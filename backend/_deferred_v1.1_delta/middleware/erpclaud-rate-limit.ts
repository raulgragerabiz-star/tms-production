import rateLimit from "express-rate-limit";
import { Request } from "express";

/**
 * Rate limiting para /api/integrations/erpclaud/*. Hasta ahora este
 * endpoint solo estaba protegido por Bearer token (auth), sin límite de
 * frecuencia — un cliente ERP mal configurado (o un token comprometido)
 * podía saturar el bridge de importación sin ninguna contención.
 *
 * Dos límites independientes, ambos activos a la vez:
 * 1. Por IP de origen — protege contra abuso/DoS básico antes de resolver auth.
 * 2. Por companyId autenticado — protege contra que UN integrador concreto
 *    (aunque legítimo) monopolice recursos compartidos del bridge.
 *
 * Valores por defecto (config) — ajustables por variables de entorno sin
 * tocar código, mismo patrón que el resto de valores `(config)` del
 * proyecto (umbrales de segmentación, radio de clustering).
 */

const WINDOW_MS = Number(process.env.ERPCLAUD_RATE_LIMIT_WINDOW_MS ?? 60_000); // 1 minuto
const MAX_REQUESTS_PER_IP = Number(process.env.ERPCLAUD_RATE_LIMIT_MAX_PER_IP ?? 30);
const MAX_REQUESTS_PER_COMPANY = Number(process.env.ERPCLAUD_RATE_LIMIT_MAX_PER_COMPANY ?? 60);

export const erpclaudIpRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_IP,
  standardHeaders: true, // expone RateLimit-* headers, útil para que el ERP externo se autorregule
  legacyHeaders: false,
  message: {
    error: "rate_limit_exceeded",
    detail: `Máximo ${MAX_REQUESTS_PER_IP} peticiones por IP cada ${WINDOW_MS / 1000}s.`,
  },
});

export const erpclaudCompanyRateLimiter = rateLimit({
  windowMs: WINDOW_MS,
  limit: MAX_REQUESTS_PER_COMPANY,
  standardHeaders: true,
  legacyHeaders: false,
  // Se aplica DESPUÉS de requireAuth en la cadena de middlewares, por eso
  // puede confiar en req.auth.companyId como clave — si por lo que sea no
  // hubiera auth resuelta, cae a la IP para no perder la protección.
  keyGenerator: (req: Request) => req.auth?.companyId ?? req.ip ?? "unknown",
  message: {
    error: "rate_limit_exceeded",
    detail: `Máximo ${MAX_REQUESTS_PER_COMPANY} peticiones por empresa cada ${WINDOW_MS / 1000}s.`,
  },
});
