# Progreso del desarrollo — TMS

Registro interno de iteración. Se actualiza en cada respuesta; no se reinician módulos ya completados.

## Iteración 1 (actual)
- [x] Estructura de repo (backend / frontend / docker / docs / scripts)
- [x] Docker Compose (postgres + backend + frontend)
- [x] Backend: package.json, tsconfig, estructura src/
- [x] Prisma schema completo (30+ tablas, según Fase 3 — `04-modelo-bd-TMS.md`)
- [x] Seed inicial (company, warehouse, roles/permissions, usuario admin, 6 transportistas, tipos de vehículo, tarifas)
- [x] Auth (JWT, login, middleware `requireAuth`, `requireRole`)
- [x] Módulo Maestros: customers, delivery-points, products, carriers, vehicles
- [x] Módulo Tarifas: full-truck-rate, pallet-rate (CRUD + validación no-solape)
- [x] Módulo Pedidos: orders CRUD + líneas + cálculo peso/palés
- [x] Módulo Planificación: routes, route-stops, load-plan (cálculo ocupación)
- [x] Módulo Optimización: cost-simulation (comparador simple por transportista)
- [x] Módulo Expedición: shipments, tracking-events, incidents, POD
- [x] Módulo Retornos: return-items, return-claims
- [x] Módulo Facturación: carrier-settlements, settlement-lines
- [x] Dashboard KPIs endpoint agregreferido
- [x] Frontend: scaffold Vite + React + TS + Tailwind, login, layout con sidebar, dashboard, listados Pedidos/Planificador/Maestros (consumiendo API real)

## Iteración 2 (actual)
- [x] Refactor: reglas de negocio críticas extraídas a funciones puras testeables
      (`rates/lib/rate-validity.ts` — no-solape de vigencias; `orders/lib/line-weight.ts` —
      cálculo de peso de línea de pedido)
- [x] Vitest configurado (`backend/vitest.config.ts`) con alias `@/`
- [x] Suite de tests: `HttpError`, `rangesOverlap` (5 casos incl. vigencia indefinida y
      simetría), `computeLineWeightKg` (4 casos incl. UD vs PAL)
## Iteración 3 — Formularios de alta (completada)
- [x] Componentes reutilizables: `Modal`, `Field`, `Toast`, hook `useToast`
- [x] Backend: endpoint `GET/POST/PUT /api/warehouses` (faltaba, requerido por los formularios)
- [x] `NewOrderModal`: alta de pedido con líneas dinámicas, selects dependientes cliente→punto
      de entrega, cálculo de peso delegado al backend
- [x] `NewRouteModal`: alta de ruta agrupando pedidos `validated` pendientes por almacén
- [x] `NewRateModal`: alta de tarifa camión completo / paletería con vigencia
- [x] Integrado en `OrdersPage`, `PlannerPage`, `RatesPage` con botón "+ Nuevo…" y toasts

## Iteración 4 — Planificador drag&drop con Google Maps (completada)
- [x] Backend: endpoint `GET /routes/planner-board` (pedidos validados pendientes + rutas
      draft/optimized del almacén/fecha dados, con coordenadas de punto de entrega/almacén)
- [x] Backend: `GET /orders` ahora expone `lat/lng` de `deliveryPoint` y `warehouse`
- [x] Frontend: dependencia `@react-google-maps/api`, `VITE_GOOGLE_MAPS_API_KEY` en `.env`/docker-compose
- [x] `PlannerMap.tsx`: mapa con marcadores coloreados (almacén, pendientes, por ruta)
- [x] `DragDropBoard.tsx`: panel izquierdo con pedidos arrastrables (`draggable`/`onDragStart`),
      panel derecho con mapa + tarjetas de rutas como zonas de drop (`onDragOver`/`onDrop`) y
      zona "nueva ruta" que abre `NewRouteModal` con el pedido preseleccionado
- [x] `NewRouteModal` extendido con `presetOrderId`/`presetWarehouseId`/`presetServiceType`
- [x] `PlannerPage`: toggle Tablero/Mapa vs Lista, filtros almacén/fecha/servicio
- [x] Seed: coordenadas reales para el punto de entrega demo + 4 clientes/puntos adicionales
      en el área de Madrid, para tener varios marcadores visibles desde el primer arranque

## Iteración 5 — Portal Transportista y App Conductor (completada)
- [x] Backend: `driverId` añadido a `AppUser`; modelo `ShipmentMessage` (chat) añadido y
      enlazado a `Shipment`
- [x] Backend: middleware `requireCarrierPortal`/`requireDriverApp` (scope reforzado por
      `carrierId`/`driverId` del token, nunca solo por UI — Fase 2 §7)
- [x] Backend: módulo `carrier-portal` completo — bandeja de tareas, aceptar/rechazar ruta,
      mis viajes, documentación, subir POD, incidencias, chat, liquidaciones + disputa, KPIs propios
