import { NextFunction, Request, Response } from "express";
import { HttpError } from "@/utils/http-error";

// Restringe el acceso a usuarios de portal externo (Fase 2 §7: autenticación independiente,
// scopes propios, nunca compartiendo sesión ni permisos con el backoffice interno).
//
// requireCarrierPortal (Portal Transportista) se retiró en la sub-fase 4 de "usuarios app"
// (petición explícita de Raúl: "carece de sentido") junto con carrier-portal.routes.ts y
// toda la app apps/carrier-portal -- ver claude/fase26-retirada-portal-transportista.md.
// El valor de enum UserType.carrier_portal NO se borra de la base de datos (cuentas
// AppUser y mensajes de chat históricos que ya existieran se dejan intactos), pero ya no
// hay ningún router montado que lo use.

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
