import { Router } from "express";
import { requireAuth } from "../../../middleware/requireAuth"; // ya existente en el proyecto
import { erpclaudIpRateLimiter, erpclaudCompanyRateLimiter } from "../../../middleware/erpclaud-rate-limit";
import { importOrdersFromErpclaud } from "./erpclaud.controller";

const router = Router();

// Orden deliberado: limitador por IP corre ANTES de resolver auth (protege
// aunque el token sea inválido/no se llegue a autenticar), y el limitador
// por companyId corre DESPUÉS de requireAuth, ya con req.auth disponible.
// POST /api/integrations/erpclaud/import-orders
router.post(
  "/import-orders",
  erpclaudIpRateLimiter,
  requireAuth,
  erpclaudCompanyRateLimiter,
  importOrdersFromErpclaud
);

export default router;
