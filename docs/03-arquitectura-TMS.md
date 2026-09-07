# Arquitectura del Sistema — TMS

### Fase 2 de `alimentacion\_tms.md` — Arquitectura completa

### Continúa directamente desde la Fase 1 (Documento Funcional)

\---

## 0\. Enfoque

Se diseña como un **ERP modular**: un núcleo de plataforma (identidad, permisos, auditoría, configuración multiempresa) y un conjunto de **módulos de negocio independientes pero interconectados por eventos**, cada uno con sus propias entidades, estados y permisos, tal y como pide el Prompt 2. No se escribe código; esto es el plano sobre el que se construirá el modelo de datos (Fase 3) y el resto de fases funcionales.

\---

## 1\. Mapa de módulos y submódulos

```
TMS
├── 00. PLATAFORMA (núcleo transversal)
│   ├── Identidad y Accesos (usuarios, roles, permisos, empresas)
│   ├── Configuración multiempresa / multialmacén
│   ├── Auditoría y trazabilidad
│   ├── Notificaciones (email, push, portal)
│   └── Integraciones (ERP, WMS, CRM, GPS, e-commerce)
│
├── 01. MAESTROS
│   ├── Almacenes
│   ├── Clientes y Puntos de entrega
│   ├── Catálogo de producto
│   ├── Transportistas
│   ├── Flota (tipos de vehículo, vehículos, conductores)
│   └── Zonas y calendario de servicio
│
├── 02. TARIFAS
│   ├── Tarifas de camión completo
│   ├── Tarifas de paletería
│   ├── Suplementos y recargos (combustible, ADR, festivos, peajes, esperas)
│   └── Vigencias y versionado
│
├── 03. PEDIDOS
│   ├── Recepción de pedidos (manual / integración ERP)
│   ├── Validación y clasificación (tipo de servicio, prioridad)
│   ├── Ciclo de estados del pedido
│   └── Documentación asociada (albarán, carta de porte)
│
├── 04. PLANIFICACIÓN
│   ├── Agrupación de pedidos en rutas / cargas
│   ├── Cálculo de ocupación (palés, kg)
│   ├── Asignación a transportista / vehículo / conductor
│   └── Calendario y ventanas horarias
│
├── 05. OPTIMIZACIÓN Y SIMULACIÓN DE COSTE
│   ├── Comparador de tarifas entre transportistas
│   ├── Sugerencia de mejor combinación pedido↔vehículo↔transportista
│   └── Reoptimización ante cambios (nuevo pedido, baja de vehículo)
│
├── 06. EXPEDICIÓN Y SEGUIMIENTO
│   ├── Confirmación de carga
│   ├── Seguimiento GPS / estado de viaje
│   ├── Incidencias en ruta
│   └── Confirmación de entrega (POD, firma, fotos)
│
├── 07. LOGÍSTICA INVERSA (Retornos)
│   ├── Registro de pendientes de recogida por cliente
│   ├── Reclamación automática en el viaje de vuelta
│   └── Conciliación de envases/palés devueltos
│
├── 08. PORTALES EXTERNOS
│   ├── Portal Cliente
│   └── Portal Transportista
│
├── 09. APP MÓVIL CONDUCTOR
│
├── 10. FACTURACIÓN Y LIQUIDACIÓN
│   ├── Conciliación de viajes realizados vs. tarifa vigente
│   ├── Liquidación a transportistas
│   └── Facturación a cliente (si aplica transporte facturable)
│
├── 11. INTELIGENCIA ARTIFICIAL
│   ├── Predicción de ETA y retrasos
│   ├── Optimización automática de rutas/asignación
│   └── Alertas y recomendaciones
│
└── 12. BUSINESS INTELLIGENCE / KPIs
    ├── Coste (por pedido, parada, cliente, transportista)
    ├── Servicio (OTIF, cumplimiento de horario)
    └── Operación (ocupación, productividad, CO₂)
```

