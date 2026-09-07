# Documento Funcional — TMS (Transportation Management System)

### Fase 1 de `alimentacion\_tms.md` — Visión de producto y modelo funcional

### Rol: Product Manager

\---

## 0\. Nota sobre la fuente de datos

El Excel `Recogida\_Datos\_Demo\_Expediciones.xlsx` es, por su propio encabezado interno, una **plantilla de recogida de datos que un partner de Microsoft Dynamics 365 Business Central envió a esta empresa** para preparar una demo comercial de su módulo *"Expediciones y Transporte"*. No es un documento de diseño: es un cuestionario de captura, con una fila de ejemplo por pestaña y un texto guía en cabecera.

Lo importante para este proyecto no es la plantilla en sí (su estructura es genérica y de terceros) sino **los datos reales que la empresa ya introdujo en ella**: mismo almacén de Getafe, mismos clientes tipo BigMat, mismos transportistas que en el proyecto `tms\_getafe.html` analizado previamente. Es decir, este Excel es una **segunda fuente real del mismo negocio**, más rica en ciertos aspectos (catálogo de producto completo, tarifas por transportista, pedidos con líneas) y más limitada en otros (solo 149 líneas de cliente y \~691 pedidos de muestra, frente a los 92.603 pedidos históricos del HTML).

Tal y como se me indica, tomo este Excel como **fuente de verdad del modelo de negocio** para todo el diseño que sigue. Donde detecto carencias, propongo ampliaciones justificadas (marcadas como 🔧 *Propuesta de ampliación*), manteniendo compatibilidad con lo existente.

**Inventario de datos reales recibidos:**

|Pestaña|Registros|Contenido|
|-|-:|-|
|Almacenes de salida|1|Almacén central – Getafe (C. Trece el Lomo, 4, 28906)|
|Clientes|149 puntos de entrega|Nombre, dirección completa, CP, población, provincia, horario de descarga, contacto, ¿intercambia palés? — 41 provincias distintas (España + Portugal)|
|Productos|8.957 artículos|Código, descripción, unidad de venta, **unidades por palé**, peso bruto/neto por unidad, **peso de palé lleno**, ¿necesita frío? (100% "No" en la muestra), ¿es envase/palé retornable? (8.500 sí / 455 no), descripción para carta de porte|
|Transportistas|6|Nombre, NIF, población, provincia, tipo de servicio (todos "Ambos" = camión completo + paletería), ¿flota propia? (todos "No"), temperatura (todos "Ambiente")|
|Flota (tipos)|6 tipos + 6 vehículos concretos|Trailer, rígido 18t/12t/7,5t, ligero 3,5t, furgón grande — con capacidad kg y palés, y si admiten superar el nº de palés. Vehículos concretos con matrícula, transportista asignado y conductor habitual|
|Tarifas camión completo|6 (una por transportista)|Vigencia (desde/hasta), importe fijo por parada adicional, km incluidos en el precio base, importe por km adicional|
|Tarifas paletería|6 (una por transportista)|Vigencia, importe fijo por albarán, importe por bulto/caja suelta, peso máximo por palé|
|Pedidos de ejemplo|691 pedidos / líneas|Nº de pedido, cliente (código + nombre ya combinados), almacén de salida, código de artículo, cantidad, unidad, fecha de entrega comprometida, observaciones (ej. "Entregar antes de las 14:00")|
|Retornos|0 reales (fila ejemplo vacía)|Cliente, envase/palé a recoger, cantidad pendiente, observaciones|

**Dato especialmente valioso para el diseño**: en "Pedidos de ejemplo", el campo `Cliente` ya viene como `"código - nombre"` (p. ej. `"488000 - SANEAMIENTO LINARES, S.L."`), lo que confirma que **el código de cliente de 6 dígitos es la clave estable real del negocio** — coincide exactamente con el campo `cod` del maestro `clientes por ruta` del proyecto anterior. Esto fija una decisión de modelo de datos importante para la Fase 3: **el identificador de negocio del cliente es este código**, no el nombre comercial (que varía: "BIGMAT STORES, S.L.U" vs "BIGMAT STORES S.L.U" aparecen ambos en los pedidos de muestra).

\---

## 1\. Visión de producto

**No construimos una réplica de Bringg, Tookan o del módulo de Dynamics 365 que motivó este Excel.** Construimos un **sistema operativo de expediciones propio**, pensado para una empresa de distribución industrial (materiales de construcción, ferretería) que reparte con **flota subcontratada** (100% transportistas "no propios" en los datos) desde uno o varios almacenes, combinando dos modelos de venta de transporte muy distintos:

