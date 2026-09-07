# Planificador de Rutas — TMS
### Fase 7 de `alimentacion_tms.md`

---

## Funcionamiento general
Panel de dos zonas (ver Fase 5, Pantalla 4): pedidos pendientes a la izquierda, lienzo de rutas a la derecha (mapa + lista). Todo cambio en el lienzo recalcula ocupación y coste en tiempo real, sin necesidad de guardar para ver el efecto.

## Arrastrar pedidos (Drag & Drop)
Cada pedido pendiente es una tarjeta arrastrable con peso/palés estimados visibles. Al soltarlo sobre:
- **Una ruta existente en `draft`**: se añade como `route_stop`, se recalcula `load_plan` al instante.
- **Zona vacía del mapa**: crea una nueva ruta `draft` con ese pedido como única parada.
- **Un `route_stop` ya asignado a un transportista `confirmed`**: bloqueado por defecto (requiere confirmación explícita, porque modificar una ruta ya confirmada por el transportista puede invalidar la tarifa aceptada).

## Crear rutas
Manual (arrastre) o por selección múltiple + botón "Crear ruta" — agrupa los pedidos seleccionados si comparten almacén y fecha compatible; si no, el sistema avisa antes de crear.

## Fusionar rutas
Selección de 2+ rutas en `draft`/`optimized` del mismo almacén y fecha → botón "Fusionar". El sistema resecuencia las paradas por proximidad geográfica automáticamente y recalcula ocupación total; si el resultado supera la capacidad de cualquier vehículo disponible, se avisa antes de confirmar la fusión.

## Dividir rutas
Selección de un subconjunto de paradas dentro de una ruta → botón "Dividir en nueva ruta". Útil cuando una ruta sobrepasa capacidad o cuando conviene separar por tipo de servicio (completo vs. paletería).

## Optimizar kilómetros / tiempo / costes
Tres modos de optimización seleccionables (ver Fase 8 para el motor): el planificador puede pedir "reordenar por menor distancia", "reordenar por menor tiempo" o "elegir transportista de menor coste" sobre la ruta actual, sin perder el resto de decisiones manuales ya tomadas — la optimización es una **sugerencia aplicable**, no una sustitución silenciosa del trabajo manual.

## Mapas y tráfico
El lienzo muestra las paradas georreferenciadas (`delivery_point.lat/lng`) con la secuencia dibujada como ruta real (no línea recta), usando un proveedor de rutas/tráfico externo (a definir en integración — p. ej. Google Directions/OSRM). El ETA de cada parada se ajusta con la condición de tráfico vigente al momento de planificar, y se recalcula en vivo durante el seguimiento (Fase 6 del flujo operativo).

## Ventanas horarias
Cada `delivery_point` puede tener `unload_hours` (horario de descarga del cliente); el planificador valida que el ETA calculado de cada parada caiga dentro de esa ventana y resalta en ámbar/rojo las paradas que no la cumplen, permitiendo resecuenciar antes de confirmar.

## Ocupación del camión
Barra doble siempre visible por ruta: % de peso ocupado y % de palés ocupados (ver Fase 3, `load_plan`), cada una contra el límite del `vehicle_type` candidato. Si `allows_exceeding_pallets = true`, la barra de palés puede superar el 100% visualmente marcado como "permitido", mientras que la de peso nunca puede superarlo — refleja la regla de negocio real detectada en el Excel (Fase 1, §3.5).

## Cierre del ciclo
Una vez la ruta está optimizada y con transportista asignado, pasa a Detalle de ruta (Fase 5, Pantalla 5) para su confirmación y expedición, siguiendo el flujo operativo completo (Fase 4).

## Siguiente paso
Continúo con la **Fase 8 — Motor de Optimización** (algoritmos).
