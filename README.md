# TMS — Delta v1.1

⚠️ **DEADLINE: martes 01/09/2026.** Lee primero `DEPLOYMENT_RUNBOOK.md`,
no este checklist — el runbook triagea qué es CRÍTICO para el deadline y
qué es DIFERIBLE (todo lo de Inteligencia/IA, KPIs avanzados, GPS en vivo,
modo offline, etc. son mejoras posteriores a MVP, no bloquean el martes).

Incluye `apply-delta.sh` (automatiza la copia del bloque crítico contra tu
repo) y `smoke-test.sh` (verificación rápida post-despliegue).

---

Implementación de código de los 7 deltas descritos en
`v1_1-integracion-erp-planificacion-automatica.md`, aditivos sobre el
dominio congelado v1.0. Ningún módulo existente se reescribe salvo donde se
indica explícitamente "patch"/"parche".

## Orden de aplicación recomendado (coincide con §8 del documento: 1 y 2 bloqueantes)

### 1. Base de datos (bloqueante)
- [ ] Mergear `backend/prisma/schema.delta.prisma` en tu `schema.prisma`.
- [ ] `npx prisma db push` (seguimos usando `db push`, no `migrate deploy`,
      coherente con la decisión ya tomada en Codespaces).
- [ ] Ejecutar `backend/prisma/migrations_manual/v1_1_segmentation.sql`
      contra la base de datos (migración de `serviceType` 2→4 valores +
      seed de `service_segmentation_rule`).

### 2. Segmentación (bloqueante)
- [ ] Copiar `backend/src/modules/segmentation/` completo.
- [ ] Copiar `backend/src/tests/segmentation.service.test.ts`.
- [ ] `npm test -- segmentation` para verificar.

### 3. Integración ERP (`erpclaud`)
- [ ] Copiar `backend/src/modules/integrations/erpclaud/` completo.
- [ ] Ajustar el import de `resolveOrCreateCustomer` al path real de tu
      `wms-bridge.service.ts` si difiere.
- [ ] Registrar la ruta: ver `backend/src/app.routes.v1_1.snippet.ts`.

### 4. Planificación automática (zonas + compatibleSegments)
- [ ] Copiar `backend/src/modules/planning/zone-grouping.service.ts` y su test.
- [ ] Integrar `groupOrdersIntoZones()` como paso previo a la secuenciación
      ya existente en el motor de optimización (Fase 8).
- [ ] Integrar `isVehicleTypeCompatibleWithSegment()` en la capa de
      generación de candidatos ya existente.

### 5. Tarifas — modo día dedicado
- [ ] Mergear la lógica de `backend/src/modules/rates/rate-resolution.service.ts`
      (función `computeFullTruckCost`) en tu servicio de tarifas ya
      existente, sustituyendo solo el cálculo de `full_truck_rate`.

### 6. App Conductor — QR + checkpoint de carga
- [ ] Copiar `backend/src/modules/driver-app/vehicle-qr.service.ts` y
      `driver-app.routes.v1_1.ts`.
- [ ] Registrar el router adicional: ver snippet de app.routes.
- [ ] Aplicar `apps/app-conductor-patch/TodayRoutePage.patch.md` sobre tu
      `TodayRoutePage.tsx` ya existente.
- [ ] Copiar `apps/app-conductor-patch/pages/ScanVehicleQrPage.tsx` a
      `apps/app-conductor/src/pages/`.
- [ ] Copiar `apps/app-conductor-patch/api/driverApp.ts` (mergear con el
      api client existente).
- [ ] `npm install html5-qrcode --workspace=apps/app-conductor`.

### 7. Mapa sin coste (Backoffice)
- [ ] Seguir `apps/backoffice-patch/README.md`.

### 8. Portal Cliente (nuevo, no bloqueante)
- [ ] Copiar `backend/src/modules/customer-portal/` y
      `backend/src/middleware/requireCustomerPortal.ts`.
- [ ] Registrar ruta: ver snippet de app.routes.
- [ ] Copiar la carpeta `apps/customer-portal/` completa a la raíz del
      monorepo, junto a `backoffice/`, `carrier-portal/`, `app-conductor/`.
- [ ] `npm install` dentro de `apps/customer-portal`.
- [ ] Añadir el script `dev` de `customer-portal` al `package.json` raíz /
      `docker-compose` / configuración de puertos de Codespaces (puerto
      **5176**, marcarlo como **Public** en la pestaña Ports, igual que se
      hizo con el 4000).
- [ ] Añadir el origen CORS del nuevo puerto en el backend.

## Qué falta decidir (no bloqueante, ver §9 del documento original)
1. Calibrar los umbrales de `service_segmentation_rule` (§2.2) contra
   pedidos reales antes de usarlos para facturar.
2. Confirmar si el ETA sin tráfico en vivo (tras quitar Google Directions)
   es aceptable para el Portal Cliente, o si conviene autoalojar OSRM más
   adelante.

