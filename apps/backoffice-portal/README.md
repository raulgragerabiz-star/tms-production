# Parche de mapa — Backoffice (documento v1.1 §6)

1. Instalar dependencias:
   ```bash
   npm install leaflet react-leaflet --workspace=apps/backoffice
   npm install -D @types/leaflet --workspace=apps/backoffice
   npm uninstall @react-google-maps/api --workspace=apps/backoffice
   ```

2. Sustituir `apps/backoffice/src/components/planner/PlannerMap.tsx` por el
   fichero `PlannerMap.tsx` de esta carpeta.

3. Eliminar cualquier referencia a `VITE_GOOGLE_MAPS_API_KEY` de
   `apps/backoffice/.env` — ya no es necesaria.

4. El componente que consume `<PlannerMap />` (probablemente
   `PlannerPage.tsx`) no necesita cambios de props: se ha mantenido la
   misma interfaz (`stops`, `warehouseLat/Lng`, `onStopClick`) para que el
   reemplazo sea drop-in.

5. La secuenciación (vecino más próximo + 2-opt, Fase 8) ya funcionaba sobre
   distancia Haversine en el backend — no requiere cambios; solo deja de
   recibir corrección de tráfico en vivo de Google Directions (trade-off
   documentado y asumido en v1.1 §6/§9).