\---

## 2\. Bounded contexts (para DDD, detallado en la Fase de diseño técnico)

|Bounded Context|Módulos que agrupa|Responsabilidad|
|-|-|-|
|**Identity \& Access**|Plataforma|Usuarios, roles, permisos, multiempresa|
|**Master Data**|Maestros|Fuente única de verdad de almacenes, clientes, producto, transportistas, flota|
|**Pricing**|Tarifas|Cálculo de coste de transporte bajo cualquier modelo (completo/paletería)|
|**Order Management**|Pedidos|Ciclo de vida del pedido de transporte|
|**Planning**|Planificación + Optimización|Consolidación de pedidos en rutas/cargas y su asignación óptima|
|**Execution \& Tracking**|Expedición y seguimiento|Ejecución física del transporte y su trazabilidad|
|**Reverse Logistics**|Retornos|Gestión de envases/palés retornables|
|**External Access**|Portales + App conductor|Interacción de terceros (cliente, transportista, conductor) con el sistema|
|**Billing**|Facturación|Conciliación económica de lo ejecutado|
|**Intelligence**|IA + BI|Capacidades predictivas y analíticas transversales, consumen eventos de todos los demás contextos|

**Regla de dependencia**: los contextos operativos (Order Management, Planning, Execution) dependen de Master Data y Pricing pero nunca al revés. Intelligence y BI son *siempre* consumidores de eventos, nunca productores de reglas de negocio operativas — sus salidas son recomendaciones, no decisiones automáticas salvo que un usuario habilite explícitamente la automatización.

\---

## 3\. Entidades principales por módulo

> Detalle exhaustivo de campos/tipos/relaciones en la Fase 3 (Modelo de Base de Datos). Aquí se listan las entidades y su cardinalidad funcional.

|Módulo|Entidades|Cardinalidad clave|
|-|-|-|
|Maestros|`Warehouse`, `Customer`, `DeliveryPoint`, `Product`, `Carrier`, `VehicleType`, `Vehicle`, `Driver`|Customer 1→N DeliveryPoint · Carrier 1→N Vehicle · Vehicle N→1 VehicleType · Vehicle 1→1 Driver habitual (histórico N→N)|
|Tarifas|`FullTruckRate`, `PalletRate`, `RateSurcharge`, `RateValidity`|Carrier 1→N FullTruckRate/PalletRate, cada una con N períodos de vigencia (`RateValidity`)|
|Pedidos|`Order`, `OrderLine`, `OrderDocument`|Order 1→N OrderLine · OrderLine N→1 Product · Order N→1 DeliveryPoint|
|Planificación|`Route`, `RouteStop`, `LoadPlan`|Route 1→N RouteStop · RouteStop N→1 Order (o N→N si un pedido se reparte) · Route 1→1 LoadPlan (ocupación calculada)|
|Optimización|`CostSimulation`, `CarrierComparison`|Route/LoadPlan 1→N CostSimulation (una por transportista candidato)|
|Expedición|`Shipment`, `TrackingEvent`, `Incident`, `ProofOfDelivery`|Route 1→1 Shipment · Shipment 1→N TrackingEvent · Shipment 1→N Incident · Shipment 1→N ProofOfDelivery (una por parada)|
|Retornos|`ReturnItem`, `ReturnClaim`|Customer 1→N ReturnItem pendiente · Shipment 1→N ReturnClaim asociada al viaje de vuelta|
|Facturación|`CarrierSettlement`, `SettlementLine`, `CustomerInvoice`|Carrier 1→N CarrierSettlement · CarrierSettlement 1→N SettlementLine (una por Shipment liquidado)|
|Plataforma|`Company`, `User`, `Role`, `Permission`, `AuditLog`|Company 1→N User · User N→N Role · Role N→N Permission|

\---

## 4\. Flujo de información entre módulos (alto nivel)