### 14. GPS en vivo (Versión 1 del roadmap)
- [ ] `npm install socket.io --workspace=backend`.
- [ ] Copiar `backend/src/realtime/socket-server.ts` y
      `backend/src/modules/tracking/` completo (`tracking.service.ts`,
      `tracking.routes.ts`).
- [ ] Mergear `backend/src/server.realtime.snippet.ts` en tu entrypoint —
      **cambia `app.listen` por `http.createServer(app)` + `httpServer.listen`**,
      Socket.io lo necesita.
- [ ] Añadir a `TrackingEvent` el campo `clientEventId` + índice único
      compuesto `(shipmentId, clientEventId)` (ver §7 en `schema.delta.prisma`)
      y ejecutar `prisma db push`.
- [ ] Copiar `backend/src/tests/integration/tracking.idempotency.test.ts`.

### 15. Modo offline — App Conductor
- [ ] Copiar `apps/app-conductor-patch/offline/` completo
      (`offlineQueue.ts`, `gpsTracker.ts`, `useOfflineSync.ts`) a
      `apps/app-conductor/src/offline/`.
- [ ] Copiar `apps/app-conductor-patch/components/OfflineBanner.tsx` a
      `apps/app-conductor/src/components/`.
- [ ] Actualizar `apps/app-conductor/src/api/driverApp.ts` con la versión
      de `apps/app-conductor-patch/api/driverApp.ts` de esta pasada —
      **sustituye por completo la del paso 6**, `confirmShipmentLoad` deja
      de ser async.
- [ ] Aplicar los bloques 0/0.1/0.2 (nuevos) de
      `TodayRoutePage.patch.md` — **no aplicar el bloque 2 antiguo**, queda
      marcado como sustituido en el propio fichero.
- [ ] Verificar permisos de geolocalización en el manifest/HTML de la app
      (requiere HTTPS o localhost — Codespaces ya sirve por HTTPS, así que
      no requiere cambios adicionales).

### 16. Mapa de Seguimiento en vivo — Backoffice (Pantalla 6)
- [ ] Seguir `apps/backoffice-patch/tracking/README.md`.
- [ ] Copiar `socketClient.ts` y `LiveTrackingMap.tsx`.
- [ ] Sustituir el placeholder de la Pantalla 6 ya existente.

### 17. Motor de tarifas avanzado — suplementos (Versión 2 del roadmap)
- [ ] Mergear en `schema.delta.prisma` §9: `HolidayCalendar`,
      `FuelIndexReading`, y los campos aditivos en `RateSurcharge`
      (`baselineValue`, `franchiseMinutes`), `Order.requiresAdr`,
      `Shipment.waitingMinutes`/`tollAmountActual`.
- [ ] `npx prisma db push` + ejecutar
      `backend/prisma/migrations_manual/v1_1_advanced_rates.sql` (seed de
      festivos nacionales 2026 e índice de combustible de ejemplo — **ajustar
      a datos reales antes de usar en producción**, ver "Qué falta decidir").
- [ ] Copiar `backend/src/modules/rates/holiday-calendar.service.ts` y
      `backend/src/modules/rates/surcharge.service.ts`.
- [ ] Mergear las funciones nuevas de
      `backend/src/modules/rates/rate-resolution.service.ts`
      (`computePalletCost`, `computeFinalRouteCost`) en tu servicio de
      tarifas — **`computeFinalRouteCost` es ahora el único punto de
      entrada** que debe llamar tanto el motor de optimización
      (`cost_simulation`) como el cierre de shipment (`settlement_line`),
      para que el importe mostrado al planificador y el liquidado
      coincidan siempre.
- [ ] Copiar `backend/src/tests/surcharge.service.test.ts`.

### 18. Portal Transportista — disputas de liquidación
- [ ] Copiar `backend/src/modules/settlement/settlement-dispute.routes.ts`
      y registrar (ver snippet de app.routes).
- [ ] Añadir a `SettlementLine` (schema §10): `status`, `disputeComment`,
      `disputedAt`, `disputedBy` + enum `SettlementLineStatus`.
- [ ] Copiar `apps/carrier-portal-patch/DisputeSettlementLineButton.tsx` a
      `apps/carrier-portal/src/components/` y engancharlo en la tabla de
      líneas de la pantalla de Liquidaciones del portal.
- [ ] Añadir en el backoffice (Facturación/Liquidaciones, Fase 5 Pantalla 11)
      la acción "Resolver disputa" contra
      `PATCH /api/internal/settlement-lines/:id/resolve-dispute`.

### 19. Portal Transportista — chat por envío
- [ ] Añadir modelo `ShipmentMessage` (schema §10).
- [ ] Copiar `backend/src/modules/chat/shipment-chat.routes.ts` y registrar.
- [ ] `broadcastShipmentMessage` ya añadido a
      `backend/src/realtime/socket-server.ts` en esta misma pasada — si ya
      tenías el fichero copiado de una pasada anterior, vuelve a copiarlo,
      ha cambiado (nuevas rooms `shipment:*`).
- [ ] Copiar `apps/carrier-portal-patch/ShipmentChatPanel.tsx` a
      `apps/carrier-portal/src/components/` y una copia gemela en
      `apps/backoffice/src/components/shipments/` (ajustar el prefijo de
      URL como se indica en el propio fichero).
