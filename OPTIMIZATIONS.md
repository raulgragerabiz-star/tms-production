# Optimizaciones de recursos — pasada 4

Revisión de rendimiento sobre todo lo construido en las pasadas 1-3, antes
de considerar el delta cerrado para producción. Ninguna optimización aquí
cambia comportamiento observable — mismos resultados, menos trabajo para
conseguirlos.

## Backend

| Optimización | Antes | Después | Impacto |
|---|---|---|---|
| **Cache de reglas de segmentación** (`memory-cache.ts` + `getActiveSegmentationRules`) | 1 SELECT de `service_segmentation_rule` por cada pedido clasificado | 1 SELECT cada 5 min por empresa (TTL cache), resto en memoria | Un import de 500 pedidos pasa de 500 queries a 1 |
| **Precarga de productos en el bridge ERP** (`erpclaud.service.ts`) | 1 SELECT de productos por pedido (dentro del bucle) | 1 SELECT de todos los SKUs del lote, antes del bucle | De N queries a 1, independientemente del tamaño del lote |
| **`createMany` para líneas de pedido** | 1 INSERT por línea (bucle) | 1 INSERT por pedido (todas las líneas de golpe) | De N round-trips a 1 por pedido |
| **`createMany` con `skipDuplicates` para tracking_event** | 1 INSERT + manejo de excepción P2002 por ping (bucle) | 1 INSERT con `ON CONFLICT DO NOTHING` para todo el lote | Un lote offline de 100 pings pasa de 100 round-trips a 1 |
| **Índice de rejilla (grid) en zone-grouping** | O(n²) — cada pedido comparado con todos los demás de la provincia | ~O(n) — solo se compara contra la celda + 8 vecinas | 400 pedidos/provincia: de ~160.000 a unos pocos miles de cálculos Haversine |
| **Borrado en lotes del job de limpieza QR** | 1 `DELETE` sin límite sobre toda la tabla | Lotes de 1.000 filas (config `QR_TOKEN_CLEANUP_BATCH_SIZE`) | Evita locks largos/picos de I/O si la tabla crece mucho |
| **audit_log solo si el job tuvo efecto** | 1 INSERT diario aunque no se borrara nada | 0 INSERT si `deletedCount === 0` | Menos escrituras en el caso común (nada que limpiar) |
| **Índice compuesto en `Order`** para idempotencia del bridge ERP | `findFirst` por `externalOrderId` sin índice dedicado (seq scan) | `@@index([companyId, externalSourceSystem, externalOrderId])` | Búsqueda de idempotencia pasa de escaneo secuencial a index scan |
| **`select` explícito en `classifyOrder`** | `include` de la relación completa de `product` | `select` solo de los 2 campos realmente usados (`unitsPerPallet`, `fullPalletWeightKg`) | Menos bytes serializados por Prisma en cada clasificación |

## Frontend — App Conductor (batería del dispositivo)

| Optimización | Antes | Después | Impacto |
|---|---|---|---|
| **Polling adaptativo de sincronización** (`useOfflineSync.ts`) | `setInterval` fijo cada 5s, siempre activo | Solo se activa si hay cola pendiente o no hay conexión; se apaga solo al vaciarse | En un turno de 8h con la app la mayor parte del tiempo sincronizada: de ~5.760 comprobaciones a prácticamente 0 |
| **Intervalo de reintento ampliado** | 5s | 20s (solo mientras hay cola) | 4x menos wake-ups del dispositivo mientras hay algo pendiente |
| **Pausa en segundo plano** (`visibilitychange`) | El intervalo seguía corriendo con la pantalla apagada/app minimizada | Se detiene por completo, se retoma al volver a primer plano | Sin consumo de CPU/batería con el móvil bloqueado |
| **Filtro de distancia mínima en GPS** (`gpsTracker.ts`, ya existente desde la pasada 2, documentado aquí por completitud) | — | Descarta pings a menos de 20m del anterior | Menos escritura en `tracking_event` con el vehículo parado (carga/descarga) |

## Qué NO se ha optimizado (deliberado, no bloqueante)

- **Rate limiter en memoria** (`express-rate-limit` sin store compartido): válido para una sola instancia del backend. Si en el futuro el backend escala a múltiples instancias (Versión Enterprise), hace falta un store compartido (Redis) — no se añade ahora porque supondría infraestructura adicional sin necesidad actual, mismo criterio ya aplicado al scheduler de jobs y al cache en memoria.
- **`groupOrdersIntoZones` sigue siendo O(n²) dentro de cada celda de la rejilla**: aceptable porque una celda de ~15km de radio en una provincia real no debería concentrar cientos de pedidos; si algún día ocurre, el mismo patrón de rejilla puede anidarse recursivamente.
- **No se ha introducido paginación cursor-based** en los listados (`GET /customer-portal/orders`, etc.): los `take: 50`/`take: 200` ya existentes acotan el resultado; paginación completa se deja para cuando el volumen real lo justifique.

## Cómo verificar el impacto tras aplicar el delta
```bash
# Import de prueba con 200 pedidos sintéticos — comparar tiempo total
# antes/después de aplicar erpclaud.service.ts optimizado.
# (usar el mismo payload contra ambas versiones del fichero)

# Conteo de queries por request — activar el log de Prisma temporalmente:
# DATABASE_URL=... DEBUG="prisma:query" npm run dev
```
