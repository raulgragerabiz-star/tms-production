import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Chip, { ChipColor } from "@/components/Chip";
import Modal from "@/components/Modal";
import { usePlannerFiltersStore } from "@/store/planner-filters-store";

// Fase 7b: primera pestaña del Planificador reestructurado, estilo Bringg --
// lista de pedidos pendientes de este almacén/fecha con casillas, para
// elegir cuáles entran en esta pasada de planificación automática (en vez
// de que el motor coja siempre "los N de mayor prioridad" sin más control).
// Al terminar, PlannerPage cambia solo a la pestaña "Rutas" para ver el
// resultado ya montado. Sustituye al antiguo botón suelto "Planificar
// automáticamente" de la pestaña Despacho (ese seguía funcionando
// exactamente igual por debajo, en /routes/auto-plan -- ahora simplemente se
// dispara desde aquí, con selección explícita).
//
// Fase 8: dos cambios pedidos por Raúl tras probar con datos reales:
//  - Se quita el desplegable de servicio (paquetería/paletería/paletería
//    pesada/gran volumen) que obligaba a elegir uno para poder ver la lista
//    -- ahora se ven TODOS los pedidos pendientes a la vez, cada uno con su
//    tipología como etiqueta (ya calculada por peso/palés al crearse, ver
//    classifyOrder) en vez de como filtro. Al planificar, si la selección
//    mezcla tipologías, el backend crea una ruta por cada una (una ruta solo
//    puede ser de un servicio).
//  - Se añade un selector de "Estado del pedido": por defecto "Validado"
//    (los pendientes de planificar de siempre -- nada cambia si no se
//    toca), pero se puede elegir otro estado para ver pedidos en pasos
//    posteriores del ciclo (planificado/expedido/en tránsito...).
//    Fase 12: ya no existe "Recibido" como paso intermedio -- todo pedido
//    importado (Excel/ERP) o creado a mano entra directamente como
//    "Validado", listo para planificar sin ningún paso de validación manual
//    de por medio (ver statusTransitions en orders.routes.ts).
//
// Fase 9: Raúl pidió que, al pulsar "Planificar automáticamente", salte
// SIEMPRE un selector con 2 opciones -- hasta ahora la agrupación "por
// categoría de pedido" (paquetería/paletería/paletería pesada/gran volumen,
// una ruta por cada una si la selección mezcla tipologías) ya pasaba sola y
// en silencio por debajo (ver /routes/auto-plan); la única forma de evitarla
// era mandar un `serviceType` explícito en el body, cosa que esta pantalla
// nunca hacía. Motivo real del pedido: hoy solo hay tráilers dados de alta
// (sin variedad real de vehículos) y muchos productos no tienen peso/palés
// completos en el maestro, así que separar por categoría no aporta nada
// todavía y solo trocea la ruta sin necesidad -- "Unificado" fuerza TODO lo
// seleccionado a un único grupo/ruta por pasada, usando como etiqueta de
// servicio la tipología más repetida entre los pedidos elegidos (o
// "paleteria" en caso de empate, mismo valor por defecto que ya usa el
// resto de la app cuando un pedido no tiene tipología). "Por categoría"
// sigue siendo justo el comportamiento de siempre.

interface PendingOrder {
  id: string;
  orderNumber: string;
  priority: string;
  // Opcional en el backend (pedidos muy antiguos, de antes del clasificador
  // automático por peso/palés, podrían no tenerlo relleno).
  serviceType: string | null;
  requestedDeliveryDate: string;
  deliveryTimeWindowFrom: string | null;
  deliveryTimeWindowTo: string | null;
  totalWeightKg: number;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: { address: string; city: string | null; lat: number | null; lng: number | null };
  // Fase 15: circuito de reparto de ESTE pedido, ya resuelto por
  // cliente+almacén en el backend (ver customer-zone-resolution.ts) --
  // petición explícita de Raúl: si el mismo cliente tiene entregas desde más
  // de un almacén con circuitos distintos, aquí sale el que corresponde al
  // almacén de este pedido concreto, no un circuito fijo por cliente.
  deliveryZone: { id: string; name: string } | null;
}