- [ ] Requiere `socketClient.ts` también en `carrier-portal` (mismo patrón
      que el ya creado para backoffice en el paso 16 — copiar y ajustar la
      clave de `localStorage` del token del portal transportista).

## Qué falta decidir (ampliado)
3. El seed de `holiday_calendar` y `fuel_index_reading` de este paso son
   **datos de ejemplo**, no reales — hay que sustituir el calendario por el
   oficial de cada año/provincia relevante, y decidir si `fuel_index_reading`
   se alimenta a mano periódicamente o se automatiza contra una fuente
   oficial (`source = 'cores_api'`, no implementado, solo el campo
   preparado).
4. `computeFinalRouteCost` asume que TODOS los `rate_surcharge` de un
   transportista aplican a todas sus rutas; si en el futuro se necesita
   activar/desactivar suplementos por ruta o por cliente concreto, hace
   falta una tabla de excepciones — no bloqueante para el alcance actual.

### 20. Optimización de recursos (backend + batería móvil)
Ver `OPTIMIZATIONS.md` para el detalle completo con impacto medible de
cada punto. Resumen de ficheros a re-copiar (ya optimizados respecto a
pasadas anteriores — **si ya habías aplicado este delta antes de esta
pasada, vuelve a copiar estos ficheros, han cambiado**):

- [ ] `backend/src/lib/memory-cache.ts` (nuevo).
- [ ] `backend/src/modules/segmentation/segmentation.service.ts`
      (añade `getActiveSegmentationRules` cacheado; `classifyOrder` ahora
      acepta reglas precargadas opcionales).
- [ ] `backend/src/modules/integrations/erpclaud/erpclaud.service.ts`
      (precarga de productos y reglas fuera del bucle, `createMany` para
      líneas).
- [ ] `backend/src/modules/tracking/tracking.service.ts` (`createMany` con
      `skipDuplicates` para la ingesta GPS).
- [ ] `backend/src/modules/planning/zone-grouping.service.ts` (índice de
      rejilla) + `backend/src/tests/zone-grouping.service.test.ts`
      (3 tests nuevos que verifican que el grid agrupa igual de bien que
      el barrido exhaustivo, incluidos los casos de borde de celda).
- [ ] `backend/src/jobs/cleanup-vehicle-qr-tokens.job.ts` (borrado en
      lotes) — nueva variable de entorno opcional
      `QR_TOKEN_CLEANUP_BATCH_SIZE` (default 1000).
- [ ] `backend/src/jobs/scheduler.ts` (omite `audit_log` si el job no tuvo
      efecto).
- [ ] Añadir a `schema.delta.prisma` §11: índice compuesto en `Order`
      (`companyId, externalSourceSystem, externalOrderId`) — `prisma db push`.
- [ ] `apps/app-conductor-patch/offline/useOfflineSync.ts` (polling
      adaptativo + pausa en segundo plano) — **sustituye por completo** la
      versión de la pasada 2.

## Estado final tras esta pasada
Todo lo construido en las pasadas 1-4 queda revisado por consumo de
recursos: BD (menos queries, menos locks, índices donde faltaban), y
batería del dispositivo móvil (polling adaptativo). Ningún comportamiento
funcional cambia — mismos resultados, mismos tests en verde, menos coste
para conseguirlos.

### 21. KPIs/BI ampliado (17-kpis-bi-TMS.md)
- [ ] `npm install exceljs pdfkit nodemailer cron-parser` +
      `npm install -D @types/pdfkit @types/nodemailer` en `backend`.
- [ ] Añadir a `schema.delta.prisma` §12 (columnas de distancia en
      `Route`) y §13 (`ScheduledReport`) — `npx prisma db push`.
- [ ] Ejecutar
      `backend/prisma/migrations_manual/v1_1_kpi_materialized_view.sql`
      — **revisar antes los nombres de columna/tabla asumidos** (marcados
      en el propio SQL), pueden diferir ligeramente de tu schema real.
- [ ] Copiar `backend/src/modules/kpi/` completo (`kpi.service.ts`,
      `kpi.routes.ts`, `kpi-export.service.ts`, `kpi-export.routes.ts`).
- [ ] Copiar `backend/src/modules/reports/scheduled-reports.routes.ts`.
- [ ] Copiar `backend/src/lib/mailer.ts` — configurar
      `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASSWORD`/`SMTP_FROM`; sin
      ellas, los informes se generan pero no se envían (se loguea un aviso,
      no falla el job).
- [ ] Copiar `backend/src/jobs/refresh-kpi-views.job.ts` y
      `backend/src/jobs/dispatch-scheduled-reports.job.ts`; ya registrados
      en `scheduler.ts` de este mismo delta (refresco de vista cada hora,
      dispatcher de informes cada 15 min — ambos configurables por env:
      `KPI_REFRESH_CRON`, `SCHEDULED_REPORTS_DISPATCH_CRON`).
- [ ] Registrar rutas: ver snippet de app.routes (`/api/kpis`,
      `/api/scheduled-reports`).
