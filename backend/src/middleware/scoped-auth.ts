import { NextFunction, Request, Response } from "express";
import { HttpError } from "@/utils/http-error";

// Restringe el acceso a usuarios de portal externo (Fase 2 §7: autenticación independiente,
// scopes propios, nunca compartiendo sesión ni permisos con el backoffice interno).
export function requireCarrierPortal(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(HttpError.unauthorized());
  if (req.auth.userType !== "carrier_portal" || !req.auth.carrierId) {
    return next(HttpError.forbidden("Acceso exclusivo del Portal Transportista"));
  }
  next();
}

export function requireDriverApp(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(HttpError.unauthorized());
  if (req.auth.userType !== "driver_app" || !req.auth.driverId) {
    return next(HttpError.forbidden("Acceso exclusivo de la App Conductor"));
  }
  next();
}

export function requireCustomerPortal(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) return next(HttpError.unauthorized());
  if (req.auth.userType !== "customer_portal" || !req.auth.customerId) {
    return next(HttpError.forbidden("Acceso exclusivo del Portal Cliente"));
  }
  next();
}