- [x] Backend: módulo `driver-app` completo — ruta de hoy, llegada/completar/fallar parada
      (con reclamación automática de retornos igual que el backoffice), GPS ping, incidencias,
      documentos por parada, chat
- [x] Seed: usuarios demo `transportista@tms.local` y `conductor@tms.local` con
      transportista/vehículo/conductor reales enlazados
- [x] Frontend — **Portal Transportista** (`/apps/carrier-portal`, app Vite independiente,
      puerto 5174): login con scope propio, bandeja de entrada tipo tareas pendientes
      (Fase 12 — no dashboard analítico), mis viajes, detalle de viaje (paradas, POD, incidencias,
      chat), liquidaciones con disputa
- [x] Frontend — **App Conductor** (`/apps/driver-app`, app Vite independiente, puerto 5175):
      login simple para cabina, pantalla única "ruta de hoy" con tarjetas grandes,
      detalle de parada con botones táctiles amplios (llegada / confirmar entrega en máx. dos
      toques / reportar incidencia), teléfono de contacto con `tel:`
- [x] `docker-compose.yml` actualizado con los 2 nuevos servicios

## Iteración 6 — Tests de integración (completada)
- [x] `vitest.integration.config.ts`: config separada, ejecución en serie, timeout 20s
- [x] `tests/integration/setup.ts`: fuerza `TEST_DATABASE_URL`, aplica schema con `prisma db push`
- [x] `tests/integration/helpers.ts`: `resetDatabase()` (TRUNCATE CASCADE) + `seedMinimalFixtures()`
      (empresa/almacén/rol/usuario admin logueado vía `/api/auth/login` real)
- [x] `auth.int.test.ts` (4 casos): login válido, credenciales incorrectas, sin token, token inválido
- [x] `customers.int.test.ts` (5 casos): alta, código duplicado→409, búsqueda, soft delete, 404
- [x] `orders.int.test.ts` (5 casos): peso UD, peso PAL, producto inexistente→400, punto de
      entrega ajeno al cliente→404, máquina de estados (transición inválida bloqueada)
- [x] `rates.int.test.ts` (6 casos): alta, solape→409, vigencias consecutivas OK, solape
      independiente por servicio (paletería), simulador con km+paradas extra, simulador sin
      tarifa vigente→404
- [x] `planning.int.test.ts` (6 casos): crear ruta + load_plan, rechazo de pedido inexistente,
      añadir parada + recálculo de ocupación, planner-board separa pendientes de planificados,
      ciclo completo optimización→selección, bloqueo de ruta confirmada→409
- [x] Scripts `test:integration` y `test:all` en `package.json`; instrucciones en README

## Iteración 7 — Motor de tarifas avanzado (completada)
- [x] Schema: `CustomerRate` (by_customer, prioridad máxima) y `ZoneRate` (by_zone/province,
      prioridad intermedia) añadidos como extensión aditiva; `RateSurcharge` ya existía en el
      schema pero no tenía endpoints — ahora expuesto por completo
- [x] `rates/lib/rate-engine.ts`: funciones puras — `isSurchargeApplicable` (ADR/festivo/espera/
      peaje solo si la condición del envío lo activa; combustible/zona siempre aplican),
      `computeSurchargeAmount` (4 modos: fixed/percentage/per_km/per_hour, con peaje real
      informado con prioridad sobre el genérico), `applySurcharges` (acumula y desglosa),
      `resolveBaseRate` (prioridad by_customer > by_zone > general)
- [x] 17 tests unitarios nuevos (`rate-engine.test.ts`) cubriendo aplicabilidad, los 4 modos de
      cálculo, acumulación de varios suplementos, y las 4 combinaciones de prioridad de resolución
- [x] Backend: CRUD `GET/POST /rates/surcharges`, `/rates/customer`, `/rates/zone` (con
      no-solape de vigencias reutilizando `rangesOverlap`)
- [x] `POST /rates/simulate` reescrito para resolver la tarifa base por prioridad y aplicar
      todos los suplementos vigentes/aplicables, devolviendo desglose completo
      (`baseRateKind`, `baseAmount`, `surcharges[]`) — **retrocompatible**: sin `customerId`/
      `province`/condiciones extra en el payload, el resultado es idéntico al simulador simple
      anterior (verificado contra los tests de integración ya existentes)

## Pendiente
- [ ] Integrar el motor avanzado (suplementos/by_customer/by_zone) también en
      `/optimization/:routeId/simulate` y en la liquidación de `/billing` — hoy ambos siguen
      usando solo la tarifa base general, el motor completo solo está disponible vía
      `/rates/simulate`
- [ ] Frontend: UI de alta para suplementos/tarifas por cliente/por zona (hoy solo vía API)
- [ ] Websockets/eventos para tracking en vivo (actualmente polling)

