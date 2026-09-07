# Modelo de Base de Datos — TMS
### Fase 3 de `alimentacion_tms.md`

---

## 0. Convenciones
- PK: `id` (UUID) en todas las tablas salvo catálogos cerrados pequeños (INT).
- Toda tabla de negocio incluye: `company_id` (FK, multiempresa), `created_at`, `updated_at`, `created_by`, `updated_by`, `deleted_at` (soft delete).
- Los campos monetarios son `NUMERIC(12,4)` con `currency CHAR(3)`.
- Los rangos de vigencia usan `valid_from DATE NOT NULL`, `valid_to DATE NULL` (NULL = vigente indefinidamente), con restricción de no solapamiento por transportista+servicio (`EXCLUDE USING gist`).

---

## 1. Plataforma

**`company`** — `id PK`, `name`, `tax_id UNIQUE`, `active BOOL`
**`warehouse`** — `id PK`, `company_id FK→company`, `name`, `address`, `postal_code`, `city`, `province`, `country`, `lat`, `lng`, `loading_hours_json`, `active`
- Índice: `(company_id, active)`

**`app_user`** — `id PK`, `company_id FK`, `email UNIQUE`, `password_hash`, `full_name`, `user_type ENUM(internal, customer_portal, carrier_portal, driver_app)`, `active`
**`role`** — `id PK`, `company_id FK NULL` (NULL = rol de sistema), `name`
**`permission`** — `id PK`, `code UNIQUE` (ej. `orders.write`, `rates.approve`)
**`role_permission`** — `role_id FK`, `permission_id FK` — PK compuesta
**`user_role`** — `user_id FK`, `role_id FK` — PK compuesta
**`audit_log`** — `id PK`, `company_id FK`, `user_id FK`, `entity_name`, `entity_id`, `action ENUM(create,update,delete)`, `old_value JSONB`, `new_value JSONB`, `created_at`
- Índice: `(entity_name, entity_id, created_at)`

---

## 2. Maestros

**`customer`** — `id PK`, `company_id FK`, `business_code VARCHAR(10) UNIQUE` *(código de 6 dígitos real, ej. "488000")*, `legal_name`, `commercial_name`, `tax_id`, `active`
- Índice único: `(company_id, business_code)`

**`delivery_point`** — `id PK`, `customer_id FK→customer`, `label`, `address`, `postal_code`, `city`, `province ENUM/FK→province_catalog`, `country`, `lat`, `lng`, `unload_hours_json`, `contact_phone`, `contact_email`, `exchanges_pallets BOOL`, `active`
- FK: `customer_id → customer.id ON DELETE RESTRICT`
- Índice: `(customer_id)`, `(postal_code)`

**`province_catalog`** — `id PK`, `name UNIQUE`, `country_code` *(catálogo cerrado para normalizar "Madrid"/"MADRID"/"C. Real" detectados en Fase 1)*

**`product`** — `id PK`, `company_id FK`, `sku VARCHAR UNIQUE`, `description`, `sales_unit`, `units_per_pallet INT`, `gross_weight_kg NUMERIC`, `net_weight_kg NUMERIC`, `full_pallet_weight_kg NUMERIC` *(calculado o validado: ≈ units_per_pallet × gross_weight_kg)*, `requires_cold BOOL`, `is_returnable BOOL`, `carriage_note_description`, `active`
- Campo calculado: `full_pallet_weight_kg` se valida en aplicación contra `units_per_pallet * gross_weight_kg`; se almacena porque el Excel real trae discrepancias de redondeo que hay que preservar tal cual las declaró el cliente.

**`carrier`** — `id PK`, `company_id FK`, `legal_name`, `tax_id UNIQUE`, `city`, `province FK`, `service_type ENUM(full_truck, pallet, both)`, `owns_fleet BOOL`, `temperature_capability ENUM(ambient, refrigerated, frozen, mixed)`, `notes`, `active`

**`vehicle_type`** — `id PK`, `name`, `max_weight_kg NUMERIC`, `max_pallets INT`, `allows_exceeding_pallets BOOL`

**`vehicle`** — `id PK`, `carrier_id FK→carrier`, `vehicle_type_id FK→vehicle_type`, `plate VARCHAR UNIQUE`, `trailer_plate VARCHAR NULL`, `working_temperature`, `active`

**`driver`** — `id PK`, `carrier_id FK→carrier`, `full_name`, `tax_id UNIQUE`, `phone`, `active`
**`vehicle_driver`** — `id PK`, `vehicle_id FK`, `driver_id FK`, `valid_from DATE`, `valid_to DATE NULL` *(histórico de conductor habitual, no 1:1 fijo)*

