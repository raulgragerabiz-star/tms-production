import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

// Fase 7b: primera pestaña del Planificador reestructurado, estilo Bringg --
// lista de pedidos pendientes de este almacén/fecha/servicio con casillas,
// para elegir cuáles entran en esta pasada de planificación automática (en
// vez de que el motor coja siempre "los N de mayor prioridad" sin más
// control). Al terminar, PlannerPage cambia solo a la pestaña "Rutas" para
// ver el resultado ya montado. Sustituye al antiguo botón suelto
// "Planificar automáticamente" de la pestaña Despacho (ese seguía
// funcionando exactamente igual por debajo, en /routes/auto-plan -- ahora
// simplemente se dispara desde aquí, con selección explícita).

interface PendingOrder {
  id: string;
  orderNumber: string;
  priority: string;
  requestedDeliveryDate: string;
  deliveryTimeWindowFrom: string | null;
  deliveryTimeWindowTo: string | null;
  totalWeightKg: number;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: { address: string; city: string | null; lat: number | null; lng: number | null };
}

interface Props {
  warehouseId: string;
  routeDate: string;
  serviceType: string;
  onPlanned: (summary: string, ok: boolean) => void;
}

const priorityLabel: Record<string, string> = {
  urgent: "Urgente",
  standard: "Estándar",
  low: "Baja",
};

export default function PlanificacionTab({ warehouseId, routeDate, serviceType, onPlanned }: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const queryKey = ["planner-board", warehouseId, routeDate, serviceType];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await api.get("/routes/planner-board", {
          params: { warehouseId: warehouseId || undefined, date: routeDate || undefined, serviceType },
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

  const autoPlanMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/routes/auto-plan", {
          warehouseId,
          routeDate,
          serviceType,
          orderIds: Array.from(selected),
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

  return (
    <div className="flex flex-col h-[calc(100vh-300px)] min-h-[480px]">
      {!warehouseId && (
        <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 shrink-0">
          Elige un almacén concreto arriba para poder seleccionar pedidos y planificar automáticamente.
        </p>
      )}

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
                <th className="text-left px-3 py-2">Ventana</th>
                <th className="text-left px-3 py-2">Prioridad</th>
                <th className="text-right px-3 py-2">Peso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              )}
              {!isLoading && pendingOrders.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                    No hay pedidos pendientes de planificar para este almacén/fecha/servicio.
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
                    <td className="px-3 py-2 text-slate-500 text-xs">
                      {o.deliveryTimeWindowFrom || o.deliveryTimeWindowTo
                        ? `${o.deliveryTimeWindowFrom ?? "—"} - ${o.deliveryTimeWindowTo ?? "—"}`
                        : "—"}
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
          onClick={() => autoPlanMutation.mutate()}
          disabled={!canPlan}
          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {autoPlanMutation.isPending ? "Planificando…" : `Planificar automáticamente (${selected.size})`}
        </button>
      </div>
    </div>
  );
}