- [ ] Copiar `backend/src/tests/kpi.service.test.ts`.
- [ ] Copiar `apps/backoffice-patch/kpi/ReportsPage.tsx` a
      `apps/backoffice/src/pages/` — sustituye el placeholder de la
      Pantalla 12.

## Qué falta decidir (ampliado — pasada 5)
5. **PDF sin headless browser (`pdfkit`)**: el layout es tabular simple
   (cabecera + filas), suficiente para el caso de uso de exportación de
   KPIs. Si en el futuro se necesita un informe con diseño más elaborado
   (logos, gráficos embebidos), hay que decidir entre invertir más en
   `pdfkit` (dibujo programático) o aceptar el coste de un headless
   browser — no bloqueante ahora.
6. **Ventana fija de 30 días en los informes programados**
   (`dispatch-scheduled-reports.job.ts`): no configurable por informe
   todavía — todos los informes programados resumen "los últimos 30 días"
   en el momento del envío. Añadir `windowDays` a `ScheduledReport` es
   trivial si se necesita, se dejó fuera para no sobre-diseñar antes de
   validar el patrón con el primer informe real.
7. La vista materializada asume `distance_planned_km`/`distance_real_km`
   ya pobladas en `Route` — si no se rellenan desde el motor de
   optimización (planificado) y desde `tracking_event` (real, al cerrar
   el shipment), esas dos métricas devolverán NULL sin romper el resto.

## Siguiente paso automático
Con KPIs/BI ampliado cerrado, Versión 2 del roadmap
(18-roadmap-desarrollo-TMS.md) queda completa.

### 22. Inteligencia — Predicción de ETA calibrada (Versión 3)
- [ ] Añadir a `schema.delta.prisma` §14: `RouteSpeedCalibration` —
      `npx prisma db push`.
- [ ] Copiar `backend/src/jobs/calibrate-route-speeds.job.ts` (ya
      registrado en `scheduler.ts`, 02:30 cada día, antes del refresco de
      KPIs de las 03:00... revisar: el refresco de KPIs está a la hora en
      punto cada hora, `03:00` es solo una de sus ejecuciones — no hay
      conflicto real de orden, pero conviene que la calibración corra
      antes del pico de consultas de la mañana).
- [ ] Copiar `backend/src/modules/intelligence/eta-prediction.service.ts`.
- [ ] Volver a copiar `backend/src/modules/tracking/tracking.service.ts`
      — **ha cambiado** respecto a la pasada 4: `computeNextStopEta` ahora
      usa la velocidad calibrada en vez del valor fijo `35 km/h`.
- [ ] Volver a copiar `backend/src/realtime/socket-server.ts` — el tipo
      `PositionUpdatePayload.nextStop` ganó el campo opcional `etaSource`.
- [ ] Copiar `backend/src/tests/eta-prediction.service.test.ts`.
- [ ] Actualizar `apps/backoffice-patch/tracking/LiveTrackingMap.tsx` (ya
      incluido en esta pasada) — el popup ahora distingue "calibrado con
      histórico real" de "estimación genérica".

### 23. Inteligencia — Detección de anomalías (Versión 3)
- [ ] Añadir a `schema.delta.prisma` §15: `AnomalyType`, `AnomalySeverity`,
      `AnomalyStatus`, `AnomalyAlert` — `npx prisma db push`.
- [ ] Copiar `backend/src/modules/intelligence/anomaly-detection.service.ts`
      y `backend/src/modules/intelligence/anomaly.routes.ts`.
- [ ] Copiar `backend/src/jobs/run-anomaly-detection.job.ts` (ya
      registrado en `scheduler.ts`, 04:00 cada día).
- [ ] Registrar ruta: ver snippet de app.routes (`/api/anomalies`).
- [ ] Copiar `backend/src/tests/anomaly-detection.service.test.ts`.
- [ ] Copiar `apps/backoffice-patch/intelligence/AnomalyAlertsWidget.tsx`
      a `apps/backoffice/src/components/dashboard/` y montarlo en la zona
      "Atención" del Dashboard (07-dashboard-TMS.md), junto al listado de
      incidencias ya existente.

## Qué falta decidir (ampliado — pasada 6)
8. Los 3 detectores de anomalías comparan siempre contra el histórico del
   **mismo transportista/cliente** (nunca contra un umbral global fijo) —
   correcto para no generar falsos positivos con clientes/transportistas
   de perfil muy distinto entre sí, pero significa que un transportista o
   cliente completamente nuevo (sin histórico) no genera alertas hasta
   acumular `MIN_HISTORICAL_SAMPLES`/`MIN_COMPARABLE_SAMPLES` (5, config
   en el propio código) — comportamiento deliberado, no bug.
9. La calibración de velocidad (`calibrate-route-speeds.job.ts`) requiere
   al menos 5 tramos GPS por combinación transportista+provincia+hora para
   confiar en el dato — con poco volumen de tracking_event acumulado
   (proyecto recién lanzado), la mayoría de ETAs seguirán usando el
   fallback estático hasta que se acumule suficiente histórico. Esto es
   exactamente lo que anticipa el documento de IA: "el MVP debe lanzar
   estas capacidades en modo heurístico... y migrar... a medida que se
   acumule suficiente histórico real".

