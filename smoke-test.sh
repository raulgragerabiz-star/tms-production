#!/usr/bin/env bash
# ============================================================================
# smoke-test.sh — Verificación rápida post-despliegue del bloque CRÍTICO.
# No sustituye a los tests automatizados (npm test); es un chequeo manual
# de "¿está vivo y responde razonablemente?" contra un entorno ya
# desplegado (Codespaces o el que sea), para usar el martes por la mañana
# antes de dar por cerrado el proyecto.
#
# USO:
#   bash smoke-test.sh https://tu-backend-4000.app.github.dev
#
# Requiere: curl, jq (opcional, para formatear salida)
# ============================================================================

set -uo pipefail

BASE_URL="${1:-http://localhost:4000}"
FAILURES=0

check() {
  local description="$1"
  local method="$2"
  local path="$3"
  local expected_status="$4"
  local extra_args="${5:-}"

  local status
  status=$(curl -s -o /tmp/smoke_response.json -w "%{http_code}" -X "$method" "$BASE_URL$path" $extra_args 2>/dev/null)

  if [ "$status" == "$expected_status" ]; then
    echo "  ✓ $description ($status)"
  else
    echo "  ✗ $description — esperado $expected_status, recibido $status"
    echo "    respuesta: $(cat /tmp/smoke_response.json 2>/dev/null | head -c 300)"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=================================================================="
echo " Smoke test — $BASE_URL"
echo "=================================================================="

echo ""
echo "--- Salud básica del backend ---"
check "Servidor responde" GET "/api/health" 200
# Si no tienes /api/health, cambia por cualquier endpoint público que ya
# existiera antes de este delta (ej. /api/auth/login con GET debería dar
# 404/405, no timeout — al menos confirma que el proceso está vivo).

echo ""
echo "--- Bridge ERP (crítico, paso 3) ---"
check "Rechaza payload inválido con 400" POST "/api/integrations/erpclaud/import-orders" 400 \
  '-H "Content-Type: application/json" -H "Authorization: Bearer TEST_TOKEN" -d "{\"schemaVersion\":\"1.0\",\"pedidos\":[]}"'
echo "    (nota: sustituye TEST_TOKEN por un token real de un usuario interno para probar el flujo completo)"

echo ""
echo "--- Optimización / CandidatesModal (crítico) ---"
check "Endpoint de simulaciones existe (esperado 401 sin token, no 404)" GET "/api/optimization/summary/00000000-0000-0000-0000-000000000000" 401

echo ""
echo "--- Portal Cliente (crítico, paso 8) ---"
check "Rutas del portal cliente montadas (esperado 401 sin token, no 404)" GET "/api/customer-portal/orders" 401

echo ""
echo "--- App Conductor: QR (crítico, paso 6) ---"
check "Endpoint bind-vehicle montado (esperado 401/400, no 404)" POST "/api/driver-app/session/bind-vehicle" 401

echo ""
echo "=================================================================="
if [ "$FAILURES" -eq 0 ]; then
  echo " ✅ Todo lo crítico responde como se espera."
else
  echo " ⚠️  $FAILURES comprobación(es) fallaron — revisar antes de dar por cerrado."
fi
echo "=================================================================="

echo ""
echo "Comprobaciones MANUALES adicionales (no automatizables desde aquí):"
echo "  [ ] Login en las 4 apps (backoffice, carrier-portal, driver-app, customer-portal)"
echo "  [ ] Crear un pedido de prueba y verlo clasificado por segmento"
echo "  [ ] Planificar una ruta, abrir el comparador (CandidatesModal), asignar"
echo "  [ ] Ver el mapa del Planificador cargando tiles de OpenStreetMap (sin errores de consola)"
echo "  [ ] Escanear un QR de vehículo de prueba desde la App Conductor"
echo "  [ ] Confirmar carga desde la App Conductor"
echo "  [ ] Ver un pedido en el Portal Cliente con su timeline de estado"

exit $FAILURES
