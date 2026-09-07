import { Request, Response, NextFunction } from "express";
import { verifyAuthToken } from "../lib/auth";

/**
 * Middleware base de autenticación — usado por TODOS los módulos internos
 * (backoffice) y como primera capa antes de los guards más específicos
 * (requireDriverApp, requireCarrierPortal, requireCustomerPortal, que
 * además comprueban userType concreto).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_authorization_header" });
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = verifyAuthToken(token);
    req.auth = {
      userId: payload.userId,
      companyId: payload.companyId,
      userType: payload.userType as any,
      carrierId: payload.carrierId,
      driverId: payload.driverId,
      customerId: payload.customerId,
    };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_or_expired_token" });
  }
}
