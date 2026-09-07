# Gestión de Tarifas — TMS
### Fase 9 de `alimentacion_tms.md`

---

## Base real (Excel) vs. ampliación pedida

La base real hoy son dos modelos (Fase 1, §3.6-3.7): **camión completo** (km incluidos + parada adicional + km extra) y **paletería** (fijo por albarán + bulto suelto + techo de peso por palé). El Prompt 9 pide un motor mucho más rico (precio fijo, por km, por provincia, por zona, por palé, por kg, por volumen, por cliente, por ruta, suplementos: combustible, ADR, temperatura, esperas, retornos, peajes, festivos). Se diseña como una **extensión aditiva** del modelo real, no una sustitución.

## Modelo de reglas de tarifa

Cada `carrier` tiene, por servicio, una **tarifa base** (una de las siguientes estrategias, seleccionable):
- `fixed` — importe fijo por viaje/pedido.
- `per_km` — importe por kilómetro recorrido (con o sin km incluidos, como hoy en camión completo).
- `per_pallet` — importe por palé transportado.
- `per_kg` — importe por kilo.
- `per_volume` — importe por m³ (activo cuando exista el dato de volumen, ver Fase 8).
- `by_zone` — tabla de importes fijos por zona de destino (agrupación de provincias/CP).
- `by_province` — tabla de importes por provincia.
- `by_customer` — tarifa negociada específica para un cliente concreto, con prioridad sobre la tarifa general del transportista.
- `by_route` — tarifa fija para una ruta habitual predefinida.

Sobre la tarifa base se aplican **suplementos acumulables** (`rate_surcharge`, Fase 3): combustible (% variable, indexable a un índice de referencia), ADR (fijo o %, solo si el pedido lo requiere), temperatura (fijo, solo si `carrier.temperature_capability ≠ ambient` y el producto lo exige), esperas (por hora/fracción a partir de un tiempo franquicia), retornos (coste adicional si el viaje incluye recogida de `return_claim`), peajes (importe real o estimado por ruta), festivos (recargo % sobre tarifa base si `route_date` cae en festivo del calendario configurado).

## Resolución de precio (orden de prioridad)
1. Tarifa `by_customer` específica, si existe para ese cliente y transportista.
2. Tarifa `by_route`, si la ruta está predefinida como habitual.
3. Tarifa `by_zone`/`by_province`, si aplica.
4. Tarifa base general del transportista (`per_km`/`per_pallet`/`per_kg`/`fixed`, según el `service_type`).
5. Suma de todos los `rate_surcharge` vigentes y aplicables según las condiciones del pedido/ruta concreto.

Este orden se resuelve siempre contra la **vigencia correcta** (`valid_from`/`valid_to` que cubra la fecha del viaje), nunca contra "la tarifa actual" — coherente con la Fase 3.

## Configuración
Pantalla de reglas por transportista (extensión de la Pantalla 10, Fase 5): cada regla se activa/desactiva de forma independiente, con simulador integrado ("¿cuánto costaría este pedido/ruta con esta configuración?") para validar antes de publicar un cambio de tarifa.

## Trazabilidad
Todo cálculo de coste (`cost_simulation` y, más tarde, `settlement_line`) guarda el desglose completo (`cost_breakdown`/`breakdown` JSONB) de qué regla y qué suplementos se aplicaron — imprescindible para poder auditar o disputar una liquidación.

## Siguiente paso
Continúo con la **Fase 10 — Gestión de Vehículos (Flota)**.
