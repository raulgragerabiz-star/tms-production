# Diseño UX — TMS
### Fase 5 de `alimentacion_tms.md` — Rol: diseñador UX SaaS B2B
### Sin código, solo experiencia de usuario

---

## Principios de UX

1. **Cero pantallas vacías de contexto**: cada pantalla arranca con lo más urgente (pendientes de hoy), nunca con un listado neutro.
2. **Todo es accionable desde la lista**: nunca obligar a entrar en el detalle solo para hacer una acción común (asignar, confirmar, exportar).
3. **Comparar antes de decidir**: siempre que exista más de una opción con coste distinto (transportista, vehículo), se muestran lado a lado, como Bringg muestra rutas alternativas.
4. **Progresividad tipo Notion/Linear**: formularios cortos por defecto, con "mostrar más campos" para los casos avanzados (suplementos, ADR, etc.), para no intimidar al usuario ocasional.
5. **Un color = un significado**, consistente en toda la app: verde=a tiempo/ok, ámbar=atención, rojo=incidencia/bloqueado, azul=informativo/en curso.

---

## Mapa de navegación

```
├── Inicio (Dashboard)
├── Pedidos
│   └── Detalle de pedido
├── Planificador
│   └── Detalle de ruta/carga
├── Seguimiento (mapa en vivo)
│   └── Detalle de envío
├── Retornos
├── Maestros
│   ├── Clientes
│   ├── Productos
│   ├── Transportistas
│   └── Flota
├── Tarifas
├── Facturación / Liquidaciones
├── Informes / KPIs
└── Configuración
    ├── Usuarios y roles
    └── Empresa / Almacenes
```

Navegación lateral fija (sidebar colapsable, estilo Linear), con buscador global arriba (⌘K) que busca pedidos, clientes y rutas por texto — patrón de paleta de comandos, no un buscador de campo único.

---

## Pantalla 1 — Dashboard (Inicio)
Ver Fase 6 en detalle. Resumen: 3 columnas — "Hoy" (pendientes urgentes), "En curso" (mapa + rutas activas), "Atención" (incidencias y alertas).

## Pantalla 2 — Pedidos (listado)
Tabla densa tipo Airtable/Monday: columnas Nº pedido, cliente, punto de entrega, fecha comprometida, estado (chip de color), palés/kg estimados, acciones rápidas (planificar, ver documentación). Filtros persistentes arriba (estado, almacén, fecha, cliente) y vista de "kanban por estado" como alternativa a la tabla, activable con un toggle — igual que Monday/ClickUp permiten cambiar de vista sin perder los filtros.

## Pantalla 3 — Detalle de pedido
Cabecera con estado y cliente; cuerpo en pestañas: **Líneas** (productos, con palés/kg calculados en vivo), **Documentación** (albarán, carta de porte, POD si ya entregado), **Historial** (timeline de estados), **Incidencias** (si las hay). Acción principal siempre visible arriba a la derecha, cambia según estado (p. ej. "Planificar" si está validado, "Ver seguimiento" si está en tránsito).

## Pantalla 4 — Planificador
Vista de dos paneles, como Bringg: **izquierda** = lista de pedidos pendientes de planificar (arrastrables), **derecha** = mapa con las rutas del día en construcción. Al arrastrar un pedido sobre una ruta existente, se recalcula en vivo la ocupación (barra de progreso de palés y de kg) y aparece de inmediato el desglose de coste estimado. Botones de "Fusionar rutas" y "Dividir ruta" disponibles con selección múltiple. Panel de "Comparar transportistas" desplegable por ruta, mostrando tabla ordenada de más barato a más caro (ver Pantalla 8).

## Pantalla 5 — Detalle de ruta/carga
Timeline vertical de paradas en orden, con ETA por parada, y un mapa con la secuencia dibujada. Indicador de ocupación (peso/palés) siempre visible arriba. Botón de "Asignar transportista" que abre el comparador de coste si aún no está asignado.

## Pantalla 6 — Seguimiento (mapa en vivo)
Mapa a pantalla completa con todos los envíos activos del día como puntos en movimiento; lista lateral filtrable por transportista/almacén. Clic en un envío abre panel lateral con su timeline de eventos sin salir del mapa (patrón "master-detail" como Bringg/Onfleet).

## Pantalla 7 — Retornos
Tabla por cliente con "pendiente / reclamado / recogido"; botón para forzar reclamación manual en un envío concreto. Vista secundaria por envío: qué retornos se están reclamando en ese viaje de vuelta.

## Pantalla 8 — Comparador de transportistas (componente reutilizado en Planificador y en Detalle de ruta)
Tabla simple: transportista | vehículo sugerido | coste estimado | ocupación resultante | tiempo estimado — ordenable, con la opción más barata resaltada por defecto pero sin ocultar las demás (transparencia de decisión, no caja negra).

## Pantalla 9 — Maestros (Clientes / Productos / Transportistas / Flota)
Patrón idéntico en los cuatro: tabla + buscador + botón "Nuevo", detalle en panel lateral deslizante (no navegación de página completa) para edición rápida sin perder el contexto de la lista — como Notion al abrir una fila.

## Pantalla 10 — Tarifas
Por transportista, dos pestañas (Camión completo / Paletería), cada una mostrando la tarifa vigente destacada y un historial de vigencias anteriores colapsado debajo. Botón "Nueva tarifa" siempre pide fecha de inicio y no permite solape con la vigente (validación en línea, no tras guardar).

## Pantalla 11 — Facturación / Liquidaciones
Listado de liquidaciones por transportista y periodo, con total y estado (borrador/validada/aprobada/pagada). Al entrar, tabla de líneas (un envío por fila) con el desglose de cálculo visible en tooltip, para poder auditar sin salir de la pantalla.

## Pantalla 12 — Informes / KPIs
Ver Fase 16. Resumen: filtros arriba (periodo, almacén, transportista), grid de tarjetas de KPI con tendencia, y gráficos exportables.

## Pantalla 13 — Configuración
Gestión de usuarios/roles (tabla simple con rol asignable por dropdown), datos de empresa y almacenes, e integraciones (estado de conexión ERP/WMS/GPS con indicador verde/rojo).

---

## Patrones de interacción transversales
- **Toasts, no modales bloqueantes**, para confirmaciones simples (guardado, asignación).
- **Modales solo para decisiones irreversibles** (cancelar pedido, eliminar tarifa vigente).
- **Estados vacíos con acción**, nunca un "no hay datos" seco — siempre con el botón para crear el primer registro.
- **Todo es exportable a CSV/Excel** desde cualquier tabla, con un único botón consistente en la esquina superior derecha.

---

## Siguiente paso
Continúo con la **Fase 6 — Dashboard principal** (detalle de cada widget).