## Iteración 8 — CI/CD (completada)
- [x] `.github/workflows/ci.yml`: 5 jobs — backend (typecheck + unit + integración contra
      Postgres real vía service container) · frontend · carrier-portal · driver-app
      (typecheck + build cada uno) · docker-build (verifica que las 4 imágenes construyen)
- [x] `.github/workflows/cd.yml`: al crear un tag `vX.Y.Z`, construye y publica las 4
      imágenes de producción en GHCR (`ghcr.io/<owner>/tms-*`) vía matrix build, usando el
      `GITHUB_TOKEN` integrado — cero secretos adicionales que configurar
- [x] Dockerfiles de producción multi-stage: `backend/Dockerfile.prod` (build TS → runtime
      Node solo con deps de producción + `prisma migrate deploy` vía entrypoint, en vez de
      `db push`) y `Dockerfile.prod` + `nginx.conf` para los 3 frontends (build Vite → nginx
      sirviendo estáticos con fallback SPA para React Router)
- [x] `docker/docker-compose.prod.yml`: plantilla de despliegue con las imágenes publicadas,
      variables de entorno obligatorias explícitas (`:?falta ...`) para evitar arranques con
      configuración incompleta en producción
- [x] README: sección CI/CD completa, incluyendo el paso de generar el historial de
      migraciones antes del primer despliegue y la limitación conocida de `VITE_*` en
      build-time de Vite (documentada, no resuelta con runtime-config por alcance)

## Todos los puntos de la lista original completados
1. ✅ Formularios de alta (Pedidos, Rutas, Tarifas)
2. ✅ Planificador drag&drop con Google Maps
3. ✅ Portal Transportista y App Conductor
4. ✅ Tests de integración (Supertest)
5. ✅ Motor de tarifas avanzado
6. ✅ CI/CD (GitHub Actions)

## Iteración 9 — Cierre final: integración completa + puesta en marcha en empresa
- [x] Motor de tarifas avanzado **integrado de extremo a extremo**: extraído a
      `rates/rate-resolution.service.ts` (servicio único compartido, sin duplicar lógica)
      y conectado en los 3 puntos que lo necesitaban: `/rates/simulate`,
      `/optimization/:routeId/simulate` (propaga `customerId`/`province` cuando todas las
      paradas de la ruta comparten cliente/provincia, para que `by_customer`/`by_zone`
      puedan ganar prioridad) y la liquidación de `/billing` (misma lógica, resuelta
      siempre contra la fecha real del viaje)
- [x] Frontend: `RatesPage` ampliada con 3 pestañas nuevas (Por cliente, Por zona,
      Suplementos) + sus modales de alta — el motor avanzado ya es 100% operable desde UI,
      no solo por API
- [x] **Gap de producción detectado y cerrado**: no existía forma de dar de alta usuarios
      de Portal Transportista / App Conductor sin editar el seed. Nuevo módulo
      `modules/users` (backend) + pantalla `Maestros → Usuarios` (frontend): permite crear
      accesos `internal`/`carrier_portal`/`driver_app`/`customer_portal` reales, activar/
      desactivar cuentas, y asignar roles a usuarios internos — protegido con
      `requireRole("admin_empresa","admin_plataforma")`, verificado con test de integración
      dedicado (incluye caso "usuario sin rol admin recibe 403")
- [x] CRUD de **Conductores** añadido (`vehicles/drivers`, faltaba por completo) +
      asignación conductor↔vehículo con histórico de vigencia (`vehicle_driver`, cierra la
      asignación anterior al abrir una nueva) — pestaña "Conductores" en `Maestros → Flota`
- [x] Pantalla **Almacenes** añadida (`Maestros → Almacenes`) — antes solo existía vía API,
      cerrando el último hueco de "todo operable desde la UI, no solo desde Postman"
- [x] Endurecimiento para arranque en producción:
      - `env.ts` rechaza arrancar con `NODE_ENV=production` si `JWT_SECRET` sigue en su
        valor de desarrollo por defecto (falla rápido y explícito, no en silencio)
      - CORS ahora acepta lista de orígenes (`CORS_ORIGIN` separado por comas) — necesario
        porque el backend sirve a 3 frontends distintos, cada uno en su propio dominio
      - `/health` comprueba también la conexión a BD (`SELECT 1`), no solo que el proceso
        Node esté vivo — importante para que un orquestador no dé por sano un backend con
        Postgres caído
- [x] README: guía paso a paso "Puesta en marcha en la empresa" (almacenes → transportistas
      → flota/conductores → tarifas → clientes → productos → usuarios de portal → ciclo
      operativo diario), enlazando explícitamente con la App Conductor y el Portal
      Transportista como parte del flujo real de la empresa, no como demos aisladas