## Estado final del proyecto tras esta pasada
Versión 3 del roadmap (Inteligencia) tiene sus dos primeras capacidades
construidas: Predicción de ETA y Detección de anomalías, ambas en modo
heurístico/basado en reglas, ambas degradándose de forma segura cuando no
hay histórico suficiente, y ninguna tomando decisiones automáticas —
siempre alertas o estimaciones para revisión/consulta humana, coherente
con el principio rector fijado en 16-inteligencia-artificial-TMS.md.

Quedan sin implementar de Versión 3: Predicción de demanda, Optimización
automática (opt-in), Detección de rutas ineficientes (distinta de la
ocupación baja ya cubierta) y el Asistente conversacional/copiloto — y de
Versión Enterprise, todo su alcance. Ambas quedan como siguiente bloque de
trabajo natural si se continúa.

## Siguiente paso automático (continuación)
Salvo indicación contraria, continúo con **Predicción de demanda**
(volumen de pedidos por zona/fecha, documento: "reutiliza el enfoque de
percentiles ya presente en tms_getafe.html como punto de partida") — es la
pieza que más valor aporta a la Planificación (permite anticipar necesidad
de capacidad de flota) y, a diferencia del copiloto conversacional, no
requiere decisiones de producto adicionales (qué preguntas soporta, qué
tono, etc.) para arrancar la implementación.

### 24. Inteligencia — Predicción de demanda (Versión 3)
- [ ] Añadir a `schema.delta.prisma` §16: `DemandForecast` —
      `npx prisma db push`.
- [ ] Copiar `backend/src/modules/intelligence/demand-forecast.service.ts`
      y `backend/src/modules/intelligence/demand-forecast.routes.ts`.
- [ ] Copiar `backend/src/jobs/precompute-demand-forecast.job.ts` (ya
      registrado en `scheduler.ts`, 05:00 cada día — después de la
      calibración de velocidad y la detección de anomalías, mismo bloque
      nocturno).
- [ ] Registrar ruta: ver snippet de app.routes (`/api/demand-forecast`).
- [ ] Copiar `backend/src/tests/demand-forecast.service.test.ts`.
- [ ] Copiar `apps/backoffice-patch/planner/DemandForecastWidget.tsx` a
      `apps/backoffice/src/components/planner/` y montarlo en la Pantalla 4
      (Planificador, 08-planificador-rutas-TMS.md) — panel colapsable
      junto al lienzo de rutas, pasándole el `warehouseId` activo.

## Qué falta decidir (ampliado — pasada 7)
10. El pronóstico se calcula por **provincia**, no por el clúster
    geográfico más fino ya usado en `zone-grouping.service.ts` — es una
    decisión deliberada: el histórico de pedidos por clúster geográfico
    concreto es demasiado disperso para dar una muestra fiable de 12
    semanas, mientras que por provincia sí acumula volumen suficiente. Si
    en el futuro se necesita más granularidad, habría que evaluar reducir
    `HISTORICAL_WEEKS` o agrupar por una zona intermedia (código postal a
    2 dígitos, por ejemplo) — no bloqueante ahora.
11. `precomputeDemandForecasts` recorre TODAS las combinaciones
    almacén+provincia con actividad en los últimos 90 días, sea cual sea
    su volumen — para una empresa con actividad en las 41
    provincias/países ya vistas en el Excel origen (Fase 1), esto son
    hasta 41 × 14 días = 574 filas por empresa cada noche, asumible sin
    optimización adicional al volumen actual del proyecto.

## Estado final del proyecto tras esta pasada
Versión 3 del roadmap tiene ya 3 de sus 4 capacidades explícitamente
mencionadas: Predicción de ETA, Detección de anomalías, y Predicción de
demanda — todas en modo heurístico, todas degradándose de forma segura sin
histórico suficiente, ninguna tomando decisiones automáticas. Queda
Optimización automática (opt-in) como única capacidad de Versión 3 sin
construir, más Detección de rutas ineficientes (variante de la ocupación
baja ya cubierta, pero centrada en desviación de distancia planificada vs.
real — la columna `distance_real_km` de la pasada 5 ya la deja preparada)
y el Asistente conversacional.

## Siguiente paso automático (continuación)
Salvo indicación contraria, continúo con **Detección de rutas
ineficientes** por desviación de distancia (reutiliza directamente
`distance_planned_km`/`distance_real_km` ya presentes en
`mv_kpi_shipment_facts` desde la pasada 5 — ampliación natural y de bajo
esfuerzo del detector de anomalías ya construido, antes de abordar
Optimización automática, que sí requiere una decisión de producto previa
(qué umbral de confianza activa la asignación sin intervención humana).

### 25. Inteligencia — Detección de rutas ineficientes (4º detector)
- [ ] Añadir `inefficient_route_distance` al enum `AnomalyType` en
      `schema.delta.prisma` §15 (ya actualizado en esta pasada) —
      `npx prisma db push`.
- [ ] Volver a copiar
      `backend/src/modules/intelligence/anomaly-detection.service.ts` —
      **ha cambiado sustancialmente** respecto a la pasada 6: nueva
      función pura `detectInefficientRouteDistance`, nuevo orquestador
      `detectAndPersistRouteDistanceAnomalies`, y `runAnomalyDetection`
      ahora devuelve también `distanceAnomalies`.
- [ ] Volver a copiar `backend/src/jobs/run-anomaly-detection.job.ts` —
      ha cambiado (suma el nuevo campo `distanceAnomalies`).
- [ ] Volver a copiar `backend/src/tests/anomaly-detection.service.test.ts`
      — 5 tests nuevos para el 4º detector, incluido el caso explícito de
      que un AHORRO de distancia (real < planificada) nunca genera alerta.
- [ ] Volver a copiar
      `apps/backoffice-patch/intelligence/AnomalyAlertsWidget.tsx` —
      etiqueta nueva para el tipo de alerta.
- [ ] No requiere nuevo job ni nueva ruta — reutiliza por completo
      `run-anomaly-detection.job.ts` y `/api/anomalies` ya existentes
      (paso 23), coherente con el propio diseño del orquestador.

## Estado final del proyecto tras esta pasada
Versión 3 del roadmap tiene ya 3 de sus 4 capacidades mencionadas
explícitamente completas, con Detección de anomalías ahora cubriendo los
4 patrones que el documento original agrupaba bajo "Detección de
anomalías" + "Detección de rutas ineficientes" (que en el documento son
capacidades distintas pero comparten exactamente el mismo mecanismo:
alerta por patrón sostenido, revisión humana, nunca corrección
automática — de ahí que se hayan implementado como un único módulo con 4
detectores en vez de dos módulos separados).

Queda **Optimización automática (opt-in)** como única capacidad de
Versión 3 sin construir, y el Asistente conversacional/copiloto (marcado
en el documento como la capacidad de mayor coste de decisión de producto,
no solo de código).

## Siguiente paso automático (continuación)
Salvo indicación contraria, el siguiente bloque natural es **Optimización
automática (opt-in)**: extensión del motor de optimización ya existente
(Fase 8) para que, en clientes que lo habiliten explícitamente, el sistema
asigne transportista/vehículo automáticamente cuando la confianza supere
un umbral configurable y no haya restricciones duras en conflicto —
requiere definir primero qué "confianza" significa en un motor que hoy es
puramente de coste (no probabilístico), así que antes de escribir código
convendría acordar contigo la señal de confianza a usar (ej. combinación
de coste-mínimo + ausencia de alertas de anomalía recientes para ese
transportista + histórico de aceptación de rutas similares) en vez de
asumirlo unilateralmente.

### 26. Inteligencia — Optimización automática opt-in (Versión 3, cierre)
Criterio acordado: "el más óptimo para compensar distancias y economía en
base a características de pedido" — no es un simple ranking por coste
mínimo, sino una puntuación ponderada que se adapta al pedido:

| Característica del pedido | Efecto en la ponderación |
|---|---|
| Urgente (leadTimeDays ≤ 1) | Prioriza fiabilidad de distancia del transportista sobre el precio |
| Gran volumen / camión completo | Prioriza economía — el vehículo ya es dedicado |
| Resto (paletería estándar) | Equilibrado 50/30/20 (coste/distancia/ocupación) |
| Requiere ADR | Duplica el peso de las alertas de anomalía recientes de ese transportista |

Nunca auto-asigna si: la empresa no lo ha activado explícitamente (opt-in,
`autoAssignEnabled = false` por defecto), la confianza del mejor candidato
no alcanza el umbral configurado por la empresa, o el mejor y el segundo
mejor candidato están casi empatados (margen mínimo del 5%) — en ambos
casos la ruta queda igual que hoy, pendiente de decisión manual.

- [ ] Añadir a `schema.delta.prisma` §17: `Company.autoAssignEnabled` y
      `Company.autoAssignMinConfidence` — `npx prisma db push`.
- [ ] Copiar `backend/src/modules/intelligence/auto-optimization.service.ts`
      (motor de puntuación puro) y
      `backend/src/modules/intelligence/auto-optimization.orchestrator.ts`
      (trae datos reales, aplica la puntuación, ejecuta la asignación).
- [ ] Copiar `backend/src/modules/intelligence/company-settings.routes.ts`
      y registrar (ver snippet de app.routes: `/api/company/settings/auto-assign`).
- [ ] Seguir `backend/src/optimization.hook.snippet.ts` — **único punto de
      integración manual de esta pasada**: añadir una línea al final de tu
      controller de optimización ya existente, justo después de que la
      ruta quede en `optimized` con sus `cost_simulation` generados. Si no
      se aplica este paso, todo lo demás queda construido pero inactivo
      (nunca se auto-asigna nada).
- [ ] Copiar `backend/src/tests/auto-optimization.service.test.ts` — 11
      tests que verifican la adaptación de pesos por característica del
      pedido, la penalización por anomalías (y su duplicado con ADR), y
      que nunca auto-asigna en empates o por debajo del umbral.
- [ ] Volver a copiar
      `backend/src/modules/optimization/optimization.simulations.routes.ts`
      — el endpoint `/summary/:routeId` ahora también devuelve
      `autoAssigned`/`confidence`, consultando el último `audit_log` de la
      ruta.
- [ ] Volver a copiar `apps/backoffice-patch/components/CandidatesModal.tsx`
      — banner nuevo: "Esta ruta fue asignada automáticamente (confianza
      X%)" cuando aplica, con opción de reasignar manualmente sin fricción.
