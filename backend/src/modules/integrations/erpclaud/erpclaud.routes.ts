import { Router } from "express";
import { requireAuth } from "@/middleware/auth";
import { erpclaudIpRateLimiter, erpclaudCompanyRateLimiter } from "@/middleware/erpclaud-rate-limit";
import { importOrdersFromErpclaud } from "./erpclaud.controller";

const erpclaudRouter = Router();

// Orden deliberado: el limitador por IP corre ANTES de resolver auth (protege
// aunque el token sea inválido/no se llegue a autenticar), y el limitador por
// companyId corre DESPUÉS de requireAuth, ya con req.auth disponible.
// POST /api/integrations/erpclaud/import-orders
erpclaudRouter.post(
  "/import-orders",
  erpclaudIpRateLimiter,
  requireAuth,
  erpclaudCompanyRateLimiter,
  importOrdersFromErpclaud
);

export default erpclaudRouter;
