# Flujo Operativo Completo — TMS
### Fase 4 de `alimentacion_tms.md`

---

## Diagrama general

```
Recepción del pedido → Planificación → Agrupación → Optimización → Asignación de transportista
   → Carga → Expedición → Seguimiento GPS → Entrega → Incidencias → Retornos → Facturación → KPIs
```

---

### 1. Recepción del pedido
**Entrada**: manual (operador) o integrada (ERP/e-commerce). Cada pedido se valida contra Maestros: `customer` y `delivery_point` deben existir y estar activos; cada `product` de las líneas debe existir en catálogo.
**Salida**: `order.status = received` → `validated` (o `cancelled` si falla validación, con motivo registrado en `audit_log`).
**Regla clave**: el pedido siempre debe fijar el `delivery_point_id` exacto, no solo el `customer_id` — si el cliente tiene varios puntos y el pedido entrante (ej. vía ERP) no lo especifica, el sistema lo deja en un estado `pending_delivery_point` que bloquea el paso a planificación hasta que un operador lo resuelve.

### 2. Planificación
El operador (o el sistema, si hay auto-planificación activada) agrupa pedidos `validated` con la misma fecha de entrega y warehouse en candidatos de `route`. Se decide aquí el `service_type` (camión completo vs. paletería) según volumen: si un único cliente/zona ocupa suficiente carga, se sugiere camión completo; si no, paletería consolidada con otros pedidos de la misma zona/fecha.
**Salida**: `route.status = draft`, con sus `route_stop` asociados.

### 3. Agrupación
Dentro de una `route` en `draft`, se puede fusionar con otra (dos rutas parciales de la misma zona) o dividir (una ruta sobredimensionada) antes de calcular la carga. El `load_plan` recalcula automáticamente peso y palés totales cada vez que cambia la composición de `route_stop`.

### 4. Optimización
Para cada `route` en `draft` con `load_plan` calculado, el motor de optimización (Fase 8) genera `cost_simulation` por cada `carrier` candidato y `vehicle_type` compatible con la ocupación, ordenados de más barato a más caro, usando la tarifa vigente en `route.route_date`. El planificador (o el motor en modo automático) marca una `cost_simulation.is_selected = true`.
**Salida**: `route.status = optimized`.

### 5. Asignación de transportista
Se fija `route.carrier_id` y `route.vehicle_id` según la simulación seleccionada. Si existe Portal Transportista, se notifica al transportista y la ruta pasa a `assigned`, a la espera de su aceptación (`confirmed`) o rechazo (`rejected`, que devuelve la ruta a `optimized` para reasignar).

### 6. Carga
El almacén confirma la carga física: se genera `shipment.status = loaded`. En este punto se puede reconciliar contra el WMS (integración) si la carga real difiere de la planificada — cualquier diferencia relevante genera una alerta antes de expedir.

### 7. Expedición
`shipment.status = in_transit`, `departed_at` se registra. Se emite la documentación (`order_document`: albarán, carta de porte) por cada pedido de la ruta.

### 8. Seguimiento GPS
Mientras `shipment.status = in_transit`, se reciben `tracking_event` (posición, llegadas/salidas de parada) desde telemática del transportista o desde la app del conductor. El ETA de cada `route_stop` pendiente se recalcula con cada evento relevante (ver Fase IA para el modelo predictivo).

### 9. Entrega
Al completar cada parada: `route_stop.status = completed`, se registra `proof_of_delivery` (firma, foto, nombre de quien recibe). Cuando todas las paradas están completadas o fallidas, `shipment.status = finished`.

### 10. Incidencias
Cualquier desviación (retraso, rechazo del cliente, daño, problema de acceso) se registra como `incident` vinculada a la `route_stop` afectada, sin bloquear el resto de la ruta. Las incidencias abiertas generan notificación a planificación y, si aplica, al portal del cliente afectado.

### 11. Retornos
Al confirmar la entrega en un `delivery_point`, el sistema consulta automáticamente `return_item` pendientes de ese `customer` y crea `return_claim` sobre el mismo `shipment` para el trayecto de vuelta. El conductor los recoge físicamente y se marca `collected`; lo no recogido vuelve a `pending` para el próximo viaje.

### 12. Facturación
Al cerrar un `shipment` (`finished`), se genera automáticamente una `settlement_line` por transportista, calculada contra la tarifa (`full_truck_rate` o `pallet_rate` + `rate_surcharge` aplicables) vigente en la fecha real del viaje. Estas líneas se agrupan periódicamente (semanal/mensual) en `carrier_settlement`, que sigue su propio ciclo de validación → aprobación → pago. Si aplica, se genera en paralelo `customer_invoice` cuando el transporte es repercutible al cliente.

### 13. KPIs
Todo el flujo anterior emite eventos de dominio consumidos de forma asíncrona por el módulo de BI (Fase 16): coste real vs. estimado, cumplimiento de ventana horaria (OTIF), ocupación real de cada `shipment`, incidencias por transportista/cliente/zona, tiempo medio de conciliación de retornos.

---

## Puntos de control (gates) del flujo

| Transición | Condición de bloqueo |
|---|---|
| `received → validated` | Cliente, punto de entrega y todos los productos deben existir y estar activos |
| `draft → optimized` | Debe existir al menos una `cost_simulation` válida (tarifa vigente disponible) |
| `optimized → assigned` | Ocupación del `load_plan` no debe superar el 100% de peso ni de palés (salvo `allows_exceeding_pallets = true` en el `vehicle_type`, y solo para palés, nunca para peso) |
| `assigned → confirmed` | Requiere aceptación explícita del transportista si el Portal Transportista está activo; si no, confirmación automática |
| `in_transit → finished` | Todas las `route_stop` deben estar en `completed` o `failed` (ninguna `pending`) |
| `shipment finished → settlement_line` | Debe existir una tarifa vigente que cubra la fecha real del viaje; si no existe, la línea queda en estado de excepción para revisión manual, nunca se factura con una tarifa fuera de vigencia |

---

## Siguiente paso
Continúo con la **Fase 5 — Diseño UX** (experiencia de usuario pantalla por pantalla, sin código).
