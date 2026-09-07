# Gestión de Pedidos — TMS
### Fase 14 de `alimentacion_tms.md`

---

## Estados (detalle sobre Fase 2 §5.1)
`received → validated → planned → loading → dispatched → in_transit → delivered`, con ramas `incident` (en cualquier punto tras `dispatched`) e `cancelled` (solo antes de `loading`, salvo cancelación excepcional autorizada con motivo obligatorio y auditado).

## Validaciones
Al recibir: existencia y estado activo de `customer`, `delivery_point` y cada `product`; coherencia de unidades (`order_line.unit` debe ser una unidad reconocida para ese producto); fecha de entrega comprometida no puede ser anterior a hoy salvo carga histórica.

## Prioridades
`standard` / `urgent` (Fase 3). Un pedido urgente se destaca en el pool de pendientes del Planificador (Fase 7) y puede forzar una reoptimización incremental si ya existían rutas del día cerradas en `draft`.

## Agrupaciones
Un pedido puede formar parte de una única `route` (vía `route_stop`) por planificación; si un pedido excede la capacidad de un solo vehículo, se divide en varias líneas de expedición — 🔧 ampliación: se añade la posibilidad de que un `order` genere más de un `route_stop` (envío parcial), controlado y visible en el detalle del pedido para no perder trazabilidad de qué fue en cada envío.

## Backorders
🔧 Ampliación: cuando una línea de pedido no puede completarse (falta de stock confirmada por el WMS vía integración), se marca `order_line.status = backorder`, generando automáticamente un pedido de continuación cuando el stock esté disponible, sin duplicar la carga administrativa del cliente.

## Cross Dock
🔧 Ampliación (retomada del proyecto `tms_getafe.html` original): pedidos que transitan por un almacén intermedio sin almacenaje prolongado — se modela como un `warehouse` adicional marcado `is_cross_dock = true`, con una `route` de entrada y otra de salida encadenadas por el mismo pedido, sin necesidad de una entidad nueva.

## Dropshipping
🔧 Ampliación: pedidos cuyo origen no es un `warehouse` propio sino directamente el proveedor — se modela permitiendo que `order.warehouse_id` referencie un almacén de tipo `external`, manteniendo el resto del flujo idéntico.

## Urgencias
Ver Prioridades; adicionalmente, un pedido puede marcarse `urgent` a posteriori (cambio de última hora del cliente), lo que dispara notificación inmediata al planificador si ya estaba en una ruta `optimized`/`assigned`.

## Tracking
Heredado del flujo operativo (Fase 4): el cliente y el operador ven el mismo timeline de estados, alimentado por los mismos eventos de `route_stop`/`shipment`/`tracking_event`.

## Documentación
`order_document` por pedido: albarán (generado al pasar a `loading`), carta de porte (generada al `dispatched`), POD (adjunta al `delivered`).

## Facturación
Vínculo opcional a `customer_invoice` (Fase 3) cuando el transporte es repercutible; en cualquier caso, el coste de transporte del pedido queda siempre calculado (vía `settlement_line` prorrateada) para análisis de margen, se facture o no al cliente.

## Integraciones
Recepción vía API desde ERP/e-commerce con el mismo contrato de validación que la entrada manual — ninguna vía de entrada se salta las reglas de negocio (Fase 4, gate `received → validated`).

## Siguiente paso
Continúo con la **Fase 15 — Inteligencia Artificial**.
