import { Request, Response, NextFunction } from "express";
import { requireAuth } from "./requireAuth";

/**
 * Refuerza a nivel de backend (no solo de UI) que un token del Portal
 * Cliente solo puede operar dentro de su propio customerId — mismo
 * principio ya aplicado a requireCarrierPortal (carrierId fijo) y
 * requireDriverApp (driverId fijo). Documento v1.1 §7.2.
 *
 * CORREGIDO: la versión anterior comprobaba req.auth sin haber llamado
 * antes a requireAuth, así que req.auth nunca llegaba a poblarse y
 * todas las peticiones del Portal Cliente devolvían 403 siempre.
 */
export function requireCustomerPortal(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.auth || req.auth.userType !== "customer_portal" || !req.auth.customerId) {
      return res.status(403).json({ error: "forbidden_not_customer_portal" });
    }
    next();
  });
}
