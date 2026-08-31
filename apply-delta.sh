#!/usr/bin/env bash
# ============================================================================
# apply-delta.sh — Aplica SOLO el bloque CRÍTICO del delta v1.1 (ver
# DEPLOYMENT_RUNBOOK.md) contra un checkout local de tu repo del TMS.
#
# USO:
#   1. Clona/abre tu repo del TMS en Codespaces (o local).
#   2. Descomprime este paquete (tms-v1.1-delta.zip) en un directorio
#      HERMANO al repo, no dentro de él. Ej:
#        ~/proyectos/tms-app/          <- tu repo real
#        ~/proyectos/tms-v1.1-delta/   <- este paquete descomprimido
#   3. Desde la raíz de tu repo (~/proyectos/tms-app), ejecuta:
#        bash ../tms-v1.1-delta/apply-delta.sh
#   4. Revisa el resumen final: qué se copió, qué requiere tu intervención
#      manual (merges de schema.prisma, snippets de rutas — no se
#      sobrescriben archivos que ya existen con lógica propia).
#
# QUÉ HACE:
#   - Copia archivos NUEVOS (no existen aún en tu repo) directamente.
#   - Para archivos que REQUIEREN MERGE manual (schema.prisma, app.ts,
#     package.json), los deja en una carpeta `_manual_merge_needed/` para
#     que los revises tú — nunca sobrescribe algo que ya tenías.
#   - No toca nada del bloque DIFERIBLE (pasadas 4-8).
#
# NO HACE (deliberado, para no romper nada sin supervisión):
#   - No ejecuta `npm install` por ti (lo lista al final).
#   - No ejecuta `prisma db push` por ti (lo lista al final).
#   - No hace commit ni push — tú revisas y confirmas.
# ============================================================================

set -euo pipefail

DELTA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_DIR="$(pwd)"
MANUAL_MERGE_DIR="$TARGET_DIR/_manual_merge_needed"

echo "=================================================================="
echo " Aplicando bloque CRÍTICO del delta v1.1"
echo " Origen:  $DELTA_DIR"
echo " Destino: $TARGET_DIR"
echo "=================================================================="

if [ ! -d "$TARGET_DIR/backend" ] && [ ! -d "$TARGET_DIR/apps" ]; then
  echo "⚠️  No se detecta backend/ ni apps/ en el directorio actual."
  echo "   Ejecuta este script desde la RAÍZ de tu repo del TMS."
  exit 1
fi

mkdir -p "$MANUAL_MERGE_DIR"

copy_new_file() {
  local src="$1"
  local dest="$2"
  if [ -f "$dest" ]; then
    echo "  ↷ ya existe, no se sobrescribe: $dest"
  else
    mkdir -p "$(dirname "$dest")"
    cp "$src" "$dest"
    echo "  ✓ copiado: $dest"
  fi
}

flag_for_manual_merge() {
  local src="$1"
  local label="$2"
  mkdir -p "$MANUAL_MERGE_DIR"
  cp "$src" "$MANUAL_MERGE_DIR/$(basename "$src")"
  echo "  ⚠ requiere merge manual -> _manual_merge_needed/$(basename "$src")  ($label)"
}

echo ""
echo "--- 1. Schema + migración de segmentación (CRÍTICO, paso 1-2) ---"
flag_for_manual_merge "$DELTA_DIR/backend/prisma/schema.delta.prisma" "mergear en backend/prisma/schema.prisma"
copy_new_file "$DELTA_DIR/backend/prisma/migrations_manual/v1_1_segmentation.sql" "$TARGET_DIR/backend/prisma/migrations_manual/v1_1_segmentation.sql"
copy_new_file "$DELTA_DIR/backend/src/modules/segmentation/segmentation.service.ts" "$TARGET_DIR/backend/src/modules/segmentation/segmentation.service.ts"
copy_new_file "$DELTA_DIR/backend/src/tests/segmentation.service.test.ts" "$TARGET_DIR/backend/src/tests/segmentation.service.test.ts"
copy_new_file "$DELTA_DIR/backend/src/lib/memory-cache.ts" "$TARGET_DIR/backend/src/lib/memory-cache.ts"