```
ERP externo ──(integración)──► Pedidos ──► Planificación ──► Optimización
                                    │              │                │
                                    │              ▼                ▼
                                    │         (elige) ◄── Tarifas + Maestros(Flota/Transportistas)
                                    │              │
                                    ▼              ▼
                              Documentación   Expedición y Seguimiento ──► Retornos (viaje de vuelta)
                                                    │
                                                    ▼
                                            Facturación / Liquidación ──► ERP externo (contabilidad)
                                                    │
                                                    ▼
                                              BI / KPIs  ◄── IA (predicciones, alertas) ── (consume eventos de todo lo anterior)
```

Cada flecha es, técnicamente, un **evento de dominio** (Event-Driven, ver Fase de diseño técnico): `OrderReceived`, `RoutePlanned`, `CarrierAssigned`, `ShipmentDispatched`, `DeliveryConfirmed`, `ReturnClaimed`, `SettlementGenerated`, etc. Los módulos de Portales, App conductor, IA y BI son **suscriptores** de estos eventos, no parte del flujo síncrono principal.

\---

## 5\. Ciclo de estados por entidad crítica

### 5.1 Pedido (`Order`)

```
Recibido → Validado → Planificado → En carga → Expedido → En reparto → Entregado
                                                                  ↘ Incidencia → (Reintentado | Devuelto)
                    ↘ Rechazado (validación fallida)
```

### 5.2 Ruta / Carga (`Route` / `LoadPlan`)

```
Borrador → Optimizada → Asignada a transportista → Confirmada por transportista
    → En ejecución → Cerrada
                ↘ Rechazada por transportista → (vuelve a Optimizada)
```

### 5.3 Envío (`Shipment`, unidad de ejecución física de una Route)

```
Programado → Cargado → En tránsito → Parada N completada (repetible) → Finalizado
                              ↘ Incidencia → (Resuelta | Escalada)
```

### 5.4 Liquidación (`CarrierSettlement`)

```
Generada (borrador) → Validada → Aprobada → Pagada
                            ↘ Disputada → (vuelve a Validada tras ajuste)
```

### 5.5 Retorno (`ReturnClaim`)

```
Pendiente → Reclamado en viaje → Recogido → Conciliado
                          ↘ No disponible en cliente → (vuelve a Pendiente, próximo viaje)
```

\---

## 6\. Procesos clave (a nivel de orquestación, no de UI todavía)

1. **Alta de pedido → planificación**: un pedido validado entra en el "pool" de pendientes de planificar, agrupable por almacén de salida, provincia/zona y fecha de entrega comprometida.
2. **Consolidación**: el planificador decide si un conjunto de pedidos va por **camión completo** (un cliente o ruta dedicada) o por **paletería** (consolidado con otros clientes), lo cual determina qué motor de tarifa se activa.
3. **Simulación de coste multiproveedor**: para la misma combinación de pedidos, el sistema calcula el coste con cada transportista candidato (según tarifa vigente en la fecha), y el planificador elige o el sistema recomienda automáticamente (Fase IA).
4. **Asignación y confirmación**: la ruta/carga se asigna a un transportista y vehículo concretos; si existe Portal Transportista, este debe poder aceptar o rechazar antes de confirmarse en firme.
5. **Ejecución y trazabilidad**: cada parada genera eventos de seguimiento; las incidencias se registran contra la parada afectada, no contra el envío completo, para no perder trazabilidad del resto de entregas.
6. **Retorno en el viaje de vuelta**: al confirmar una entrega, el sistema consulta automáticamente si ese cliente tiene `ReturnItem` pendientes y los añade como reclamación al mismo `Shipment`.
7. **Liquidación**: al cerrar un `Shipment`, se genera una `SettlementLine` calculada contra la tarifa que estaba vigente en la fecha real del viaje (no la tarifa actual), agrupable después en `CarrierSettlement` periódicas.

\---

## 7\. Seguridad, autenticación y permisos (RBAC)

