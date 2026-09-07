# Inteligencia Artificial — TMS
### Fase 15 de `alimentacion_tms.md`

---

## Principio rector
Toda capacidad de IA es **consumidora de eventos de dominio** (Fase 2 §2) y produce **recomendaciones o predicciones**, nunca decisiones operativas automáticas sin que la organización habilite explícitamente esa automatización módulo a módulo. Esto preserva la trazabilidad y evita que un modelo probabilístico tome decisiones de coste real sin supervisión, salvo que se decida lo contrario de forma consciente.

## Capacidades

**Predicción de ETA**: modelo que combina distancia/tiempo teórico de ruta con histórico real de `tracking_event` por transportista/zona/franja horaria, para ajustar el ETA mostrado al cliente más allá de la estimación estática del proveedor de rutas.

**Predicción de retrasos**: clasificador que, con el histórico de `incident` e `tracking_event`, estima la probabilidad de que una parada concreta incumpla su ventana horaria, alimentando una alerta temprana en el Dashboard (Fase 6, zona "Atención") antes de que ocurra el incumplimiento.

**Estimación de costes**: comparación continua entre `cost_simulation` (estimado) y `settlement_line` (real liquidado) para detectar sesgos sistemáticos del motor de optimización (Fase 8) y recalibrar sus supuestos (p. ej. si un transportista concreto sistemáticamente añade suplementos no capturados en su tarifa configurada).

**Predicción de demanda**: proyección de volumen de pedidos por zona/fecha a partir del histórico de `order`, para anticipar necesidad de capacidad de flota antes de que el pool de pendientes se sature — reutiliza el enfoque de percentiles ya presente en el proyecto `tms_getafe.html` original (Fase 1 del análisis anterior) como punto de partida, evolucionado a un modelo real de series temporales.

**Detección de anomalías**: vigilancia de patrones fuera de lo habitual — un pedido con peso declarado muy distinto al histórico de ese cliente/producto, una liquidación con importe anómalo frente a viajes comparables, una ruta con ocupación reiteradamente baja — generando alerta para revisión humana, no corrección automática.

**Optimización automática**: extensión opcional del motor de optimización (Fase 8) donde, para clientes que lo habiliten, el sistema no solo sugiere sino que asigna automáticamente transportista/vehículo cuando la confianza del modelo supera un umbral configurable y no hay restricciones duras en conflicto.

**Detección de rutas ineficientes**: análisis retrospectivo de rutas con desviación relevante entre distancia optimizada y distancia real recorrida (`tracking_event`), o con ocupación sistemáticamente baja, para retroalimentar la configuración de zonas/consolidación.

**Asistente conversacional / copiloto logístico**: interfaz de lenguaje natural sobre el propio TMS ("¿qué pedidos de Cáceres quedan sin planificar hoy?", "¿por qué se ha retrasado el envío X?"), que traduce la pregunta a consultas sobre las entidades ya modeladas (Fase 3) y sobre los eventos de dominio, sin inventar datos fuera de lo que el sistema realmente registra.

**Alertas inteligentes**: capa transversal que prioriza qué mostrar en el Dashboard (Fase 6) según impacto estimado (coste, cliente afectado, riesgo de incumplimiento), en vez de listar todas las alertas con el mismo peso.

## Requisitos de datos
Todas estas capacidades dependen de que el histórico operativo (Fases 3-4) se acumule con calidad desde el primer día — el volumen actual del Excel (691 líneas de pedido de muestra) es insuficiente para entrenar modelos productivos; el MVP debe lanzar estas capacidades en modo heurístico/basado en reglas (como ya hacía el HTML original con percentiles) y migrar a modelos estadísticos/ML a medida que se acumule suficiente histórico real.

## Siguiente paso
Continúo con la **Fase 16 — KPIs / Business Intelligence**.