* **Camión completo** — un vehículo dedicado a una ruta, tarifado por parada adicional + km.
* **Paletería / grupaje** — envío consolidado con otros clientes, tarifado por albarán + bulto suelto, con techo de peso por palé.

El sistema es el **centro operativo** desde que se genera un pedido de venta hasta que se liquida el transporte y se reclama el retorno de envases, con visibilidad de coste por pedido, por parada y por transportista **antes de asignar**, no solo a posteriori.

**Principios de diseño:**

1. **API-first**: cada módulo se diseña como API antes que como pantalla, para poder integrarse con el ERP que ya emite estos pedidos, con el WMS del almacén, con GPS de transportistas y con e-commerce si aplica.
2. **Multiempresa / multialmacén desde el día uno**, aunque hoy solo exista el almacén de Getafe — el dato ya contempla la posibilidad de más de uno ("Almacenes de salida", plural).
3. **El coste se calcula antes de decidir, no después**: el motor de tarifas (Fase 9 del roadmap completo) debe poder simular en tiempo real "¿qué me cobraría cada transportista por este pedido/ruta?" durante la planificación, tal y como el propio Excel ya anticipa con sus dos tablas de tarifas paralelas.
4. **El palé es la unidad atómica de planificación**, no el pedido ni el bulto: la capacidad de cada vehículo se define en palés y kg (ver Flota), y cada artículo define cuántas unidades caben por palé — el sistema siempre debe poder responder "¿cuántos palés y cuántos kg ocupa este pedido?" a partir del catálogo de producto.
5. **Trazabilidad de retorno de envases** integrada en el ciclo del pedido, no como módulo aparte: cuando el 95% de las líneas de producto (8.500 de 8.957) son retornables, la logística inversa es tan crítica como la de ida.

\---

## 2\. Actores del sistema (roles funcionales)

|Rol|Qué necesita del sistema|Base en los datos|
|-|-|-|
|**Operador de expediciones / planificador**|Ver todos los pedidos pendientes, agruparlos en rutas o cargas de camión completo, comparar tarifas entre transportistas, asignar|Es quien hoy gestionaría las 691 líneas de "Pedidos de ejemplo"|
|**Gestor de flota / transporte**|Mantener el maestro de transportistas, vehículos, tarifas vigentes y su vigencia temporal|Las tablas "Transportistas", "Flota" y las dos de "Tarifas" tienen campos de vigencia (`Precios vigentes desde/hasta`) que exigen versionado|
|**Administración / facturación**|Conciliar lo que se ha transportado con lo que corresponde pagar a cada transportista, según la tarifa que estuviera vigente en la fecha del viaje|Requiere historial de tarifas, no solo la última|
|**Cliente (portal)**|Ver estado de sus pedidos, horario de entrega comprometido, y sus retornos pendientes|Los campos "Horario de descarga" y "¿Intercambia palés?" ya anticipan esta necesidad|
|**Transportista (portal)**|Ver los viajes que se le asignan, aceptarlos/rechazarlos, aportar POD, y ver la liquidación derivada de sus propias tarifas|Los NIF y datos de contacto de "Transportistas" son la base de este acceso|
|**Conductor (app móvil)**|Ver su ruta diaria, confirmar entregas, recoger retornos, capturar incidencias|El maestro "Flota" ya vincula matrícula + conductor habitual + NIF del conductor|
|**Administrador del sistema**|Gestionar almacenes, catálogo de producto, usuarios y permisos multiempresa|—|

\---

## 3\. Objetos de negocio (a partir del Excel) y su función en el sistema

### 3.1 Almacén (`Warehouse`)

Punto de origen de toda ruta y del cálculo de kilómetros. Hoy hay uno (Getafe), pero el modelo debe soportar N desde el diseño.

🔧 **Propuesta de ampliación**: el Excel no registra horario de carga del almacén, muelles, ni capacidad de expedición diaria. Se añadirán en la Fase 3 (modelo de datos) porque son necesarios para el Planificador (Fase 7 de `alimentacion\_tms.md`) y para el módulo de Muelles/Cross-Dock si en el futuro se retoma esa parte del proyecto `tms\_getafe.html` original.

### 3.2 Cliente / Punto de entrega (`Customer` + `DeliveryPoint`)

