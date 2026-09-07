import { defineConfig } from "vitest/config";
import path from "path";

// Config separada de los tests unitarios (vitest.config.ts): los de integración
// necesitan una base de datos Postgres real y se ejecutan en serie para evitar
// condiciones de carrera al truncar tablas entre tests.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.int.test.ts"],
    setupFiles: ["./tests/integration/setup.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
