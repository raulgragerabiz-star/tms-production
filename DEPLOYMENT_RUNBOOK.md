# Plan de despliegue — Deadline martes 01/09/2026

Hoy es domingo 30/08. Quedan ~2 días. Este documento sustituye al checklist
lineal de 26 pasos del README: **triage por criticidad**, no por orden de
construcción. Lo que se construyó por iteración libre ("continúa") no es
igual de urgente que el alcance original pactado (`v1_1-integracion-erp-planificacion-automatica.md`).

## Regla de decisión
**CRÍTICO** = si falta, el sistema no cumple la definición de terminado
fijada al inicio del proyecto (instalarse, ejecutarse, login, crear
pedidos, planificar rutas, asignar transportistas, gestionar vehículos,
calcular tarifas, ver dashboard, registrar entregas, generar KPIs) o
rompe algo que ya estaba en producción (v1.0).

**DIFERIBLE** = mejora real, pero el sistema funciona sin ello el martes.
Se aplica después del deadline, sin presión.

---

## Bloque CRÍTICO — aplicar sí o sí antes del martes

Corresponde al alcance original del documento v1.1 que motivó todo esto,
más lo mínimo para que no quede roto:

1. **Schema base + segmentación** (README pasos 1-2) — bloqueante, todo lo
   demás depende de que `Order.serviceType` tenga los 4 valores.
2. **Bridge ERP `erpclaud`** (paso 3) — es el entregable de negocio
   explícito del documento origen.
3. **Planificación automática: zonas + compatibleSegments** (paso 4).
4. **Tarifas: modo día dedicado** (paso 5).
5. **App Conductor: QR + checkpoint de carga** (paso 6) — sin esto, la
   app conductor pierde una función ya anunciada.
6. **Mapa sin coste (Leaflet)** (paso 7) — sustituye Google Maps; si no se
   aplica, el backoffice puede estar usando una integración de pago que
   además puede no tener API key configurada en Codespaces.
7. **Portal Cliente** (paso 8) — nueva app, pero ya comprometida en el
   plan original.
8. **Tests de integración del punto 1-8** (paso 10) — mínimo para no
   entregar a ciegas.
9. **Despliegue: 4ª imagen en GHCR** (paso 11) — si no se publica, el
   Portal Cliente no es accesible fuera de local/Codespaces.
10. **CandidatesModal.tsx** (paso 9 original) — sin esto, las rutas se
    quedan atascadas en `optimized` sin poder asignarse; es un bug
    funcional heredado, no una mejora.

**Estimación**: esto es prácticamente todo el trabajo de las pasadas 1-3
del proyecto (antes de la optimización de recursos). Es factible en el
tiempo restante si se prioriza SOLO esto.

---

## Bloque DIFERIBLE — no bloquea el martes

Todo lo construido a partir de la pasada 4 en adelante es **valor
añadido, no comprometido originalmente**:

- Rate limiting del bridge ERP (paso 12) — recomendable pero no rompe nada si falta; el endpoint ya tiene auth.
- Job de limpieza de tokens QR (paso 13) — sin él, la tabla crece sin límite pero no falla nada operativo en 2 días.
- GPS en vivo + Socket.io (paso 14) — el mapa de seguimiento puede quedarse en modo "sin posición en vivo" sin romper el resto.
- Modo offline de App Conductor (paso 15) — mejora importante pero la app funciona online igualmente.
- Mapa de seguimiento en vivo del backoffice (paso 16).
- Motor de tarifas avanzado: suplementos (paso 17) — las tarifas base (km+parada, albarán+bulto) ya funcionan sin esto.
- Disputas y chat del Portal Transportista (pasos 18-19).
- Optimización de recursos (pasada 4 completa) — importante a medio plazo, pero el sistema sin optimizar sigue funcionando para el volumen de un piloto/demo.
- KPIs/BI ampliado, informes programados (pasos 20-21).
- Predicción de ETA, detección de anomalías, predicción de demanda, optimización automática (pasos 22-26) — **todo el bloque de Inteligencia es explícitamente Versión 3 del roadmap**, posterior a MVP y V1/V2. No debería competir por tiempo con el bloque crítico.

**Recomendación explícita**: si el martes se acerca y hay que elegir,
todo este bloque se pospone sin negociación. Ninguna pieza de aquí forma
parte de la definición de "proyecto terminado" fijada al inicio.

---

## Plan de 2 días

### Domingo 30/08 (resto del día)
- Aplicar pasos 1-2 (schema + segmentación) contra tu rama de Codespaces.
- Aplicar paso 3 (bridge ERP) y validarlo con `erpclaud.integration.test.ts`.
- Aplicar paso 9 (CandidatesModal) — desbloquea el flujo de planificación completo, es la pieza que más impacto visual tiene en una demo.

### Lunes 31/08
- Mañana: pasos 4-7 (planificación por zonas, tarifas día dedicado, QR conductor, mapa Leaflet).
- Tarde: paso 8 (Portal Cliente) — es la app nueva, necesita más tiempo de integración (nuevo servicio, nuevo puerto, CORS).
- Noche: paso 10 (tests) + paso 11 (Docker/CI) — dejar la imagen publicándose de un día para otro por si el pipeline falla y hay que iterar.

### Martes 01/09 (mañana, margen de seguridad)
- Smoke test completo (ver `smoke-test.sh` en esta misma carpeta).
- Congelar. No tocar nada del bloque diferible aunque sobre tiempo — mejor
  un sistema estable con el alcance crítico que uno inestable con más
  funciones.

---

## Automatización

Se incluye `apply-delta.sh`: script que aplica el **bloque crítico
únicamente** (no toca nada del bloque diferible) contra un checkout local
de tu repo. Ver instrucciones de uso en el propio script.

Se incluye `smoke-test.sh`: verificación rápida post-despliegue de los
endpoints críticos.

## Despliegue para la presentación
Ver `deploy/DEPLOY_GITHUB_FIREBASE.md` — guía paso a paso completa de
GitHub Actions + Firebase Hosting (4 apps) + Cloud Run (backend) + Neon
(Postgres). Es la arquitectura recomendada para el martes: no es un
montaje desechable, es la misma base que usarías en producción real, así
que todo lo del bloque DIFERIBLE sigue aplicándose después sin rediseñar
nada.