echo ""
echo "--- 2. Bridge ERP erpclaud (CRÍTICO, paso 3) ---"
copy_new_file "$DELTA_DIR/backend/src/modules/integrations/erpclaud/erpclaud.routes.ts" "$TARGET_DIR/backend/src/modules/integrations/erpclaud/erpclaud.routes.ts"
copy_new_file "$DELTA_DIR/backend/src/modules/integrations/erpclaud/erpclaud.controller.ts" "$TARGET_DIR/backend/src/modules/integrations/erpclaud/erpclaud.controller.ts"
copy_new_file "$DELTA_DIR/backend/src/modules/integrations/erpclaud/erpclaud.service.ts" "$TARGET_DIR/backend/src/modules/integrations/erpclaud/erpclaud.service.ts"
copy_new_file "$DELTA_DIR/backend/src/tests/integration/test-utils.ts" "$TARGET_DIR/backend/src/tests/integration/test-utils.ts"
copy_new_file "$DELTA_DIR/backend/src/tests/integration/erpclaud.integration.test.ts" "$TARGET_DIR/backend/src/tests/integration/erpclaud.integration.test.ts"

echo ""
echo "--- 3. Planificación por zonas (CRÍTICO, paso 4) ---"
copy_new_file "$DELTA_DIR/backend/src/modules/planning/zone-grouping.service.ts" "$TARGET_DIR/backend/src/modules/planning/zone-grouping.service.ts"
copy_new_file "$DELTA_DIR/backend/src/tests/zone-grouping.service.test.ts" "$TARGET_DIR/backend/src/tests/zone-grouping.service.test.ts"

echo ""
echo "--- 4. Tarifas: día dedicado (CRÍTICO, paso 5) ---"
flag_for_manual_merge "$DELTA_DIR/backend/src/modules/rates/rate-resolution.service.ts" "mergear computeFullTruckCost en tu servicio de tarifas ya existente"

echo ""
echo "--- 5. App Conductor: QR + checkpoint de carga (CRÍTICO, paso 6) ---"
copy_new_file "$DELTA_DIR/backend/src/modules/driver-app/vehicle-qr.service.ts" "$TARGET_DIR/backend/src/modules/driver-app/vehicle-qr.service.ts"
copy_new_file "$DELTA_DIR/backend/src/modules/driver-app/driver-app.routes.v1_1.ts" "$TARGET_DIR/backend/src/modules/driver-app/driver-app.routes.v1_1.ts"
flag_for_manual_merge "$DELTA_DIR/apps/app-conductor-patch/TodayRoutePage.patch.md" "aplicar sobre apps/app-conductor/src/pages/TodayRoutePage.tsx"
copy_new_file "$DELTA_DIR/apps/app-conductor-patch/pages/ScanVehicleQrPage.tsx" "$TARGET_DIR/apps/app-conductor/src/pages/ScanVehicleQrPage.tsx"
flag_for_manual_merge "$DELTA_DIR/apps/app-conductor-patch/api/driverApp.ts" "mergear en apps/app-conductor/src/api/driverApp.ts"

echo ""
echo "--- 6. Mapa sin coste - Leaflet (CRÍTICO, paso 7) ---"
copy_new_file "$DELTA_DIR/apps/backoffice-patch/PlannerMap.tsx" "$TARGET_DIR/apps/backoffice/src/components/planner/PlannerMap.tsx"

echo ""
echo "--- 7. Portal Cliente - app nueva completa (CRÍTICO, paso 8) ---"
if [ -d "$TARGET_DIR/apps/customer-portal" ]; then
  echo "  ↷ apps/customer-portal ya existe, no se sobrescribe"
else
  cp -r "$DELTA_DIR/apps/customer-portal" "$TARGET_DIR/apps/customer-portal"
  echo "  ✓ copiada app completa: apps/customer-portal"
fi
copy_new_file "$DELTA_DIR/backend/src/modules/customer-portal/customer-portal.routes.ts" "$TARGET_DIR/backend/src/modules/customer-portal/customer-portal.routes.ts"
copy_new_file "$DELTA_DIR/backend/src/middleware/requireCustomerPortal.ts" "$TARGET_DIR/backend/src/middleware/requireCustomerPortal.ts"