- [ ] Copiar `apps/backoffice-patch/settings/AutoAssignSettingsPanel.tsx`
      a `apps/backoffice/src/components/settings/` y montarlo en
      Configuración (Fase 5, Pantalla 13) — incluye el toggle, el slider
      de confianza mínima, y una explicación en lenguaje natural de qué
      hace antes de que el usuario lo active.

## Qué falta decidir (ampliado — pasada 8)
12. Los pesos de ponderación (`getWeightProfile`) y los umbrales de
    penalización por anomalías son valores fijos en código, no
    configurables por empresa todavía — a diferencia de
    `autoAssignMinConfidence`, que sí lo es. Si tras el primer mes de uso
    real se necesita ajustar el equilibrio coste/distancia por tipo de
    negocio, hay que exponerlos como configuración — no bloqueante ahora,
    mejor validar el criterio acordado con datos reales antes de
    parametrizarlo más.
13. `autoAssignRouteIfEligible` recalcula la fiabilidad de distancia por
    transportista con una query directa en cada llamada, en vez de
    reutilizar `mv_kpi_shipment_facts` (que ya tiene distancia
    planificada/real) — deliberado: la vista se refresca solo cada hora
    (pasada 5), y la auto-asignación necesita el dato más fresco posible
    en el momento de decidir. Es una pequeña excepción al criterio general
    de "agregar en BD, no recalcular" fijado en la pasada de optimización
    de recursos, justificada por la naturaleza síncrona de esta decisión.

