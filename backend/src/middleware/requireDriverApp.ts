import { Request, Response, NextFunction } from "express";
import { requireAuth } from "./requireAuth";

/**
 * Igual que requireCustomerPortal/requireCarrierPortal: refuerza a nivel
 * de backend que un token de la App Conductor solo puede operar como ESE
 * conductor concreto, nunca ver rutas de otros.
 */
export function requireDriverApp(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.auth || req.auth.userType !== "driver_app" || !req.auth.driverId) {
      return res.status(403).json({ error: "forbidden_not_driver_app" });
    }
    next();
  });
}
