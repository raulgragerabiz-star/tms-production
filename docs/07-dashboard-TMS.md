# Dashboard Principal — TMS
### Fase 6 de `alimentacion_tms.md`

Estructura en 3 zonas (ver Fase 5): **Hoy** · **En curso** · **Atención**, más una franja superior de KPIs de un vistazo.

## Franja superior — KPIs de un vistazo
Tarjetas compactas con valor + tendencia vs. día/semana anterior: **Pedidos pendientes**, **Pedidos en ruta**, **Entregas hoy**, **Incidencias abiertas**, **Coste de transporte hoy (€)**, **OTIF del día (%)**.

## Zona "Hoy"
- **Pedidos pendientes**: contador + tabla resumida (top 5 más urgentes por fecha de entrega) con acceso directo a Planificador.
- **Pedidos en preparación**: los que ya están en `route.draft`/`optimized` sin confirmar transportista — para no perder de vista lo que falta por cerrar antes del corte de expedición.

## Zona "En curso"
- **Mapa**: todos los `shipment.status = in_transit` como puntos, coloreados por transportista.
- **Pedidos en ruta**: lista con ETA de próxima parada.
- **Entregas (hoy)**: contador de completadas vs. total programado, con barra de progreso.
- **Vehículos**: cuántos de la flota subcontratada están activos ahora mismo vs. disponibles.
- **Conductores**: igual, con enlace a incidencias si algún conductor tiene una abierta.
- **Transportistas**: ranking rápido del día (nº de rutas asignadas, a tiempo vs. con retraso).

## Zona "Atención"
- **Incidencias**: lista de `incident.status = open`, ordenadas por antigüedad, con acceso directo a la parada afectada.
- **Alertas**: reglas automáticas — pedido sin planificar a menos de X horas del corte, ocupación de ruta por debajo de un umbral de eficiencia, tarifa a punto de caducar sin renovación, retorno pendiente acumulando más de N viajes sin recogerse.

## Widget de costes
Gráfico de coste de transporte diario (últimos 30 días) con línea de coste estimado vs. coste real liquidado, para detectar desviaciones del motor de optimización frente a lo que finalmente se liquida.

## Comportamiento
- Cada widget es clicable y lleva al listado filtrado correspondiente (nunca es solo lectura decorativa).
- Refresco en near-real-time para "En curso" (vía eventos, no polling agresivo); el resto se refresca al cargar o cada pocos minutos.
- Todos los widgets de "Hoy"/"En curso"/"Atención" se filtran automáticamente por almacén si el usuario tiene acceso a más de uno, con selector de almacén arriba a la derecha.

## Siguiente paso
Continúo con la **Fase 7 — Planificador de rutas** (funcionamiento detallado).