El Excel modela correctamente que **un cliente puede tener varios puntos de entrega** (una fila por punto, mismo nombre de cliente repetido con direcciones distintas — se observa con "ESTRATEGIAS BIGMAT, S.L.U (LA PLATAFORMA)" apareciendo en Fuenlabrada y en Getafe). Esto confirma la relación **1 Cliente → N Puntos de entrega** ya intuida en el análisis del HTML anterior.

Campos confirmados: nombre, dirección, CP, población, provincia, horario de descarga, teléfono, email, ¿intercambia palés?.

🔧 **Propuesta de ampliación**: falta el **código de cliente** como campo explícito en esta pestaña (aunque sí aparece implícito en "Pedidos de ejemplo" como prefijo `"código - nombre"`). Se normalizará `código` como clave primaria de negocio del cliente, y `punto de entrega` como entidad hija con su propia clave. También se detecta **inconsistencia de capitalización de provincia** (`Madrid` / `MADRID`, `Cáceres` sin y con acento, `C. Real` vs `Ciudad Real` vs `CIUDAD REAL`) — se normalizará contra un catálogo cerrado de provincias/países en la Fase 3.

### 3.3 Producto (`Product` / `Article`)

El activo de datos más valioso del Excel: **8.957 artículos** con unidades por palé, peso bruto y neto por unidad, peso de palé lleno, necesidad de frío y condición de retornable. Esto es exactamente lo que la propia plantilla identifica como *"la base con la que el sistema calcula cuántos palés y cuántos kilos lleva cada camión"* — y por tanto la base de todo el motor de optimización y de tarifas del TMS.

🔧 **Propuesta de ampliación**: faltan dimensiones del palé (solo peso, no volumen/alto), y no hay clasificación ADR — si en el futuro se transportan materiales peligrosos, habrá que añadirlo. Con los datos actuales (0% requiere frío) se puede lanzar el MVP sin gestión de temperatura, pero el campo debe seguir existiendo por si cambia el mix de producto.

### 3.4 Transportista (`Carrier`)

6 transportistas, todos sin flota propia (subcontratación 100%), todos prestando ambos servicios (camión completo y paletería), todos operando en temperatura ambiente. Cada transportista tiene **una tarifa vigente por servicio y por rango de fechas** — esto es una señal clara de que el modelo de tarifas debe ser **versionado en el tiempo**, no un valor único mutable.

### 3.5 Vehículo (`Vehicle`) y Tipo de vehículo (`VehicleType`)

6 tipos de vehículo con capacidad en kg y en palés, y un indicador explícito `¿Admiten superar los palés?` — esto es una regla de negocio real y no trivial: **el límite operativo puede ser el peso o el número de palés físicos, y a veces se permite exceder el nº de palés si el peso lo permite** (apilado o palés parciales). El motor de ocupación de camión (Fase 8 del roadmap completo) debe modelar ambos límites de forma independiente, no solo el más restrictivo.

Cada vehículo concreto está vinculado a un transportista, tiene matrícula (y matrícula de remolque si aplica), tipo de camión, y un conductor habitual con su propio NIF — confirmando la relación **Transportista 1→N Vehículo 1→1 Conductor habitual** (aunque un conductor podría, en el futuro, no ser siempre el mismo).

### 3.6 Tarifa de camión completo (`FullTruckRate`)

Modelo: **precio base que incluye N km + parada adicional fija + precio por km extra**, vigente entre dos fechas, por transportista. No incluye aquí precio por tipo de vehículo (la muestra no distingue tarifa por tipo de camión dentro de "camión completo"), lo cual es una limitación real a resolver.

🔧 **Propuesta de ampliación**: el propio Prompt 9 de `alimentacion\_tms.md` (motor de tarifas) exige soportar precio por vehículo, por zona, combustible, ADR, festivos, peajes — ninguno de estos matices existe todavía en los datos. Se diseñará el motor de tarifas (Fase con detalle en el documento de arquitectura) para soportar estas dimensiones como **reglas configurables y opcionales**, de forma que el modelo actual (solo km + parada) sea el caso más simple de una regla más general, no un modelo distinto.

### 3.7 Tarifa de paletería (`PalletRate`)

Modelo: **importe fijo por albarán + importe por bulto/caja suelta + peso máximo por palé**, igualmente vigente por fechas y por transportista. Confirma que en el modelo de paletería el coste no depende linealmente del peso total sino de: (a) que exista o no un albarán, (b) si hay bultos sueltos fuera de palé, y (c) que ningún palé exceda el peso máximo permitido por ese transportista (dato que además condiciona cómo se paletiza el pedido, no solo cómo se cobra).

### 3.8 Pedido (`Order`) y línea de pedido (`OrderLine`)

