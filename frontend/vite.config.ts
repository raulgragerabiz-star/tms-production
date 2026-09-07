import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// El alias @/ debe declararse aquí, no solo en tsconfig.json (tsconfig solo
// afecta al chequeo de tipos de tsc, no a cómo Rollup resuelve los imports al
// hacer el build) — misma lección ya aplicada en carrier-portal, driver-app y
// customer-portal, que a este archivo nunca le había llegado.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
  },
});
