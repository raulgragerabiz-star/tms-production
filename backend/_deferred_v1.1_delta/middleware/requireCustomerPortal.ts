import { Request, Response, NextFunction } from "express";
import { HttpError } from "../lib/http-error"; // ya existente en el proyecto

/**
 * Refuerza a nivel de backend (no solo de UI) que un token del Portal
 * Cliente solo puede operar dentro de su propio customerId — mismo
 * principio ya aplicado a requireCarrierPortal (carrierId fijo) y
 * requireDriverApp (driverId fijo). Documento v1.1 §7.2.
 */
export function requireCustomerPortal(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth || req.auth.userType !== "customer_portal" || !req.auth.customerId) {
    return next(HttpError.forbidden("Acceso exclusivo del Portal Cliente"));
  }
  next();
}