echo ""
echo "--- 8. CandidatesModal (CRÍTICO — bug heredado, desbloquea Planificador) ---"
copy_new_file "$DELTA_DIR/apps/backoffice-patch/components/CandidatesModal.tsx" "$TARGET_DIR/apps/backoffice/src/components/planner/CandidatesModal.tsx"
copy_new_file "$DELTA_DIR/backend/src/modules/optimization/optimization.simulations.routes.ts" "$TARGET_DIR/backend/src/modules/optimization/optimization.simulations.routes.ts"

echo ""
echo "--- 9. Registro de rutas y despliegue (CRÍTICO, pasos 9 y 11) ---"
flag_for_manual_merge "$DELTA_DIR/backend/src/app.routes.v1_1.snippet.ts" "añadir imports/app.use() a tu app.ts — SOLO las líneas del bloque crítico: erpclaud, driver-app, customer-portal, optimization, ver comentarios dentro del propio snippet"
copy_new_file "$DELTA_DIR/apps/customer-portal/Dockerfile" "$TARGET_DIR/apps/customer-portal/Dockerfile"
copy_new_file "$DELTA_DIR/apps/customer-portal/docker/nginx.conf" "$TARGET_DIR/apps/customer-portal/docker/nginx.conf"
flag_for_manual_merge "$DELTA_DIR/docker/docker-compose.customer-portal.patch.yml" "mergear en docker-compose.yml raíz"
flag_for_manual_merge "$DELTA_DIR/.github/workflows/ci-cd.customer-portal.patch.yml" "mergear en tu workflow de CI/CD"

echo ""
echo "--- 10. Despliegue GitHub + Firebase + Cloud Run (para la presentación) ---"
copy_new_file "$DELTA_DIR/deploy/firebase/firebase.json" "$TARGET_DIR/firebase.json"
copy_new_file "$DELTA_DIR/deploy/firebase/.firebaserc" "$TARGET_DIR/.firebaserc"
copy_new_file "$DELTA_DIR/deploy/github-actions/deploy.yml" "$TARGET_DIR/.github/workflows/deploy.yml"
echo "  ⚠ .firebaserc necesita tu projectId real — edítalo antes de desplegar"
echo "  ⚠ Sigue deploy/DEPLOY_GITHUB_FIREBASE.md paso a paso, no solo estos archivos"

echo ""
echo "=================================================================="
echo " RESUMEN"
echo "=================================================================="
echo ""
echo "Archivos copiados directamente: revisa el log de arriba (✓)."
echo ""
echo "Archivos que REQUIEREN tu revisión manual, dejados en:"
echo "  $MANUAL_MERGE_DIR/"
ls -1 "$MANUAL_MERGE_DIR" 2>/dev/null | sed 's/^/  - /'
echo ""
echo "Siguientes pasos MANUALES obligatorios (en este orden):"
echo "  1. Mergear schema.delta.prisma en backend/prisma/schema.prisma"
echo "     (SOLO los bloques §1-5 y §9, ignora el resto por ahora)"
echo "  2. cd backend && npx prisma db push"
echo "  3. Ejecutar backend/prisma/migrations_manual/v1_1_segmentation.sql"
echo "     contra tu BD (psql o cliente equivalente)"
echo "  4. Mergear rate-resolution.service.ts (computeFullTruckCost) en tu"
echo "     servicio de tarifas real"
echo "  5. Aplicar TodayRoutePage.patch.md sobre tu página real"
echo "  6. Mergear driverApp.ts (bindVehicleByQrToken, confirmShipmentLoad)"
echo "  7. Mergear app.routes.v1_1.snippet.ts en tu app.ts"
echo "  8. npm install en backend: (ver backend/NEW_DEPENDENCIES.md, solo"
echo "     express-rate-limit NO es crítico — puedes omitirlo por ahora)"
echo "  9. npm install en apps/customer-portal"
echo " 10. npm install leaflet react-leaflet en apps/backoffice"
echo " 11. npm install html5-qrcode en apps/app-conductor"
echo " 12. Mergear docker-compose.yml y workflow de CI/CD"
echo " 13. Ejecutar tests: npm test --workspace=backend"
echo " 14. bash $DELTA_DIR/smoke-test.sh <URL_BASE_BACKEND>"
echo ""
echo "Todo lo demás (GPS en vivo, modo offline, IA, KPIs avanzados...) es"
echo "DIFERIBLE — ver DEPLOYMENT_RUNBOOK.md. No lo apliques hasta después"
echo "del martes salvo que sobre tiempo."
echo "=================================================================="
