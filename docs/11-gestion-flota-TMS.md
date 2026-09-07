# Gestión de Vehículos (Flota) — TMS
### Fase 10 de `alimentacion_tms.md`

---

## Base real
6 tipos de vehículo con capacidad en kg y palés, y 6 vehículos concretos con matrícula, transportista, tipo y conductor habitual (Fase 1, §3.5). Ningún transportista tiene flota propia (`owns_fleet = No` en los 6). Ninguno gestiona temperatura distinta de ambiente ni ADR en los datos recibidos.

## Módulo — contenido funcional

**Tipos de vehículo** (`vehicle_type`): capacidad máxima en kg y en palés, indicador de si se permite superar el nº de palés (regla real ya detectada), y — como ampliación — capacidad en volumen/metros lineales cuando existan esos datos, y capacidad ADR/temperatura si el mix de producto lo exige en el futuro.

**Vehículos concretos** (`vehicle`): matrícula, matrícula de remolque si aplica, tipo, transportista propietario/operador, estado (activo/baja temporal/baja definitiva).

🔧 **Ampliaciones sobre el Excel** (no presentes en los datos, pero requeridas por el Prompt 10 y por buenas prácticas de flota subcontratada):
- **ITV**: fecha de última inspección y próxima caducidad, con alerta automática antes de vencer.
- **Seguro**: compañía, póliza, vigencia — igual, con alerta de caducidad.
- **Mantenimiento**: histórico de revisiones/averías, próxima revisión programada.
- **Combustible**: tipo (diésel/eléctrico/gas) — relevante para el cálculo de suplemento de combustible (Fase 9) y para KPIs de CO₂ (Fase 16).
- **Disponibilidad**: calendario por vehículo (disponible/reservado/en mantenimiento/de baja), consultado por el planificador y el motor de optimización antes de proponerlo como candidato.
- **Historial**: rutas realizadas, incidencias asociadas, ocupación media histórica — para retroalimentar al motor de optimización sobre fiabilidad real, no solo capacidad teórica.

## Conductores
Vinculados a vehículo mediante histórico de vigencia (`vehicle_driver`, Fase 3), no como campo fijo — permite que un vehículo cambie de conductor habitual sin perder trazabilidad de quién condujo cada envío pasado (relevante para POD e incidencias).

## Pantalla (extensión de Maestros, Fase 5)
Tabla de vehículos con columnas de estado de ITV/seguro (semáforo), disponibilidad hoy, y transportista. Detalle en panel lateral con pestañas: Datos, Documentación (ITV/seguro), Mantenimiento, Historial de rutas.

## Auditoría y API
Toda alta/baja/cambio de estado de vehículo queda en `audit_log`; API expuesta para que el propio Portal Transportista (Fase 12) pueda mantener sus propios vehículos y documentación sin intervención del backoffice, sujeto a validación antes de publicarse como disponible.

## Siguiente paso
Continúo con la **Fase 11 — Gestión de Transportistas**.