**Multiempresa**: toda entidad de negocio cuelga de `Company`; ningún usuario ve datos de otra empresa salvo rol de superadministrador de plataforma.

**Roles funcionales base** (ampliables por empresa):

|Rol|Alcance|
|-|-|
|`admin\_plataforma`|Todas las empresas, configuración global|
|`admin\_empresa`|Toda la empresa: maestros, tarifas, usuarios internos|
|`planificador`|Pedidos, Planificación, Optimización — lectura de Maestros y Tarifas|
|`gestor\_flota`|Maestros de Flota y Transportistas, Tarifas|
|`administracion`|Facturación/Liquidación, lectura de todo lo demás|
|`usuario\_cliente` (portal)|Solo sus propios pedidos, puntos de entrega y retornos|
|`usuario\_transportista` (portal)|Solo sus propios viajes asignados, documentación, liquidación|
|`conductor` (app móvil)|Solo su ruta diaria asignada|

**Autenticación**: usuarios internos vía SSO/credenciales corporativas; portales externos (cliente/transportista) con autenticación independiente y scopes propios, nunca compartiendo sesión ni permisos con el backoffice interno — esto ya estaba anticipado en el proyecto HTML anterior (Prompt 13) y se confirma aquí como requisito de arquitectura, no solo de UI.

**Auditoría**: toda mutación sobre Pedidos, Tarifas, Liquidaciones y Maestros queda registrada en `AuditLog` con usuario, timestamp, entidad, valor anterior/nuevo — imprescindible dado que las tarifas versionadas afectan directamente a la facturación.

\---

## 8\. Integraciones externas previstas

|Sistema|Dirección|Qué intercambia|
|-|-|-|
|**ERP**|Entrada|Pedidos de venta (como en "Pedidos de ejemplo"), maestro de clientes y productos|
|**ERP**|Salida|Liquidaciones a transportista, coste de transporte por pedido (para margen)|
|**WMS**|Entrada|Confirmación de picking/paletización real (nº de palés/kg reales, no solo teóricos)|
|**CRM**|Entrada/Salida|Datos de contacto de cliente, incidencias de servicio como señal comercial|
|**GPS / telemática de transportistas**|Entrada|Posición en tiempo real, eventos de llegada/salida de parada|
|**E-commerce** (si aplica)|Entrada|Pedidos directos de cliente final, con misma validación que los de ERP|

Todas estas integraciones se diseñan como **adaptadores** sobre el Bounded Context de Order Management y Master Data — el núcleo del TMS no debe acoplarse a ningún sistema externo concreto (principio API-first ya fijado en la Fase 1).

\---

## 9\. Preparación para crecimiento futuro

* **Multialmacén**: aunque hoy solo existe Getafe, todo pedido, ruta y KPI se calcula siempre relativo a un `Warehouse`, nunca de forma global implícita.
* **Nuevas modalidades de tarifa**: el motor de Pricing se diseña (Fase 3 y documento de tarifas) para soportar dimensiones adicionales (por zona, por cliente, ADR, festivos) sin romper el modelo actual de "km + parada" o "albarán + bulto".
* **Nuevos tipos de servicio**: hoy solo "camión completo" y "paletería"; el modelo de `Order` no codifica el tipo de servicio como campo fijo cerrado, sino como referencia a una política de tarifa, para poder añadir un tercer modelo (p. ej. mensajería/última milla) sin migración estructural.
* **IA y BI como capa desacoplada**: al consumir únicamente eventos de dominio, pueden evolucionar (nuevos modelos predictivos, nuevos KPIs) sin tocar los módulos operativos.

\---

## 10\. Siguiente paso

Continúo automáticamente con la **Fase 3 — Modelo de Base de Datos completo** (tablas, claves primarias/foráneas, relaciones, índices, restricciones y campos calculados), usando como base las entidades ya identificadas en las Fases 1 y 2 y los datos reales del Excel.