691 líneas de pedido observadas, agrupadas en pedidos por `Nº de pedido`, cada una con: cliente (código + nombre), almacén de salida, artículo, cantidad, unidad, fecha de entrega comprometida y observaciones (instrucciones de entrega en texto libre, ej. horario límite). Confirma el patrón **1 Pedido → N Líneas de pedido → cada línea referencia 1 Producto**.

🔧 **Propuesta de ampliación**: faltan estado del pedido (pendiente/planificado/en ruta/entregado/incidencia), prioridad, y vínculo con el punto de entrega concreto cuando el cliente tiene varios — hoy solo se referencia al cliente, no al punto de entrega exacto. Esto se resolverá en el modelo de datos (Fase 3) obligando a que todo pedido apunte a un `DeliveryPoint`, no solo a un `Customer`.

### 3.9 Retorno (`Return` / logística inversa)

La pestaña existe con la estructura correcta (cliente, envase/palé a recoger, cantidad pendiente, observaciones) pero **sin datos reales de ejemplo** — es la única pestaña vacía. Dado que el 95% del catálogo es retornable, este módulo no es opcional aunque hoy no haya datos de muestra: se diseñará completo desde la Fase 3, y se poblará con datos sintéticos coherentes con el catálogo para el MVP/demo.

\---

## 4\. Módulos funcionales resultantes (mapa de alto nivel)

Este mapa ya anticipa la arquitectura de la Fase 2 (`alimentacion\_tms.md` — Prompt 2), pero a nivel puramente funcional:

1. **Maestros** — Almacenes, Clientes/Puntos de entrega, Catálogo de producto, Transportistas, Flota/Vehículos.
2. **Tarifas** — motor de tarifas de camión completo y de paletería, versionadas en el tiempo, ampliables a más dimensiones.
3. **Pedidos** — recepción, líneas, estados, prioridad, vínculo a punto de entrega.
4. **Planificación** — agrupación de pedidos en rutas (paletería) o en cargas dedicadas (camión completo), con cálculo de ocupación (palés + kg) contra la capacidad del vehículo.
5. **Motor de optimización y simulación de coste** — "¿qué transportista y qué vehículo me sale más barato para esta combinación de pedidos?", usando las tarifas vigentes en la fecha del viaje.
6. **Expedición y seguimiento** — asignación a transportista/vehículo/conductor, confirmación, seguimiento hasta entrega.
7. **Logística inversa (retornos)** — reclamación automática de envases/palés pendientes en el viaje de vuelta.
8. **Portales** — Cliente (estado de pedidos, retornos) y Transportista (viajes, POD, liquidación).
9. **App conductor** — ruta diaria, confirmación de entrega, incidencias, recogida de retornos.
10. **Facturación / liquidación de transporte** — conciliación de viajes realizados contra tarifa vigente por transportista.
11. **KPIs y BI** — coste por pedido/parada/cliente/transportista, ocupación real vs. capacidad, cumplimiento de horario comprometido.

\---

## 5\. Decisiones que quedan fijadas para las fases siguientes

1. **El código de cliente de 6 dígitos es el identificador de negocio canónico**, coherente entre este Excel y el proyecto `tms\_getafe.html` anterior — se usará para reconciliar ambas fuentes de datos cuando corresponda.
2. **Cliente y Punto de entrega son entidades separadas** (1→N), no una sola tabla plana.
3. **El palé es la unidad de cálculo de capacidad**, con dos límites independientes por vehículo (peso y nº de palés, este último a veces flexible).
4. **Las tarifas son versionadas por vigencia**, nunca un valor mutable único — imprescindible para poder facturar correctamente viajes pasados aunque la tarifa actual haya cambiado.
5. **Camión completo y paletería son dos modelos de tarifa y de planificación distintos** que conviven en el mismo pedido/cliente, no dos módulos separados sin relación.
6. **La logística inversa (retornos) es parte del ciclo de vida del pedido**, no un módulo aislado.

\---

## 6\. Siguiente paso

Continúo directamente, sin esperar confirmación, con la **Fase 2 — Arquitectura completa del sistema** (módulos, submódulos, entidades, permisos, estados y procesos, organizados como un ERP moderno), tal y como indicas en tus instrucciones generales. Dado el volumen total del proyecto (18 fases hasta el Documento Maestro), iré entregando cada fase como documento independiente y avanzando automáticamente a la siguiente, sin pausas de aprobación intermedias — solo me detendré si encuentro una contradicción irresoluble en los datos o en los requisitos.