---

## 3. Tarifas

**`full_truck_rate`** — `id PK`, `carrier_id FK`, `valid_from DATE`, `valid_to DATE NULL`, `included_km NUMERIC`, `extra_stop_fee NUMERIC`, `extra_km_fee NUMERIC`, `currency`
- Restricción: `EXCLUDE` por `(carrier_id, daterange(valid_from, valid_to))` sin solape.

**`pallet_rate`** — `id PK`, `carrier_id FK`, `valid_from DATE`, `valid_to DATE NULL`, `fixed_fee_per_note NUMERIC`, `loose_item_fee NUMERIC`, `max_weight_per_pallet_kg NUMERIC`, `currency`
- Misma restricción de no-solape que `full_truck_rate`.

**`rate_surcharge`** — `id PK`, `carrier_id FK`, `surcharge_type ENUM(fuel, adr, holiday, toll, waiting_time, zone)`, `calculation_mode ENUM(fixed, percentage, per_km, per_hour)`, `value NUMERIC`, `valid_from`, `valid_to NULL`
🔧 *Ampliación sobre el Excel: no existían suplementos en los datos recibidos; tabla preparada para el Prompt 9 (motor avanzado de tarifas).*

---

## 4. Pedidos

**`order`** — `id PK`, `company_id FK`, `order_number VARCHAR UNIQUE`, `customer_id FK`, `delivery_point_id FK→delivery_point`, `warehouse_id FK`, `status ENUM(received,validated,planned,loading,dispatched,in_transit,delivered,incident,cancelled)`, `priority ENUM(standard,urgent)`, `requested_delivery_date DATE`, `delivery_time_window_from TIME NULL`, `delivery_time_window_to TIME NULL`, `notes TEXT`, `service_type ENUM(full_truck, pallet)`
- Índice: `(company_id, status)`, `(delivery_point_id)`, `(requested_delivery_date)`

**`order_line`** — `id PK`, `order_id FK→order ON DELETE CASCADE`, `product_id FK→product`, `quantity NUMERIC`, `unit VARCHAR`
- Campos calculados (vista o trigger): `line_weight_kg = quantity * product.gross_weight_kg / product.units_per_pallet_ratio` *(cálculo real: si `unit` es "UD", `quantity * gross_weight_kg`; si es palés completos, `quantity * full_pallet_weight_kg`)*
- Índice: `(order_id)`, `(product_id)`

**`order_document`** — `id PK`, `order_id FK`, `document_type ENUM(delivery_note, carriage_note, pod, invoice)`, `file_url`, `created_at`

---

## 5. Planificación

**`route`** — `id PK`, `company_id FK`, `warehouse_id FK`, `route_date DATE`, `status ENUM(draft,optimized,assigned,confirmed,in_progress,closed,rejected)`, `service_type ENUM(full_truck,pallet)`, `carrier_id FK NULL`, `vehicle_id FK NULL`

**`route_stop`** — `id PK`, `route_id FK→route ON DELETE CASCADE`, `order_id FK→order`, `sequence INT`, `eta TIMESTAMP NULL`, `status ENUM(pending,arrived,completed,failed)`
- Índice único: `(route_id, sequence)`

**`load_plan`** — `id PK`, `route_id FK UNIQUE`, `total_weight_kg NUMERIC` *(calculado: suma de `order.order_line.line_weight_kg` de todos los `route_stop`)*, `total_pallets NUMERIC` *(calculado)*, `weight_occupancy_pct NUMERIC` *(calculado: `total_weight_kg / vehicle_type.max_weight_kg`)*, `pallet_occupancy_pct NUMERIC` *(calculado, análogo)*

---

## 6. Optimización

**`cost_simulation`** — `id PK`, `route_id FK`, `carrier_id FK`, `vehicle_type_id FK`, `estimated_cost NUMERIC`, `cost_breakdown JSONB` *(desglose: km, paradas, suplementos)*, `is_selected BOOL`, `created_at`
- Índice: `(route_id, is_selected)`

---

## 7. Expedición y seguimiento

**`shipment`** — `id PK`, `route_id FK UNIQUE`, `carrier_id FK`, `vehicle_id FK`, `driver_id FK`, `status ENUM(programmed,loaded,in_transit,finished)`, `departed_at TIMESTAMP NULL`, `finished_at TIMESTAMP NULL`

