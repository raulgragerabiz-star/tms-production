# Roadmap de Desarrollo — TMS
### Fase 17 de `alimentacion_tms.md` — Rol: CTO

---

## MVP (imprescindible para operar con datos reales del Excel desde el día uno)

| Funcionalidad | Prioridad | Dependencias | Complejidad | Riesgo | Estimación |
|---|---|---|---|---|---|
| Plataforma: identidad, roles, multiempresa/almacén | Crítica | — | Media | Bajo | 3-4 semanas |
| Maestros: almacenes, clientes/puntos de entrega, productos, transportistas, flota | Crítica | Plataforma | Media | Bajo (datos ya limpios en Excel) | 4-5 semanas |
| Tarifas: modelo base (camión completo + paletería, versionado) | Crítica | Maestros | Media | Medio (validar no-solape de vigencias) | 2-3 semanas |
| Pedidos: CRUD, estados básicos, líneas, validación | Crítica | Maestros | Media | Bajo | 3 semanas |
| Planificación manual (sin optimización automática, solo agrupar/asignar) | Crítica | Pedidos, Tarifas | Alta (drag & drop + mapa) | Medio | 5-6 semanas |
| Cálculo de ocupación (peso/palés) | Crítica | Planificación, Productos | Baja | Bajo | 1-2 semanas |
| Expedición y seguimiento básico (sin GPS en vivo, solo estados) | Crítica | Planificación | Media | Bajo | 3 semanas |
| Facturación/liquidación básica | Crítica | Expedición, Tarifas | Media | Alto (debe ser exacta desde el día uno) | 3-4 semanas |
| Dashboard mínimo (KPIs básicos) | Alta | Todo lo anterior | Baja | Bajo | 2 semanas |

**Total MVP estimado: ~26-30 semanas** con un equipo pequeño (2-3 desarrolladores full-stack + 1 diseñador UX a tiempo parcial).

## Versión 1 — Operación asistida
- Motor de optimización con comparador de coste multiproveedor (Fase 8).
- Seguimiento GPS en vivo (requiere integración con telemática/app conductor).
- App móvil del conductor (funcionalidad esencial: ruta, firma, foto, estado).
- Retornos (logística inversa completa).
- Portal Cliente básico (estado de pedidos).
- **Dependencias**: MVP completo. **Complejidad**: Alta (mapas, tiempo real). **Riesgo**: Medio (dependencia de proveedor externo de rutas/mapas). **Estimación**: 12-16 semanas.

## Versión 2 — Ecosistema de terceros
- Portal Transportista completo (aceptar/rechazar, chat, liquidaciones, disputas).
- Motor de tarifas avanzado (suplementos: combustible, ADR, festivos, peajes, esperas).
- Integraciones formales (ERP, WMS) vía API.
- KPIs/BI ampliado (informes exportables, programados).
- **Dependencias**: Versión 1. **Complejidad**: Alta (múltiples integraciones externas). **Riesgo**: Medio-Alto (depende de la calidad de las APIs de terceros). **Estimación**: 14-18 semanas.

## Versión 3 — Inteligencia
- Predicción de ETA y retrasos.
- Detección de anomalías.
- Optimización automática (asignación sin intervención humana, opt-in).
- Alertas inteligentes priorizadas.
- **Dependencias**: Versión 2 (requiere volumen histórico suficiente para entrenar modelos). **Complejidad**: Alta. **Riesgo**: Alto (calidad de datos históricos, sesgo de modelos). **Estimación**: 16-20 semanas, en paralelo con la acumulación de histórico real (no puede empezar en serio hasta tener varios meses de operación en Versión 1/2).

## Versión Enterprise
- Multiempresa avanzada (grupos empresariales, facturación intercompañía).
- Asistente conversacional / copiloto logístico.
- CO₂ y sostenibilidad como KPI de primer nivel, con reporting regulatorio si aplica.
- Cross-dock y dropshipping completos.
- Backorders automatizados con integración de stock en tiempo real.
- **Dependencias**: Versión 3. **Complejidad**: Muy alta. **Riesgo**: Medio (funcionalidades más aisladas entre sí, menor riesgo de romper el core). **Estimación**: 20+ semanas, priorizable de forma independiente según necesidad real del negocio.

## Nota de método
No se elimina ninguna funcionalidad de las 18 fases: todo lo descrito en Fases 5-16 tiene un hueco en alguna versión de este roadmap. Lo que cambia es el orden, no el alcance final.

## Siguiente paso
Continúo con la **Fase 18 — Documento Maestro del Proyecto** (síntesis final de todas las fases anteriores).
