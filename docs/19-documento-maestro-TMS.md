# Documento Maestro del Proyecto — TMS
### Fase 18 de `alimentacion_tms.md` (final) — Rol: arquitecto de software senior
### Síntesis de las Fases 1-17

---

## 1. Visión del producto
Ver **Fase 1** (`02-documento-funcional-TMS.md`). Sistema operativo de expediciones propio para una distribuidora industrial con flota 100% subcontratada, combinando dos modelos de venta de transporte (camión completo y paletería), con el palé como unidad atómica de planificación y el coste calculado antes de decidir, no después. Fuente de verdad del modelo de negocio: `Recogida_Datos_Demo_Expediciones.xlsx` (149 puntos de entrega, 8.957 productos, 6 transportistas con tarifas versionadas, 691 líneas de pedido de muestra), reconciliable con la fuente histórica `tms_getafe.html` / `ruta_pinto_clientes.xlsx` mediante el código de cliente de 6 dígitos como identificador canónico.

## 2. Arquitectura
Ver **Fase 2** (`03-arquitectura-TMS.md`). 10 bounded contexts (Identity & Access, Master Data, Pricing, Order Management, Planning, Execution & Tracking, Reverse Logistics, External Access, Billing, Intelligence), event-driven, API-first, multiempresa/multialmacén desde el diseño. Regla de dependencia: los contextos operativos dependen de Master Data y Pricing; Intelligence y BI son siempre consumidores de eventos, nunca productores de reglas operativas salvo automatización explícita.

## 3. Módulos
Mapa completo de 13 bloques funcionales (Plataforma, Maestros, Tarifas, Pedidos, Planificación, Optimización, Expedición y Seguimiento, Retornos, Portales, App Conductor, Facturación, IA, BI) — ver Fase 2, §1.

## 4. Procesos
Flujo operativo completo de 13 pasos, de la recepción del pedido a los KPIs, con sus *gates* de bloqueo entre estados — ver **Fase 4** (`05-flujo-operativo-TMS.md`).

## 5. Entidades
Listado completo de entidades por módulo con cardinalidades — ver Fase 2, §3, y detalle exhaustivo de campos en la Fase 3.

## 6. Base de datos
Modelo relacional completo: 30+ tablas, PK/FK, restricciones de no-solape de vigencias, índices críticos, campos calculados y política de soft delete — ver **Fase 3** (`04-modelo-bd-TMS.md`).

## 7. APIs
Principio API-first fijado desde la Fase 1: cada módulo se diseña como API antes que como pantalla. Integraciones previstas con ERP (entrada de pedidos, salida de liquidaciones), WMS (confirmación real de carga), CRM (contacto/incidencias), GPS/telemática (tracking en vivo) y e-commerce (pedidos directos) — ver Fase 2, §8. Los Portales (Cliente, Transportista) y la App Conductor consumen estas mismas APIs con scopes restringidos por rol.

## 8. Permisos
RBAC multiempresa con 8 roles funcionales base (admin_plataforma, admin_empresa, planificador, gestor_flota, administración, usuario_cliente, usuario_transportista, conductor), autenticación independiente para portales externos, y auditoría completa de toda mutación sobre Pedidos, Tarifas, Liquidaciones y Maestros — ver Fase 2, §7.

## 9. Interfaz
Diseño UX completo pantalla por pantalla (13 pantallas + patrones transversales), inspirado en Bringg/Tookan/Monday/Linear/Notion pero no copiado de ninguno — ver **Fase 5** (`06-diseno-ux-TMS.md`). Dashboard principal con 3 zonas (Hoy / En curso / Atención) — ver **Fase 6** (`07-dashboard-TMS.md`). Planificador con drag & drop, fusión/división de rutas y comparador de coste en vivo — ver **Fase 7** (`08-planificador-rutas-TMS.md`).

## 10. Automatizaciones
Motor de optimización (candidatos → coste → secuenciación geográfica → selección) con reoptimización incremental ante eventos — ver **Fase 8** (`09-motor-optimizacion-TMS.md`). Reclamación automática de retornos en el viaje de vuelta. Generación automática de `settlement_line` al cerrar cada envío, contra la tarifa vigente en la fecha real del viaje.

## 11. Reglas de negocio
Modelo de tarifas extensible (fijo, por km, por palé, por kg, por volumen, por zona/provincia, por cliente, por ruta) con suplementos acumulables (combustible, ADR, temperatura, esperas, retornos, peajes, festivos), resuelto por orden de prioridad y siempre por vigencia temporal exacta — ver **Fase 9** (`10-gestion-tarifas-TMS.md`). Regla real de ocupación: el peso nunca puede superar la capacidad del vehículo, los palés sí pueden superarla si el `vehicle_type` lo permite explícitamente.

