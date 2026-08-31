# Parche de Seguimiento en vivo — Backoffice (Pantalla 6, GPS en vivo)

1. Instalar dependencia:
   ```bash
   npm install socket.io-client --workspace=apps/backoffice
   ```

2. Copiar `socketClient.ts` a `apps/backoffice/src/realtime/socketClient.ts`
   — ajustar la clave de `localStorage` del token al nombre real que ya usa
   el backoffice (probablemente distinto de `backoffice_token`, revisar
   `api/client.ts` existente).

3. Copiar `LiveTrackingMap.tsx` a
   `apps/backoffice/src/components/tracking/LiveTrackingMap.tsx`.

4. Sustituir el mapa placeholder de la Pantalla 6 (Seguimiento) por
   `<LiveTrackingMap warehouseId={...} warehouseLat={...} warehouseLng={...} onSelectShipment={...} />`.
   El panel lateral "master-detail" con el timeline de eventos del envío
   seleccionado (ya descrito en 06-diseno-ux-TMS.md) se implementa
   reutilizando el mismo patrón de `OrderDetailPage` del Portal Cliente
   (timeline de checkpoints), pero consultando `GET /shipments/:id/tracking-events`
   (ya existente vía `tracking_event`, sin necesidad de endpoint nuevo).

5. El widget "Vehículos activos ahora mismo" del Dashboard (07-dashboard-TMS.md,
   zona "En curso") puede reutilizar `useEffect` + `getSocket().on("position_update", ...)`
   igual que este componente, sin necesidad de renderizar el mapa completo
   — solo contar `Object.keys(positions).length`.
