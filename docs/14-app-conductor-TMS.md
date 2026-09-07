# Aplicación Móvil del Conductor — TMS
### Fase 13 de `alimentacion_tms.md`

---

## Alcance
App para el conductor habitual de cada vehículo (`driver`, `user_type = driver_app`), con acceso limitado a su ruta del día — nunca a datos de otros conductores ni a información comercial (tarifas, coste).

## Funcionalidad

- **Login**: simple, por teléfono/PIN o credencial proporcionada por su transportista — sin fricción, pensado para uso en cabina.
- **Ruta diaria**: lista de paradas del día en orden, con dirección, ventana horaria, y contenido resumido del pedido (nº de palés/bultos a entregar), reutilizando `route_stop` de la ruta asignada.
- **GPS**: envío continuo de posición mientras la app está activa en ruta, alimentando `tracking_event` (Fase 3) para el seguimiento en vivo del backoffice y del portal cliente.
- **Firma digital**: captura de firma en pantalla al completar cada parada, guardada como parte de `proof_of_delivery`.
- **Escaneo QR / código de barras**: para validar que la mercancía cargada/entregada corresponde al pedido esperado (cruce contra `order_line`/`product.sku`), reduciendo errores de entrega.
- **Fotografías**: adjuntas a la entrega (estado de la mercancía) o a una incidencia.
- **Incidencias**: registro rápido desde la parada afectada (tipo, descripción, foto), visible de inmediato en backoffice y portal transportista.
- **Navegación**: integración con navegación turn-by-turn (proveedor externo) hacia la siguiente parada de la secuencia optimizada.
- **Chat / mensajes**: mismo canal que el Portal Transportista (Fase 12), accesible desde el móvil para coordinarse con planificación sin salir de la app.
- **Documentos**: acceso a albarán/carta de porte de cada parada, descargable/visualizable offline.
- **Checklist**: lista de verificación configurable antes de salir a ruta (ej. "documentación cargada", "vehículo revisado") y/o al completar cada parada.
- **Estado del pedido**: cambio de estado de cada parada (llegada, entrega completada, fallida) directamente desde la app, disparando los eventos correspondientes (`route_stop.status`, Fase 3).
- **Modo offline**: la ruta del día, direcciones y checklist se descargan al iniciar sesión; las acciones realizadas sin cobertura (firma, foto, cambio de estado) se guardan localmente y se sincronizan en cuanto hay conexión, sin bloquear al conductor — crítico dado que buena parte de las entregas son en polígonos industriales con cobertura irregular.

## Diseño UX
Pantalla única de "ruta de hoy" como home, con cada parada como tarjeta grande y botones táctiles amplios (uso con guantes/en movimiento). Sin menús anidados profundos — máximo dos toques para cualquier acción crítica (firmar, fotografiar, reportar incidencia).

## Siguiente paso
Continúo con la **Fase 14 — Gestión de Pedidos** (módulo completo).
