import { Request, Response, NextFunction } from "express";
import { requireAuth } from "./requireAuth";

export function requireCarrierPortal(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, () => {
    if (!req.auth || req.auth.userType !== "carrier_portal" || !req.auth.carrierId) {
      return res.status(403).json({ error: "forbidden_not_carrier_portal" });
    }
    next();
  });
}
