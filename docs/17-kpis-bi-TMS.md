# KPIs / Business Intelligence — TMS
### Fase 16 de `alimentacion_tms.md`

---

## Enfoque
Más de 150 KPIs no se listan uno a uno de forma plana — se definen como **combinaciones sistemáticas de dimensiones × métricas base**, todas calculables sobre las entidades ya modeladas (Fase 3), lo que en la práctica genera el volumen pedido sin diseño ad-hoc por cada indicador.

## Métricas base (por entidad)

| Entidad fuente | Métricas base |
|---|---|
| `order` / `order_line` | nº pedidos, nº líneas, peso total, palés totales, valor si hay `customer_invoice` |
| `route` / `route_stop` | nº rutas, nº paradas, distancia planificada vs. real, ocupación media (peso/palés) |
| `shipment` / `tracking_event` | tiempo en tránsito, desviación de ETA, nº eventos GPS |
| `incident` | nº incidencias, tiempo medio de resolución, tasa de incidencias por envío |
| `settlement_line` / `cost_simulation` | coste estimado, coste real, desviación %, coste medio por parada/kg/palé |
| `return_claim` | nº retornos pendientes, tiempo medio hasta recogida, tasa de recogida efectiva |
| `proof_of_delivery` / `route_stop` | % entregas a tiempo (OTIF), % entregas fallidas |

## Dimensiones de corte
Almacén, transportista, vehículo/tipo de vehículo, conductor, cliente, producto/categoría, provincia/zona, periodo (día/semana/mes), tipo de servicio (completo/paletería).

**Ejemplo de generación sistemática**: `coste medio por kg` × {por transportista, por cliente, por zona, por tipo de vehículo, por periodo} ya produce 5 KPIs distintos a partir de una sola métrica base — replicado sobre las ~10 métricas base de la tabla anterior y sus dimensiones relevantes se supera ampliamente el umbral de 150 solicitado, todos con la misma lógica de cálculo subyacente (evita 150 fórmulas distintas de mantenimiento).

## Categorías explícitas pedidas

- **Costes**: coste total/medio por pedido, parada, kg, palé, km — por transportista/cliente/zona/periodo. Desviación estimado vs. real.
- **Rentabilidad**: margen por cliente/pedido cuando existe `customer_invoice` (ingreso repercutido − coste liquidado).
- **Transportistas**: OTIF, coste medio, incidencias, ranking compuesto (Fase 11).
- **Vehículos**: ocupación media, nº rutas realizadas, disponibilidad efectiva vs. teórica.
- **Conductores**: nº entregas, incidencias asociadas, tiempo medio por parada.
- **Clientes**: frecuencia de pedido, peso/palés medio por pedido, incidencias recibidas, tasa de retorno de envases.
- **Almacenes**: volumen expedido, nº rutas originadas, tiempo medio de preparación (si integra con WMS).
- **Productos**: rotación, frecuencia en pedidos, tasa de retorno (para los retornables).
- **Rutas**: distancia media, nº paradas medio, eficiencia (ocupación/distancia).
- **Ocupación**: % peso y % palés medio, por vehículo/tipo/transportista/periodo.
- **OTIF / nivel de servicio**: % entregas dentro de ventana horaria comprometida, desglosado por las mismas dimensiones.
- **CO₂**: 🔧 ampliación — estimado a partir de distancia real recorrida × factor de emisión por tipo de combustible del vehículo (dato añadido en Fase 10); requiere que se complete ese campo para ser fiable, mientras tanto se muestra como estimación aproximada declarada como tal en la UI.
- **Tiempos**: tiempo medio de ciclo pedido→entrega, tiempo medio de planificación, tiempo medio de resolución de incidencias.
- **Productividad**: pedidos gestionados por planificador/día, paradas completadas por conductor/día.

## Cálculo y refresco
KPIs operativos (Dashboard, Fase 6) en near-real-time vía eventos; KPIs analíticos (Informes, Fase 5 Pantalla 12) calculados en agregados periódicos (vistas materializadas o data warehouse ligero) para no penalizar el rendimiento transaccional descrito en la Fase 3.

## Exportación
Todo informe exportable a Excel/CSV/PDF, con posibilidad de programar envío periódico por email a un rol concreto (p. ej. informe semanal de OTIF al gestor de flota).

## Siguiente paso
Continúo con la **Fase 17 — Roadmap de Desarrollo** (rol CTO).
