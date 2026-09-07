// Se ejecuta antes de cargar cualquier test de integración: fuerza el uso de la base
// de datos de test (nunca la de desarrollo) apuntando DATABASE_URL a TEST_DATABASE_URL
// antes de que cualquier otro módulo (prisma, app) sea importado.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://tms:tms_password@localhost:5432/tms_test?schema=public";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test_secret";
process.env.NODE_ENV = "test";

import { beforeAll } from "vitest";
import { execSync } from "child_process";

beforeAll(() => {
  // Aplica el schema actual a la BD de test. Requiere que TEST_DATABASE_URL exista
  // y esté vacía/gestionada solo por estos tests (ver README, sección "Tests de integración").
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    env: { ...process.env },
    stdio: "inherit",
  });
});