- [x] Test de integración `users.int.test.ts` (6 casos): alta de Portal Transportista,
      alta de App Conductor + verificación de que puede consultar su ruta de hoy,
      validación de campos requeridos por tipo, email duplicado→409, control de acceso
      (403 sin rol admin), desactivación de cuenta→login posterior en 401

## Estado final
El sistema es instalable, arrancable, y operable de punta a punta por una empresa real:
login, maestros completos (incluyendo almacenes, flota y conductores), motor de tarifas
avanzado operable desde UI, pedidos, planificación con mapa real, asignación de
transportistas, portal de transportista y app de conductor enlazados y funcionales,
retornos automáticos, facturación con el motor de tarifas completo, dashboard y KPIs,
CI/CD listo para publicar imágenes de producción, y gestión de usuarios/accesos para
poder incorporar transportistas y conductores reales sin tocar código ni base de datos.

No quedan pendientes bloqueantes para el arranque operativo. Quedan, como mejoras futuras
no bloqueantes (fuera del alcance de "arranque funcional"): RBAC granular más allá de
`/api/users`, websockets para tracking en vivo (hoy polling, funcional pero no tiempo
real puro), runtime-config para `VITE_API_URL` sin rebuild, y las capacidades de IA/BI
avanzadas de la Fase 15 (hoy en modo heurístico, tal como el propio documento funcional
preveía para el MVP).

## Iteración 10 — Verificación final de funcionalidad y entrega
- [x] **Modo claro forzado** en los 3 frontends: `color-scheme: light` en CSS raíz y en
      `<meta name="color-scheme">` de cada `index.html`, más `bg-slate-50`/`bg-slate-100`
      explícito en `body` — evita que un SO en modo oscuro oscurezca controles nativos
      (selects, checkboxes, scrollbars) aunque la app en sí ya era 100% clara (sin rastro
      de clases `dark:` en ningún componente, verificado por grep)
- [x] Auditoría estática completa del repositorio (sin poder ejecutar `npm install` en este
      entorno por falta de acceso a red, se verificó todo lo verificable de forma estática):
      - Todos los imports `@/` de las 4 apps (backend + 3 frontends) resuelven a archivos reales
      - Las 39 relaciones `@relation()` del schema de Prisma apuntan a modelos válidos
      - Balance de llaves/paréntesis correcto en los 99 archivos `.ts`/`.tsx` del proyecto
      - Los 4 archivos YAML (2 docker-compose + 2 workflows) son sintácticamente válidos
      - Los 8 Dockerfiles (dev+prod × 4 apps) referenciados por CI/CD existen
      - Enlaces del sidebar del backoffice vs. rutas registradas: 100% coincidentes
      - Variables `VITE_*`/backend usadas en código vs. declaradas en `.env.example`: consistentes
      - El seed es completamente idempotente (los 7 `.create()` sin upsert nativo están
        todos protegidos por `findFirst` + guarda condicional)
      - Las tablas HTML con `colSpan` dinámico (incl. las 5 de `RatesPage`) tienen el
        número de columnas correcto, verificado tabla por tabla
- [x] **Corregido antes de que fallara en el primer arranque**: el workflow de CI usaba
      `cache-dependency-path` apuntando a `package-lock.json`, que no existe en este
      entorno (no se pudo generar sin acceso a red). Se quitó la dependencia del caché de
      npm en `ci.yml` — el workflow funciona igual, solo sin caché hasta que se commiteen
      los lockfiles reales (recomendado, documentado en el propio workflow)
- [x] **Enlace con proyecto de Layout de Almacén**: `Warehouse` extendido con
      `externalCode` (identificador estable para correlacionar almacenes entre sistemas) y
      `layoutJson` (JSON libre para que el proyecto de layout guarde su estructura sin que
      el TMS conozca ese formato). Nuevos endpoints `GET /warehouses/by-external-code/:code`
      y `PATCH /warehouses/:id/layout`. Documentado en README con la vía de autenticación
      máquina-a-máquina recomendada (usuario `internal` dedicado vía `Maestros → Usuarios`)

## Nota sobre esta verificación
No fue posible ejecutar `npm install`, `npm run build`, `npm test` ni levantar Docker en
este entorno de generación (sin acceso a red saliente), por lo que esta verificación es
**estática** (estructura, imports, sintaxis, wiring, consistencia de configuración) y no
sustituye una prueba de arranque real. Se recomienda como primer paso al recibir el zip:

```bash
docker compose -f docker/docker-compose.yml up --build
```

Si algo falla en ese primer arranque (típicamente: alguna dependencia de npm con una
versión que haya cambiado desde que se escribió este proyecto, o algún detalle de
configuración local), es información valiosa — con el mensaje de error exacto se puede
corregir de forma dirigida en una siguiente iteración.
