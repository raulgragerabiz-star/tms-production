# Motor de Optimización — TMS
### Fase 8 de `alimentacion_tms.md`

---

## Qué calcula automáticamente
Mejor transportista, mejor tarifa, mejor vehículo, mejor ruta, mejor combinación de pedidos, ocupación, peso, volumen, coste por parada/pedido/cliente.

## Arquitectura del motor (conceptual, sin código)

1. **Capa de generación de candidatos**: para una `route` en `draft`, se listan los `carrier` cuyo `service_type` coincide y cuya `vehicle_type` compatible cubre la ocupación del `load_plan` (peso y palés, respetando `allows_exceeding_pallets`).
2. **Capa de cálculo de coste** (usa el motor de Tarifas, Fase 9): para cada candidato, aplica `full_truck_rate` o `pallet_rate` vigente + `rate_surcharge` aplicables, produciendo un `cost_simulation` por candidato.
3. **Capa de secuenciación geográfica** (problema de rutas, tipo *Vehicle Routing Problem*): dado un conjunto de paradas, determina el orden que minimiza distancia o tiempo, respetando ventanas horarias — algoritmo de tipo heurístico (vecino más próximo + mejora local 2-opt) para tiempo real en el planificador, con opción de una pasada más profunda (metaheurística, ej. *simulated annealing* u OR-Tools) en modo "optimización nocturna" para el plan del día siguiente.
4. **Capa de selección**: ordena los `cost_simulation` de menor a mayor coste total y presenta el ranking; en modo automático, selecciona el primero salvo que viole una restricción dura (ventana horaria incumplida, incompatibilidad de temperatura, transportista con incidencias recientes recurrentes).

## Cálculos de ocupación
- **Peso**: suma de `order_line.line_weight_kg` de todas las `route_stop` de la ruta.
- **Palés**: suma de palés (completos + fracción de palés parciales, redondeando según política configurable — redondeo por exceso salvo que el negocio prefiera consolidar fracciones entre pedidos compatibles).
- **Volumen**: 🔧 *ampliación pendiente* — el Excel actual no trae dimensiones de palé, solo peso; el cálculo de volumen queda preparado en el modelo pero inactivo hasta disponer de ese dato (alto/ancho/largo de palé), momento en que se activará como tercera restricción de capacidad.
- **Metros lineales**: aplicable sobre todo a camión completo con carga no paletizable; mismo estado que volumen — preparado, no activo con los datos actuales.

## Coste por parada / pedido / cliente
- **Coste por parada**: para camión completo, `extra_stop_fee` prorrateado; para paletería, coste marginal de añadir esa parada al viaje (diferencia entre el coste de la ruta con y sin esa parada).
- **Coste por pedido**: coste de la parada repartido entre los pedidos que la componen, proporcional a su peso o palés (configurable).
- **Coste por cliente**: agregación histórica de coste por pedido, para el módulo de KPIs (Fase 16) y para poder repercutir el transporte si aplica (`customer_invoice`).

## Reoptimización
Disparadores: nuevo pedido urgente entra tras haber optimizado, un transportista rechaza una ruta ya asignada, o una incidencia deja una parada sin completar y hay que reordenar el resto del día. El motor reejecuta la capa de secuenciación solo sobre las paradas afectadas cuando es posible (reoptimización incremental), evitando recalcular rutas ya confirmadas y en curso salvo necesidad explícita.

## Límites y salvaguardas
- El motor nunca reasigna automáticamente una ruta ya `confirmed` por el transportista sin aviso explícito al planificador — evita romper compromisos ya aceptados.
- Toda sugerencia queda registrada (`cost_simulation`) aunque no se seleccione, para poder auditar después por qué se tomó una decisión distinta a la más barata (p. ej. por incidencias recurrentes de ese transportista).

## Siguiente paso
Continúo con la **Fase 9 — Gestión de Tarifas** (motor avanzado).