## Estado final del proyecto tras esta pasada
Versión 3 del roadmap (Inteligencia) queda completa en sus 4 capacidades
explícitamente mencionadas en el documento original que tenían sentido de
implementar ya (Predicción de ETA, Detección de anomalías/rutas
ineficientes, Predicción de demanda, Optimización automática opt-in).
Queda fuera el Asistente conversacional/copiloto, marcado desde el inicio
como la pieza de mayor coste de decisión de producto (qué preguntas
soporta, qué tono, qué acceso a datos) antes que de código — no se
construye sin antes acordar ese alcance contigo, igual que se hizo aquí
con el criterio de auto-asignación.

De Versión Enterprise no se ha construido nada (multiempresa avanzada,
CO₂/sostenibilidad, cross-dock/dropshipping — estos dos últimos con su
modelo de datos ya esbozado en `15-gestion-pedidos-TMS.md` pero sin
implementar).

## Siguiente paso automático (continuación)
Salvo indicación contraria, el proyecto queda en un punto natural de
pausa: todo el roadmap hasta Versión 3 (menos el copiloto, que requiere
tu validación de alcance) está construido, probado y documentado para
aplicar. Si quieres continuar, dime si prefieres (a) que defina y
construya el alcance del copiloto conversacional con una propuesta
concreta de qué preguntas soporta inicialmente, o (b) que empiece con
Versión Enterprise (probablemente CO₂/sostenibilidad primero, por ser la
pieza más autocontenida y con menos dependencias de decisiones de negocio
previas).

## Estado final tras este delta
Los tres pilares pendientes de Versión 1 del roadmap (18-roadmap-desarrollo-TMS.md)
quedan resueltos: GPS en vivo, App Conductor (con modo offline real, no
solo la UI), y Portal Cliente. **Retornos queda explícitamente fuera de
alcance por decisión del negocio** (no se implementa en este proyecto).

De Versión 2 (Ecosistema de terceros) quedan resueltos: motor de tarifas
avanzado (combustible/ADR/festivos/peajes/esperas, con
`computeFinalRouteCost` como fuente única de verdad para cotización y
liquidación), y Portal Transportista completo (aceptar/rechazar ya
existente + chat + disputas, que era lo único pendiente de
13-portal-transportista-TMS.md). Quedan sin implementar de Versión 2:
integraciones formales adicionales (WMS ya existía; ERP resuelto vía
erpclaud) y KPIs/BI ampliado (informes exportables programados).

## Siguiente paso automático
Salvo indicación contraria, continúo con **KPIs/BI ampliado**
(17-kpis-bi-TMS.md): vistas materializadas para las combinaciones
sistemáticas de métricas base × dimensiones ya definidas, y exportación a
Excel/CSV/PDF con envío programado — cerrando así Versión 2 del roadmap
por completo. Aplicaré el mismo criterio de esta pasada (cache + índices +
agregación en BD en vez de en memoria) desde el diseño inicial, no como
optimización a posteriori.

