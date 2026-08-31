import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// El alias @/ debe declararse aquí, no solo en tsconfig.json — lección ya
// aprendida en backoffice/carrier-portal/app-conductor (ver memoria del proyecto).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5176,
    host: true,
  },
});
