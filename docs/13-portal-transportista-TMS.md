# Portal del Transportista — TMS
### Fase 12 de `alimentacion_tms.md`

---

## Alcance
Acceso independiente (autenticación propia, `user_type = carrier_portal`, ver Fase 2 §7) para que cada transportista gestione solo lo suyo — nunca visibilidad de otros transportistas ni de datos internos ajenos a sus propios viajes.

## Funcionalidad

- **Aceptar / rechazar viajes**: bandeja de rutas `assigned` pendientes de confirmación (Fase 4, paso 5); aceptar pasa a `confirmed`, rechazar la devuelve a `optimized` para reasignación y notifica al planificador con el motivo.
- **Ver documentación**: acceso a `order_document` de los pedidos de sus rutas asignadas (albarán, carta de porte).
- **Subir POD**: en movilidad o desde el portal, adjuntar `proof_of_delivery` (firma, fotos) por parada — mismo dato que alimenta la app de conductor (Fase 13), el portal es la vía de respaldo/gestión desde oficina.
- **Firmas y fotografías**: gestión centralizada de evidencias de entrega, descargables para sus propios registros.
- **GPS**: visualización de sus propios vehículos activos en el mapa de seguimiento, filtrado automáticamente a solo los suyos.
- **Chat**: canal de mensajería por ruta/envío entre planificador y transportista, con historial adjunto a `shipment` — evita depender de canales externos (WhatsApp/email) para incidencias operativas.
- **Incidencias**: pueden reportar una `incident` directamente desde el portal, con la misma estructura que usa el backoffice.
- **Facturación**: acceso a sus `carrier_settlement` — descarga de detalle y estado (borrador/validada/aprobada/pagada), con posibilidad de marcar una línea como `disputed` con comentario, iniciando el ciclo de revisión.
- **Liquidaciones**: histórico completo, filtrable por periodo.
- **Historial**: rutas realizadas, KPIs propios (los mismos que ve el gestor de flota sobre ellos, en modo espejo — transparencia como palanca de confianza, no solo control).

## Diseño UX del portal
Más simple que el backoffice interno: bandeja de entrada tipo "tareas pendientes" (viajes por aceptar, POD por subir, incidencias abiertas) como pantalla de inicio, en vez de un dashboard analítico — el transportista necesita saber "qué me falta por hacer hoy", no explorar KPIs globales.

## Seguridad
Scopes de API exclusivos por transportista (`carrier_id` fijo en el token), sin posibilidad de parametrizar consultas fuera de su propio alcance — se refuerza a nivel de backend, no solo de UI, dado que es acceso externo a la organización.

## Siguiente paso
Continúo con la **Fase 13 — Aplicación móvil del conductor**.