interface Props {
  warehouseId: string;
  // Fase 11: antes un único `routeDate` -- ahora un rango (con ambos iguales
  // por defecto, hoy) para poder ver de un vistazo una ventana más amplia de
  // pedidos pendientes, no solo el día en curso. Ver planner-filters-store.ts.
  dateFrom: string;
  dateTo: string;
  onPlanned: (summary: string, ok: boolean) => void;
}

const priorityLabel: Record<string, string> = {
  urgent: "Urgente",
  standard: "Estándar",
  low: "Baja",
};

const serviceTypeLabel: Record<string, string> = {
  paqueteria: "Paquetería",
  paleteria: "Paletería",
  paleteria_pesada: "Paletería pesada",
  gran_volumen: "Gran volumen",
};

const serviceTypeColor: Record<string, ChipColor> = {
  paqueteria: "blue",
  paleteria: "teal",
  paleteria_pesada: "amber",
  gran_volumen: "purple",
};

// Fase 8: estados de pedido seleccionables para pruebas -- "Validado" es el
// único que importaba hasta ahora (el paso normal antes de planificar) y se
// mantiene como opción por defecto; el resto sirve para probar la
// planificación con pedidos que aún no han pasado por ese paso.
//
// Fase 12: se retiran "Recibido" y "En carga" -- ningún proceso real de la
// app los usaba (ver comentario largo en orders.routes.ts, statusTransitions);
// todo pedido nace ya "Validado". "Despachado" pasa a llamarse "Expedido"
// (mismo estado `dispatched`, ahora se marca solo al confirmar la ruta) para
// usar el mismo término que ya usa el filtro de estado de Pedidos.
const statusOptions: { value: string; label: string }[] = [
  { value: "validated", label: "Validado (pendientes de planificar)" },
  { value: "planned", label: "Planificado" },
  { value: "dispatched", label: "Expedido" },
  { value: "in_transit", label: "En tránsito" },
  { value: "incident", label: "Con incidencia" },
  { value: "delivered", label: "Entregado" },
  { value: "cancelled", label: "Cancelado" },
];