## 12. Integraciones
Ver punto 7 y Fase 2, §8. Diseñadas como adaptadores desacoplados del núcleo, para no atar el TMS a ningún sistema externo concreto.

## 13. Inteligencia artificial
8 capacidades diseñadas (predicción de ETA/retrasos, estimación de costes, predicción de demanda, detección de anomalías, optimización automática opt-in, detección de rutas ineficientes, copiloto conversacional, alertas inteligentes), todas consumidoras de eventos de dominio y nunca sustitutas de decisión humana salvo activación explícita — ver **Fase 15** (`16-inteligencia-artificial-TMS.md`). Requieren volumen histórico suficiente; el MVP las lanza en modo heurístico/reglas, migrando a ML según se acumule histórico real.

## 14. Roadmap
MVP (~26-30 semanas) → Versión 1 (operación asistida: GPS en vivo, app conductor, retornos, portal cliente) → Versión 2 (ecosistema de terceros: portal transportista completo, tarifas avanzadas, integraciones) → Versión 3 (inteligencia: predicción, anomalías, optimización automática) → Versión Enterprise (multiempresa avanzada, copiloto, CO₂, cross-dock, dropshipping) — ver **Fase 17** (`18-roadmap-desarrollo-TMS.md`). Ninguna funcionalidad descrita en este documento se elimina; solo se prioriza en el tiempo.

## 15. Módulos complementarios de negocio
- **Flota**: capacidad, ITV, seguro, mantenimiento, combustible, disponibilidad, historial — ver **Fase 10** (`11-gestion-flota-TMS.md`).
- **Transportistas**: contratos, tarifas, KPIs, ranking, OTIF, evaluación automática — ver **Fase 11** (`12-gestion-transportistas-TMS.md`).
- **Portal Transportista**: aceptar/rechazar viajes, POD, chat, liquidaciones, disputas — ver **Fase 12** (`13-portal-transportista-TMS.md`).
- **App Conductor**: ruta diaria, GPS, firma, escaneo, incidencias, modo offline — ver **Fase 13** (`14-app-conductor-TMS.md`).
- **Pedidos**: estados, backorders, cross-dock, dropshipping, urgencias — ver **Fase 14** (`15-gestion-pedidos-TMS.md`).
- **BI/KPIs**: 150+ indicadores generados sistemáticamente por combinación de métricas base × dimensiones — ver **Fase 16** (`17-kpis-bi-TMS.md`).

## 16. Decisiones de diseño que quedan fijadas para el equipo de desarrollo
1. Código de cliente de 6 dígitos como identificador de negocio canónico (Fase 1).
2. Cliente y Punto de entrega como entidades separadas 1→N (Fase 1, Fase 3).
3. Palé como unidad de cálculo de capacidad, con límites independientes de peso y nº de palés (Fase 1, Fase 8, Fase 9).
4. Tarifas versionadas por vigencia, nunca un valor mutable único (Fase 3, Fase 9).
5. Camión completo y paletería como dos modelos de tarifa/planificación que conviven, no módulos aislados (Fase 1, Fase 9).
6. Retornos como parte del ciclo de vida del pedido, no módulo aislado (Fase 1, Fase 4).
7. IA y BI como consumidores de eventos, nunca productores de reglas operativas sin activación explícita (Fase 2, Fase 15).
8. Ninguna liquidación se calcula contra la tarifa "actual": siempre contra la vigente en la fecha real del viaje (Fase 3, Fase 4, Fase 9).

## 17. Estado del proyecto
Con este documento se cierra el ciclo completo de `alimentacion_tms.md` (Prompts 1-18). El conjunto de 17 documentos generados (Fases 1-17, listados en la sección anterior con su nombre de archivo) constituye, junto a este Documento Maestro, la base funcional, arquitectónica, de datos y de producto suficiente para que un equipo de desarrollo inicie la implementación del MVP sin necesidad de análisis funcional adicional, conforme a lo solicitado.

No se ha detectado ninguna contradicción irresoluble en los datos ni en los requisitos a lo largo de las 18 fases; las carencias encontradas frente al Excel de origen se han resuelto como ampliaciones justificadas y marcadas explícitamente (🔧) en cada fase correspondiente, manteniendo en todo momento compatibilidad con la información real ya existente.