**`tracking_event`** — `id PK`, `shipment_id FK ON DELETE CASCADE`, `event_type ENUM(gps_ping,stop_arrival,stop_departure,status_change)`, `lat NULL`, `lng NULL`, `payload JSONB`, `occurred_at TIMESTAMP`
- Índice: `(shipment_id, occurred_at)`

**`incident`** — `id PK`, `shipment_id FK`, `route_stop_id FK NULL`, `incident_type ENUM(delay,damage,refused,access_issue,other)`, `description`, `status ENUM(open,resolved,escalated)`, `reported_by FK→app_user`, `created_at`

**`proof_of_delivery`** — `id PK`, `route_stop_id FK UNIQUE`, `signature_url`, `photo_urls JSONB`, `received_by_name`, `delivered_at TIMESTAMP`

---

## 8. Retornos

**`return_item`** — `id PK`, `customer_id FK`, `item_description`, `pending_quantity NUMERIC`, `notes`, `status ENUM(pending, claimed, collected, reconciled)`

**`return_claim`** — `id PK`, `shipment_id FK`, `return_item_id FK`, `claimed_quantity NUMERIC`, `collected_quantity NUMERIC NULL`, `status ENUM(pending, collected, not_available)`

---

## 9. Facturación

**`carrier_settlement`** — `id PK`, `carrier_id FK`, `period_from DATE`, `period_to DATE`, `status ENUM(draft,validated,approved,paid,disputed)`, `total_amount NUMERIC` *(calculado: suma de sus `settlement_line`)*

**`settlement_line`** — `id PK`, `carrier_settlement_id FK ON DELETE CASCADE`, `shipment_id FK`, `applied_rate_id FK NULL` *(referencia a `full_truck_rate` o `pallet_rate` vigente en la fecha real del viaje)*, `amount NUMERIC`, `breakdown JSONB`

**`customer_invoice`** — `id PK`, `customer_id FK`, `order_id FK NULL`, `amount NUMERIC`, `status ENUM(draft,issued,paid)`
🔧 *Solo si el transporte es facturable al cliente; opcional según modelo de negocio.*

---

## 10. Relación entidad-relación (resumen textual)

```
company 1─N warehouse
company 1─N customer 1─N delivery_point
company 1─N product
company 1─N carrier 1─N vehicle N─1 vehicle_type
carrier 1─N driver
vehicle N─N driver (vía vehicle_driver, con vigencia)
carrier 1─N full_truck_rate (vigencias sin solape)
carrier 1─N pallet_rate (vigencias sin solape)
carrier 1─N rate_surcharge
customer 1─N order N─1 delivery_point N─1 warehouse
order 1─N order_line N─1 product
warehouse 1─N route 1─N route_stop N─1 order
route 1─1 load_plan
route 1─N cost_simulation N─1 carrier
route 1─1 shipment N─1 carrier, N─1 vehicle, N─1 driver
shipment 1─N tracking_event
shipment 1─N incident
route_stop 1─1 proof_of_delivery
customer 1─N return_item 1─N return_claim N─1 shipment
carrier 1─N carrier_settlement 1─N settlement_line N─1 shipment
```

---

## 11. Índices críticos de rendimiento (miles de pedidos/día)

- `order (company_id, status, requested_delivery_date)` — listado diario de pendientes.
- `route_stop (route_id, sequence)` — reconstrucción de ruta ordenada.
- `tracking_event (shipment_id, occurred_at DESC)` — última posición.
- `settlement_line (carrier_settlement_id)` y `(shipment_id)` — conciliación bidireccional.
- `audit_log (entity_name, entity_id, created_at DESC)` — histórico por entidad.
- Particionado recomendado (a nivel de infraestructura, no de este documento): `tracking_event` y `audit_log` por mes, dado su volumen de escritura.

---

## 12. Restricciones de integridad relevantes

- `order_line.quantity > 0`
- `product.units_per_pallet > 0`
- `full_truck_rate` / `pallet_rate`: no solape de vigencia por `carrier_id` (constraint `EXCLUDE`).
- `route_stop.sequence` único dentro de cada `route_id`.
- `settlement_line.applied_rate_id`: al crearse, debe resolverse contra la tarifa cuya vigencia cubra `shipment.finished_at`, nunca la tarifa "actual" — se fija en el momento de generar la línea (inmutable después, salvo reapertura explícita vía estado `disputed`).
- Soft delete (`deleted_at`) en todas las tablas de Maestros: nunca se borra físicamente un `customer`, `product`, `carrier` o `vehicle` referenciado por pedidos/envíos históricos.

---

## Siguiente paso
Continúo con la **Fase 4 — Flujo operativo completo** (de la recepción del pedido a la facturación, paso a paso).
