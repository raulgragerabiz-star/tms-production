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
  // Fase 25 ("usuarios app" sub-fase 3): una sesión de QR de ruta también es
  // userType "driver_app" pero no tiene ninguna cuenta de conductor real
  // detrás -- `driverId` va a null y en su lugar lleva el bloque `routeQr`
  // (ver JwtPayload, auth.service.ts). Antes de esta fase, `driverId` era
  // obligatorio para entrar aquí; ahora basta con tener uno de los dos.
  const hasDriverAccount = !!req.auth.driverId;
  const hasRouteQrSession = !!req.auth.routeQr;
  if (req.auth.userType !== "driver_app" || (!hasDriverAccount && !hasRouteQrSession)) {
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