export default function PlanificacionTab({ warehouseId, dateFrom, dateTo, onPlanned }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Fase 9: modal "por categoría / unificado" -- ver comentario de cabecera.
  // Se abre siempre al pulsar "Planificar automáticamente", nunca se salta.
  const [showPlanModeModal, setShowPlanModeModal] = useState(false);
  // Fase 8j: "Estado del pedido" vive ahora en planner-filters-store.ts (no
  // en useState local) para que no se resetee a "Validado" cada vez que se
  // cambia de pestaña dentro del Planificador o se navega fuera y se vuelve
  // -- justo lo que reportó Raúl. `selected` (las casillas marcadas) sigue
  // siendo local a propósito: perder una selección de pedidos a medio hacer
  // al navegar fuera es razonable y más seguro que arrastrarla.
  const status = usePlannerFiltersStore((s) => s.orderStatus);
  const setStatus = usePlannerFiltersStore((s) => s.setOrderStatus);
  // Fase 15 (más tarde): filtro por ruta -- petición explícita de Raúl.
  const deliveryZoneId = usePlannerFiltersStore((s) => s.deliveryZoneId);
  const setDeliveryZoneId = usePlannerFiltersStore((s) => s.setDeliveryZoneId);

  const zonesQuery = useQuery({
    queryKey: ["delivery-zones"],
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: { id: string; name: string }[] },
  });

  const queryKey = ["planner-board", warehouseId, dateFrom, dateTo, status, deliveryZoneId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await api.get("/routes/planner-board", {
          params: {
            warehouseId: warehouseId || undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            status,
            deliveryZoneId: deliveryZoneId || undefined,
          },
        })
      ).data as { pendingOrders: PendingOrder[] },
  });

  const pendingOrders = data?.pendingOrders ?? [];
  const withoutCoords = useMemo(
    () => pendingOrders.filter((o) => o.deliveryPoint.lat == null || o.deliveryPoint.lng == null).length,
    [pendingOrders]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === pendingOrders.length ? new Set() : new Set(pendingOrders.map((o) => o.id))));
  }

  // Fase 9: `forcedServiceType` -- si viene relleno (modo "Unificado"), se
  // manda como `serviceType` explícito en el body, que es justo lo que ya
  // hacía el backend caer todo en un único grupo/ruta (ver comentario de
  // cabecera y /routes/auto-plan). Si viene vacío (modo "Por categoría"), se
  // omite el campo -- comportamiento de siempre, una ruta por tipología.
  // Fase 11: una ruta sale un único día concreto, aunque la lista de pedidos
  // pendientes ahora pueda mostrar un rango más amplio -- se usa "Desde"
  // como fecha de salida de la ruta creada (con el rango en su valor por
  // defecto, un solo día, esto es exactamente el mismo `routeDate` de
  // siempre). El aviso de abajo dentro del modal deja claro qué fecha se va
  // a usar antes de confirmar.
  const autoPlanMutation = useMutation({
    mutationFn: async (forcedServiceType: string | undefined) =>
      (
        await api.post("/routes/auto-plan", {
          warehouseId,
          routeDate: dateFrom,
          status,
          orderIds: Array.from(selected),
          ...(forcedServiceType ? { serviceType: forcedServiceType } : {}),
        })
      ).data,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["planner-board"] });
      queryClient.invalidateQueries({ queryKey: ["dispatch-board"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      setSelected(new Set());
      if (result.routesCreated === 0) {
        onPlanned(result.message ?? "No se ha podido crear ninguna ruta con los pedidos seleccionados", false);
      } else {
        const extra = result.ordersUnassigned > 0 ? ` (${result.ordersUnassigned} quedaron sin encajar)` : "";
        onPlanned(`${result.routesCreated} ruta(s) creada(s), ${result.ordersPlanned} pedidos planificados${extra}.`, true);
      }
    },
    onError: (err: any) => onPlanned(err?.response?.data?.message ?? "No se pudo completar la planificación automática", false),
  });

  const canPlan = !!warehouseId && selected.size > 0 && !autoPlanMutation.isPending;

  // Fase 9: tipología más repetida entre los pedidos SELECCIONADOS -- la
  // etiqueta que se usa para el modo "Unificado" (ver comentario de
  // cabecera). Empate o ninguno clasificado -> "paleteria", mismo valor por
  // defecto que ya usa el resto de la app.
  const dominantServiceType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of selected) {
      const order = pendingOrders.find((o) => o.id === id);
      const key = order?.serviceType ?? "paleteria";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    let best = "paleteria";
    let bestCount = 0;
    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key;
        bestCount = count;
      }
    }
    return best;
  }, [selected, pendingOrders]);

  function handlePlanByCategory() {
    setShowPlanModeModal(false);
    autoPlanMutation.mutate(undefined);
  }

  function handlePlanUnified() {
    setShowPlanModeModal(false);
    autoPlanMutation.mutate(dominantServiceType);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-300px)] min-h-[480px]">
      {!warehouseId && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 shrink-0">
          Elige un almacén concreto arriba para poder seleccionar pedidos y planificar automáticamente.
        </p>
      )}

      <div className="flex items-center justify-between mb-3 shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Estado del pedido
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSelected(new Set());
              }}
              className="rounded-lg border border-slate-300 text-sm px-2.5 py-1.5"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {/* Fase 15 (más tarde): filtro por ruta, a parte del de almacén --
              petición explícita de Raúl. */}
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Ruta
            <select
              value={deliveryZoneId}
              onChange={(e) => {
                setDeliveryZoneId(e.target.value);
                setSelected(new Set());
              }}
              className="rounded-lg border border-slate-300 text-sm px-2.5 py-1.5"
            >
              <option value="">Todas las rutas</option>
              <option value="sin-circuito">Sin circuito</option>
              {zonesQuery.data?.items.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {status !== "validated" && (
          <p className="text-xs text-amber-600">Planificación de prueba: normalmente aquí solo se ve "Validado".</p>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={pendingOrders.length > 0 && selected.size === pendingOrders.length}
                    onChange={toggleAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="text-left px-3 py-2">Pedido</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Destino</th>
                {/* Fase 12: petición de Raúl -- con el filtro por rango de
                    fechas (Fase 11) hacía falta ver a qué día concreto
                    corresponde cada pedido, no solo el rango completo. */}
                <th className="text-left px-3 py-2">Fecha</th>
                <th className="text-left px-3 py-2">Ventana</th>
                {/* Fase 15: petición explícita de Raúl -- ver el circuito de
                    cada pedido junto a tipología/fecha, resuelto según el
                    almacén de salida seleccionado arriba. */}
                <th className="text-left px-3 py-2">Ruta</th>
                <th className="text-left px-3 py-2">Tipología</th>
                <th className="text-left px-3 py-2">Prioridad</th>
                <th className="text-right px-3 py-2">Peso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              )}
              {!isLoading && pendingOrders.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                    No hay pedidos en ese estado para este almacén/rango de fechas.
                  </td>
                </tr>
              )}
              {pendingOrders.map((o) => {
                const noCoords = o.deliveryPoint.lat == null || o.deliveryPoint.lng == null;
                return (
                  <tr
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className={`cursor-pointer ${selected.has(o.id) ? "bg-brand-50" : "hover:bg-brand-50/60"}`}
                  >
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="rounded border-slate-300" />
                    </td>
                    <td className="px-3 py-2 font-mono font-medium text-slate-800">{o.orderNumber}</td>
                    <td className="px-3 py-2">
                      <p className="text-slate-700">{o.customer.legalName}</p>
                      <p className="text-xs text-slate-400 font-mono">{o.customer.businessCode}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {o.deliveryPoint.city ?? o.deliveryPoint.address}
                      {noCoords && <span className="ml-1.5 text-amber-600 text-xs">(sin coordenadas)</span>}
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono text-xs">
                      {new Date(o.requestedDeliveryDate).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {o.deliveryTimeWindowFrom || o.deliveryTimeWindowTo
                        ? `${o.deliveryTimeWindowFrom ?? "—"} - ${o.deliveryTimeWindowTo ?? "—"}`
                        : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {o.deliveryZone ? <Chip color="purple">{o.deliveryZone.name}</Chip> : <span className="text-slate-300 text-xs">Sin circuito</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Chip color={o.serviceType ? serviceTypeColor[o.serviceType] ?? "slate" : "slate"}>
                        {o.serviceType ? serviceTypeLabel[o.serviceType] ?? o.serviceType : "Sin clasificar"}
                      </Chip>
                    </td>
                    <td className="px-3 py-2 text-xs">{priorityLabel[o.priority] ?? o.priority}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{Math.round(o.totalWeightKg)} kg</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 shrink-0">
        <p className="text-sm text-slate-500">
          <span className="font-mono font-semibold text-slate-700">{selected.size}</span> de{" "}
          <span className="font-mono">{pendingOrders.length}</span> pedidos seleccionados
          {withoutCoords > 0 && (
            <span className="text-amber-600"> · {withoutCoords} sin coordenadas (no se podrán incluir)</span>
          )}
        </p>
        <button
          onClick={() => setShowPlanModeModal(true)}
          disabled={!canPlan}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {autoPlanMutation.isPending ? "Planificando…" : `Planificar automáticamente (${selected.size})`}
        </button>
      </div>

      {/* Fase 9: selector "por categoría / unificado" -- ver comentario de
          cabecera. Aparece siempre, nunca se salta. */}
      <Modal open={showPlanModeModal} title="¿Cómo agrupar estos pedidos en rutas?" onClose={() => setShowPlanModeModal(false)}>
        <div className="space-y-3">
          {dateFrom !== dateTo && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              La ruta se creará con fecha de salida <span className="font-mono font-semibold">{dateFrom}</span> (el
              primer día del rango mostrado), independientemente de la fecha de entrega solicitada de cada pedido.
            </p>
          )}
          <button
            onClick={handlePlanByCategory}
            className="w-full text-left rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40 px-4 py-3"
          >
            <p className="text-sm font-semibold text-slate-800">Por categoría de pedido</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Una ruta distinta por cada tipología (paquetería/paletería/paletería pesada/gran volumen) que haya entre los{" "}
              {selected.size} pedidos seleccionados. Recomendado cuando haya vehículos y datos de peso/palés distintos por
              categoría.
            </p>
          </button>
          <button
            onClick={handlePlanUnified}
            className="w-full text-left rounded-lg border border-slate-200 hover:border-brand-400 hover:bg-brand-50/40 px-4 py-3"
          >
            <p className="text-sm font-semibold text-slate-800">Unificado</p>
            <p className="text-xs text-slate-500 mt-0.5">
              Todos los {selected.size} pedidos seleccionados entran en la misma pasada de planificación, sin separar por
              tipología (útil mientras solo haya tráilers dados de alta y el maestro de productos no tenga siempre peso/palés
              completos).
            </p>
          </button>
        </div>
      </Modal>
    </div>
  );
}
