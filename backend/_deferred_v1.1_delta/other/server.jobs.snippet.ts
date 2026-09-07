// ============================================================================
// Añadir en tu server.ts / index.ts (entrypoint del backend), DESPUÉS de
// que el servidor Express ya esté escuchando — no bloquea el arranque del
// API si algún job falla al registrarse.
// ============================================================================

import { startScheduledJobs } from "./jobs/scheduler";

// ...

const server = app.listen(PORT, () => {
  console.log(`Backend escuchando en :${PORT}`);
  startScheduledJobs();
});

// Variables de entorno relevantes (todas opcionales, con default sensato):
//   QR_TOKEN_CLEANUP_CRON="0 3 * * *"           # 03:00 cada día
//   QR_TOKEN_CLEANUP_RETENTION_DAYS=30
//   DISABLE_SCHEDULED_JOBS=true                  # útil en tests/CI para no
//                                                 # dejar cron colgado tras
//                                                 # los tests
//   ERPCLAUD_RATE_LIMIT_WINDOW_MS=60000
//   ERPCLAUD_RATE_LIMIT_MAX_PER_IP=30
//   ERPCLAUD_RATE_LIMIT_MAX_PER_COMPANY=60