### 9. Cierre del issue heredado — CandidatesModal.tsx
Ya incluido en este delta (no era parte del documento v1.1, pero era el
único punto suelto de la sesión anterior y bloqueaba el uso real del
Planificador):
- [ ] Copiar `apps/backoffice-patch/components/CandidatesModal.tsx` a
      `apps/backoffice/src/components/planner/`.
- [ ] Copiar `backend/src/modules/optimization/optimization.simulations.routes.ts`
      y registrar (ver snippet de app.routes: `GET /optimization/:routeId/simulations`
      y `GET /optimization/summary/:routeId`).
- [ ] Enganchar el modal al botón "Asignar transportista" de
      `RouteDetailPage.tsx` (Fase 5, Pantalla 5) — abre el modal en vez de
      dejar la ruta atascada en `optimized`.

## Estado tras este delta
Con los 9 puntos anteriores aplicados, el flujo completo
`pedido → planificación → optimización → comparar transportistas →
asignar → carga (QR o backoffice) → seguimiento → entrega → retorno →
liquidación` queda operativo de extremo a extremo, incluida la
segmentación en 4 tipos y el Portal Cliente. Pendiente solo de calibración
de negocio (ver "Qué falta decidir" arriba), no de código.

### 10. Tests de integración (Supertest)
- [ ] Copiar `backend/src/tests/integration/` completo (`test-utils.ts`,
      `erpclaud.integration.test.ts`, `segmentation.e2e.test.ts`).
- [ ] Ajustar `test-utils.ts`: sustituir `buildTestApp()` por tu
      `buildApp()`/`createServer()` real si ya existe uno compartido con el
      resto de Supertest del proyecto, y el middleware de auth de test por
      el que ya uses (JWT de test / mock).
- [ ] `npm test -- integration` contra la BD de test de Codespaces —
      requiere que `service_segmentation_rule` ya esté poblada (paso 1 del
      checklist).

### 11. Despliegue — 4ª imagen en GHCR
- [ ] Copiar `apps/customer-portal/Dockerfile` y
      `apps/customer-portal/docker/nginx.conf` (ya generados junto a la
      app en el paso 8; mismo patrón multi-stage que las otras 3, sin el
      fix de Alpine/OpenSSL porque eso solo aplica a la imagen del backend
      con Prisma).
- [ ] Mergear `docker/docker-compose.customer-portal.patch.yml` en tu
      `docker-compose.yml` raíz.
- [ ] Mergear `.github/workflows/ci-cd.customer-portal.patch.yml` en tu
      workflow de CI/CD — usa la Opción A (matriz) si tu pipeline actual ya
      itera sobre las 3 apps frontend, o la Opción B (job independiente) si
      no.
- [ ] Confirmar que el step de tests del backend en CI ejecuta también
      `backend/src/tests/integration/`, no solo los unitarios de
      `segmentation.service.test.ts` / `zone-grouping.service.test.ts`.

### 12. Rate limiting en el bridge ERP
- [ ] `npm install express-rate-limit --workspace=backend` (ver
      `backend/NEW_DEPENDENCIES.md`).
- [ ] Copiar `backend/src/middleware/erpclaud-rate-limit.ts`.
- [ ] Ya integrado en `erpclaud.routes.ts` de este mismo delta (paso 3) —
      si ya aplicaste el paso 3 antes de esta actualización, vuelve a
      copiar `erpclaud.routes.ts`, ha cambiado.
- [ ] Copiar `backend/src/tests/integration/erpclaud-rate-limit.test.ts`.
- [ ] Variables de entorno opcionales (defaults sensatos si se omiten):
      `ERPCLAUD_RATE_LIMIT_WINDOW_MS`, `ERPCLAUD_RATE_LIMIT_MAX_PER_IP`,
      `ERPCLAUD_RATE_LIMIT_MAX_PER_COMPANY`.

### 13. Job programado de limpieza de tokens QR
- [ ] `npm install node-cron && npm install -D @types/node-cron --workspace=backend`.
- [ ] Copiar `backend/src/jobs/` completo (`cleanup-vehicle-qr-tokens.job.ts`,
      `scheduler.ts`).
- [ ] Copiar `backend/src/tests/jobs/cleanup-vehicle-qr-tokens.job.test.ts`.
- [ ] Aplicar `backend/prisma/migrations_manual/v1_1_segmentation.sql`
      completo si aún no lo habías ejecutado — ahora incluye también el
      `ALTER TABLE audit_log ... DROP NOT NULL` necesario para que el job
      pueda auditarse a sí mismo.
- [ ] Actualizar el modelo Prisma `AuditLog`: `companyId`/`userId` pasan a
      `String?` (ver comentario §6 en `schema.delta.prisma`).
- [ ] Mergear `backend/src/server.jobs.snippet.ts` en tu entrypoint del
      backend (arranca el cron tras `app.listen`).
- [ ] En CI/tests, definir `DISABLE_SCHEDULED_JOBS=true` para que el cron
      no quede colgado tras la suite de tests.
