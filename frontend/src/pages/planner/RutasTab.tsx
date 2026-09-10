import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import PlannerMap, { MapLine, MapPoint, PENDING_COLOR, ROUTE_COLORS, WAREHOUSE_COLOR } from "./PlannerMap";

// Fase 7b: segunda pestaña del Planificador reestructurado -- el resultado
// de la planificación (a mano o automática) para el almacén/fecha elegidos:
// qué rutas hay, con qué transportista/vehículo/conductor (si ya los tiene)
// y qué pedidos lleva cada una, en orden. Reutiliza el mismo endpoint que
// Despacho (/routes/dispatch-board, sin filtrar por estado) pero sin canal
// en vivo ni línea de tiempo -- esto es una foto fija para revisar el plan,
// no el seguimiento de la ejecución de hoy (eso sigue siendo Despacho).

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  order: {
    orderNumber: string;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null; lat: number | null; lng: number | null };
  };
}

interface RouteRow {
  id: string;
  status: string;
  serviceType: string;
  warehouse: { id: string; name: string; lat: number | null; lng: number | null };
  carrier: { id: string; legalName: string } | null;
  vehicle: { id: string; plate: string } | null;
  loadPlan: { distanceKm: string | null; estimatedDurationMin: number | null } | null;
  stops: StopRow[];
  shipment: { driver: { fullName: string } | null; lastPosition: { lat: number | null; lng: number | null } | null } | null;
  geometry: { lat: number; lng: number }[] | null;
}

interface Props {
  warehouseId: string;
  routeDate: string;
  onManageRoute: (routeId: string) => void;
  // Fase 8j: petición de Raúl -- "debe poder eliminarse rutas creadas, por
  // si se ha cometido algún error y que no se queden ahí fijas".
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

export default function RutasTab({ warehouseId, routeDate, onManageRoute, onSuccess, onError }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const queryKey = ["dispatch-board", warehouseId, routeDate];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await api.get("/routes/dispatch-board", { params: { warehouseId: warehouseId || undefined, date: routeDate } })
      ).data as { items: RouteRow[]; unassignedOrdersCount: number },
  });

  const routes = data?.items ?? [];

  const deleteRouteMutation = useMutation({
    mutationFn: async (routeId: string) => api.delete(`/routes/${routeId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["planner-board"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      setExpandedId(null);
      onSuccess("Ruta eliminada. Sus pedidos han vuelto a estar pendientes de planificar.");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo eliminar la ruta"),
  });

  function handleDeleteRoute(r: RouteRow) {
    if (
      window.confirm(
        `¿Eliminar esta ruta (${r.stops.length} paradas)? Sus pedidos volverán a estar pendientes de planificar. Esta acción no se puede deshacer.`
      )
    ) {
      deleteRouteMutation.mutate(r.id);
    }
  }

  const routeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r, idx) => map.set(r.id, ROUTE_COLORS[idx % ROUTE_COLORS.length]));
    return map;
  }, [routes]);

  function routeLabel(r: RouteRow): string {
    if (r.vehicle && r.shipment?.driver) return `${r.vehicle.plate} · ${r.shipment.driver.fullName}`;
    if (r.vehicle) return r.vehicle.plate;
    if (r.carrier) return r.carrier.legalName;
    return "Sin transportista asignado";
  }

  const mapLines: MapLine[] = useMemo(
    () =>
      routes
        .filter((r) => r.geometry && r.geometry.length > 0)
        .map((r) => ({ id: `geo-${r.id}`, color: routeColorMap.get(r.id) ?? PENDING_COLOR, points: r.geometry! })),
    [routes, routeColorMap]
  );

  const mapPoints: MapPoint[] = useMemo(() => {
    const points: MapPoint[] = [];
    const warehouse = routes[0]?.warehouse;
    if (warehouse?.lat && warehouse?.lng) {
      points.push({ id: `wh-${warehouse.id}`, lat: warehouse.lat, lng: warehouse.lng, label: warehouse.name, color: WAREHOUSE_COLOR });
    }
    for (const route of routes) {
      const color = routeColorMap.get(route.id) ?? PENDING_COLOR;
      for (const stop of route.stops) {
        if (stop.order.deliveryPoint.lat && stop.order.deliveryPoint.lng) {
          points.push({
            id: `stop-${stop.id}`,
            lat: stop.order.deliveryPoint.lat,
            lng: stop.order.deliveryPoint.lng,
            label: `${stop.order.orderNumber} — ${stop.order.customer.legalName}`,
            color: route.id === expandedId ? "#dc2626" : color,
          });
        }
      }
    }
    return points;
  }, [routes, routeColorMap, expandedId]);

  return (
    <div className="flex gap-4 h-[calc(100vh-300px)] min-h-[480px]">
      <div className="flex-[5] min-w-0 flex flex-col h-full">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 shrink-0">
          Rutas del plan ({routes.length})
        </p>
        <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
          {isLoading && <p className="text-sm text-slate-400 text-center py-6">Cargando…</p>}
          {!isLoading && routes.length === 0 && (
            <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-4 text-center">
              Todavía no hay rutas para este almacén/fecha. Ve a la pestaña "Planificación" para crearlas.
            </p>
          )}
          {routes.map((r) => {
            const expanded = expandedId === r.id;
            return (
              <div key={r.id} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  className="w-full text-left p-3 text-sm hover:bg-brand-50/60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: routeColorMap.get(r.id) }} />
                      <span className="font-mono font-medium text-slate-800 truncate">{routeLabel(r)}</span>
                    </span>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {r.stops.length} paradas
                    {r.loadPlan?.distanceKm ? ` · ${Math.round(Number(r.loadPlan.distanceKm))} km` : ""}
                    {r.loadPlan?.estimatedDurationMin ? ` · ${Math.round(r.loadPlan.estimatedDurationMin)} min` : ""}
                    {" · "}
                    {expanded ? "▲ Ocultar paradas" : "▼ Ver paradas"}
                  </p>
                </button>
                {expanded && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {r.stops.map((s) => (
                      <div key={s.id} className="flex items-center justify-between px-3 py-2 text-xs">
                        <span className="truncate">
                          <span className="text-slate-400 font-mono mr-1.5">{s.sequence}.</span>
                          <span className="font-medium text-slate-700">{s.order.customer.legalName}</span>
                          <span className="text-slate-400 ml-1.5">{s.order.deliveryPoint.city ?? s.order.deliveryPoint.address}</span>
                        </span>
                        <StatusBadge status={s.status} />
                      </div>
                    ))}
                    <div className="px-3 py-2 flex items-center justify-between">
                      <button onClick={() => onManageRoute(r.id)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                        Gestionar ruta →
                      </button>
                      <button
                        onClick={() => handleDeleteRoute(r)}
                        disabled={deleteRouteMutation.isPending}
                        className="text-xs text-red-500 hover:text-red-600 font-medium disabled:opacity-50"
                      >
                        Eliminar ruta
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex-[7] min-w-0 flex flex-col h-full">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 shrink-0">Mapa del plan</p>
        <div className="flex-1 min-h-0">
          <PlannerMap center={GETAFE_CENTER} points={mapPoints} lines={mapLines} height="100%" />
        </div>
      </div>
    </div>
  );
}
