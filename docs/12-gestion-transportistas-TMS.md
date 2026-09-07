# Gestión de Transportistas — TMS
### Fase 11 de `alimentacion_tms.md`

---

## Base real
6 transportistas subcontratados (Fase 1, §3.4), todos prestando ambos servicios (completo + paletería), cada uno con sus propias tarifas versionadas (Fase 9).

## Contenido funcional

**Contratos**: 🔧 ampliación — el Excel no trae condiciones contractuales (plazos de pago, SLA comprometido, exclusividad por zona); se añade `carrier_contract` (vigencia, condiciones de pago, SLA objetivo) vinculado a `carrier`, para poder evaluar cumplimiento real vs. comprometido.

**Tarifas**: acceso directo desde la ficha del transportista a sus `full_truck_rate`/`pallet_rate`/`rate_surcharge` vigentes e históricas (Fase 9).

**KPIs por transportista**: nº de rutas, OTIF (% entregas a tiempo), coste medio por parada/kg, nº de incidencias, ocupación media de sus vehículos — calculados sobre `shipment`/`route_stop`/`incident` (Fase 3).

**Ranking / comparativa**: tabla comparativa de los 6 transportistas lado a lado (mismo patrón que el comparador de coste del Planificador, Fase 5 Pantalla 8), pero con métricas de servicio, no solo de precio — coste no es el único criterio de asignación automática si el motor de optimización (Fase 8) incorpora fiabilidad histórica.

**Incidencias**: listado de `incident` filtrado por transportista, con tendencia en el tiempo — un transportista con incidencias crecientes debe generar alerta al gestor de flota.

**Seguimiento**: estado en vivo de sus rutas asignadas hoy (reutiliza el mapa de seguimiento, Fase 5 Pantalla 6, filtrado por transportista).

**Facturación**: acceso directo a sus `carrier_settlement` (Fase 3/9), estado y periodo.

**Evaluación automática**: score compuesto (coste relativo + OTIF + incidencias + puntualidad de documentación) recalculado periódicamente, usado como señal — no como decisión automática exclusiva — en el motor de optimización y visible en el ranking.

## Pantalla
Ficha de transportista con cabecera de score/estado, y pestañas: Datos y contrato, Tarifas, Flota (vehículos vinculados), KPIs y ranking, Incidencias, Liquidaciones.

## Siguiente paso
Continúo con la **Fase 12 — Portal del Transportista**.
