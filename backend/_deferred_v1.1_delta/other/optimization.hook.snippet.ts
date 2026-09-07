// ============================================================================
// Punto de enganche sobre tu controller de optimización YA EXISTENTE
// (el que genera cost_simulation y pone route.status = 'optimized', ver
// 09-motor-optimizacion-TMS.md y 05-flujo-operativo-TMS.md paso 4).
//
// NO se sustituye ese controller — se añade una llamada al final, después
// de que la ruta ya esté en `optimized` con sus cost_simulation generados.
// ============================================================================

import { autoAssignRouteIfEligible } from "./modules/intelligence/auto-optimization.orchestrator";

// Dentro de tu función existente que genera las cost_simulation de una
// ruta (algo como `optimizeRoute(routeId)` en tu optimization.controller.ts):
//
// export async function optimizeRoute(routeId: string) {
//   // ... lógica ya existente: generar candidatos, calcular
//   // cost_simulation por cada uno, ordenar, marcar route.status = 'optimized' ...
//
//   // NUEVO — único añadido de esta pasada:
//   const autoAssignOutcome = await autoAssignRouteIfEligible(routeId);
//   if (autoAssignOutcome.autoAssigned) {
//     console.log(
//       `[auto-optimization] Ruta ${routeId} auto-asignada ` +
//       `(confianza ${autoAssignOutcome.confidence?.toFixed(2)})`
//     );
//     // Notificar al planificador vía Socket.io si tu Dashboard ya
//     // escucha eventos de ruta — reutiliza broadcastPositionUpdate como
//     // referencia de patrón, o añade un evento `route_auto_assigned`
//     // específico si lo necesitas en el Dashboard en tiempo real.
//   }
//
//   return route; // como ya hacía tu controller
// }
//
// Si la empresa no tiene `autoAssignEnabled`, `autoAssignRouteIfEligible`
// devuelve inmediatamente `{ autoAssigned: false, reason:
// "auto_assign_disabled_for_company" }` sin tocar nada — coste marginal
// nulo para el 100% de las empresas que no lo activen (opt-in real).
