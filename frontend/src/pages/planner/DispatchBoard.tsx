import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import PlannerMap, { MapLine, MapPoint, PENDING_COLOR, ROUTE_COLORS, WAREHOUSE_COLOR } from "./PlannerMap";
import DispatchGantt, { GanttRoute } from "./DispatchGantt";
import { useRealtimeChannel } from "@/lib/realtime";

// Fase 5b (Planificador estilo Bringg): vista "Despacho" -- tabla de paradas
// del día + mapa en vivo + línea de tiempo (Gantt), las tres sincronizadas
// (seleccionar una parada la resalta en el mapa y en el Gantt). Se suma como
// una TERCERA pestaña del Planificador, sin tocar ni "Tablero / Mapa" ni
// "Lista" -- reutiliza /routes/dispatch-board (nuevo, solo lectura salvo por
// abrir el mismo modal "Gestionar ruta" que ya existía en la vista Lista) en
// vez de /routes/planner-board, porque aquí interesan TODAS las rutas del
// día (también las ya asignadas/confirmadas/en curso), no solo las que
// todavía se están montando.
const POLL_INTERVAL_MS = 20_000;

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  order: {
    orderNumber: string;
    priority: string;
    deliveryTimeWindowFrom: string | null;
    deliveryTimeWindowTo: string | null;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null; lat: number | null; lng: number | null; contactPhone: string | null };
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
  shipment: {
    id: string;
    status: string;
    driverId: string | null;
    driver: { fullName: string } | null;
    lastPosition: { lat: number | null; lng: number | null; occurredAt: string } | null;
  } | null;
  // Fase 6: geometría real por carretera (OpenRouteService) -- null si no hay
  // clave ORS configurada, si falta alguna coordenada, o si la llamada falló;
  // el mapa simplemente no dibuja esa línea en ese caso.
  geometry: { lat: number; lng: number }[] | null;
}

interface DispatchBoardData {
  items: RouteRow[];
  unassignedOrdersCount: number;
}

interface Props {
  warehouseId: string;
  routeDate: string;
  onManageRoute: (routeId: string) => void;
}

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

export default function DispatchBoard({ warehouseId, routeDate, onManageRoute }: Props) {
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["dispatch-board", warehouseId, routeDate];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: async () =>
      (
        await api.get("/routes/dispatch-board", { params: { warehouseId: warehouseId || undefined, date: routeDate } })
      ).data as DispatchBoardData,
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Fase 6: canal en vivo -- cuando llega un evento de posición/estado, se
  // actualiza directamente la cache de React Query (sin esperar al próximo
  // sondeo). Solo se suscribe cuando hay un almacén concreto elegido (la
  // sala en el backend es por almacén); con "Todos los almacenes" esta
  // pantalla se queda con el sondeo de siempre.
  const realtimeStatus = useRealtimeChannel(warehouseId ? { warehouseId } : null, (msg) => {
    if (msg.type === "position_update") {
      const { shipmentId, lat, lng, occurredAt } = msg.payload as { shipmentId: string; lat: number; lng: number; occurredAt: string };
      queryClient.setQueryData<DispatchBoardData | undefined>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((r) =>
                r.shipment?.id === shipmentId ? { ...r, shipment: { ...r.shipment, lastPosition: { lat, lng, occurredAt } } } : r
              ),
            }
          : current
      );
      return;
    }
    if (msg.type === "stop_status_changed") {
      const { routeStopId, status } = msg.payload as { routeStopId: string; status: string };
      queryClient.setQueryData<DispatchBoardData | undefined>(queryKey, (current) =>
        current
          ? {
              ...current,
              items: current.items.map((r) => ({ ...r, stops: r.stops.map((s) => (s.id === routeStopId ? { ...s, status } : s)) })),
            }
          : current
      );
      return;
    }
    // route_status_changed / shipment_status_changed / auto_plan_completed /
    // eta_recalculated: cambian datos que no vale la pena parchear a mano
    // (relaciones completas, ETAs recalculadas) -- se pide un refetch directo,
    // que sigue siendo más inmediato que esperar el sondeo de 20s.
    queryClient.invalidateQueries({ queryKey });
  });

  const routes = data?.items ?? [];

  const mapLines: MapLine[] = useMemo(
    () =>
      routes
        .filter((r) => r.geometry && r.geometry.length > 0)
        .map((r, idx) => ({ id: `geo-${r.id}`, color: ROUTE_COLORS[idx % ROUTE_COLORS.length], points: r.geometry! })),
    [routes]
  );

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

  // Tabla de paradas: todas las paradas de todas las rutas del día, ordenadas
  // por hora estimada (las que todavía no tienen ETA calculada -- falta
  // alguna coordenada -- van al final, no se ocultan).
  const stopRows = useMemo(() => {
    const rows: { stop: StopRow; route: RouteRow }[] = [];
    for (const route of routes) {
      for (const stop of route.stops) rows.push({ stop, route });
    }
    rows.sort((a, b) => {
      if (a.stop.eta && b.stop.eta) return new Date(a.stop.eta).getTime() - new Date(b.stop.eta).getTime();
      if (a.stop.eta) return -1;
      if (b.stop.eta) return 1;
      return 0;
    });
    return rows;
  }, [routes]);

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
            label: `${stop.order.orderNumber} — ${stop.order.customer.legalName}${stop.eta ? ` · ${new Date(stop.eta).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}` : ""}`,
            color: stop.id === selectedStopId ? "#dc2626" : color,
          });
        }
      }
      if (route.shipment?.lastPosition?.lat && route.shipment?.lastPosition?.lng) {
        points.push({
          id: `pos-${route.id}`,
          lat: route.shipment.lastPosition.lat,
          lng: route.shipment.lastPosition.lng,
          label: `${routeLabel(route)} — posición actual (${timeAgo(route.shipment.lastPosition.occurredAt)})`,
          color,
        });
      }
    }
    return points;
  }, [routes, routeColorMap, selectedStopId]);

  const ganttRoutes: GanttRoute[] = useMemo(
    () =>
      routes.map((r) => ({
        id: r.id,
        label: routeLabel(r),
        color: routeColorMap.get(r.id) ?? PENDING_COLOR,
        stops: r.stops.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          status: s.status,
          eta: s.eta,
          orderNumber: s.order.orderNumber,
          customerName: s.order.customer.legalName,
          address: s.order.deliveryPoint.city ?? s.order.deliveryPoint.address,
          timeWindow:
            s.order.deliveryTimeWindowFrom || s.order.deliveryTimeWindowTo
              ? `${s.order.deliveryTimeWindowFrom ?? "—"} - ${s.order.deliveryTimeWindowTo ?? "—"}`
              : null,
        })),
      })),
    [routes, routeColorMap]
  );

  return (
    <div>
      <div className="flex items-center gap-4 mb-4 text-sm text-slate-500">
        <span>
          <span className="font-mono font-semibold text-slate-700">{routes.length}</span> rutas
        </span>
        <span>
          <span className="font-mono font-semibold text-slate-700">{stopRows.length}</span> paradas
        </span>
        {/* Fase 6: indicador del canal en vivo -- si se corta, esta pantalla
            sigue funcionando igual con el sondeo de 20s, solo que sin el punto verde. */}
        {warehouseId && (
          <span className="flex items-center gap-1.5 text-xs">
            <span
              className={`w-1.5 h-1.5 rounded-full inline-block ${realtimeStatus === "live" ? "bg-emerald-500" : "bg-slate-300"}`}
            />
            {realtimeStatus === "live" ? "En vivo" : "Sondeo cada 20s"}
          </span>
        )}
        {(data?.unassignedOrdersCount ?? 0) > 0 && (
          <span className="text-amber-600">
            <span className="font-mono font-semibold">{data?.unassignedOrdersCount}</span> pedidos de este día sin
            planificar todavía (pestaña Tablero / Mapa)
          </span>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Tabla de paradas -- alternativa accesible del Gantt de abajo */}
        <div className="col-span-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Paradas del día</p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Hora</th>
                    <th className="text-left px-3 py-2">Pedido / cliente</th>
                    <th className="text-left px-3 py-2">Ruta</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                        Cargando…
                      </td>
                    </tr>
                  )}
                  {!isLoading && stopRows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-slate-400">
                        No hay paradas planificadas este día.
                      </td>
                    </tr>
                  )}
                  {stopRows.map(({ stop, route }) => (
                    <tr
                      key={stop.id}
                      onClick={() => setSelectedStopId(stop.id === selectedStopId ? null : stop.id)}
                      className={`cursor-pointer ${stop.id === selectedStopId ? "bg-brand-50" : "hover:bg-brand-50/60"}`}
                    >
                      <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                        {stop.eta ? new Date(stop.eta).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-mono font-medium text-slate-800">{stop.order.orderNumber}</p>
                        <p className="text-xs text-slate-400 truncate max-w-[180px]">{stop.order.customer.legalName}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span
                            className="w-2 h-2 rounded-full inline-block shrink-0"
                            style={{ backgroundColor: routeColorMap.get(route.id) }}
                          />
                          <span className="truncate max-w-[110px]">{routeLabel(route)}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={stop.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Mapa en vivo */}
        <div className="col-span-7">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Mapa en vivo</p>
          <PlannerMap center={GETAFE_CENTER} points={mapPoints} lines={mapLines} height={330} />

          <div className="mt-3 flex flex-wrap gap-2">
            {routes.map((r) => (
              <button
                key={r.id}
                onClick={() => onManageRoute(r.id)}
                className="flex items-center gap-1.5 text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 hover:border-brand-300"
              >
                <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: routeColorMap.get(r.id) }} />
                <span className="font-mono">{routeLabel(r)}</span>
                <StatusBadge status={r.status} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Línea de tiempo (Gantt) */}
      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">
          Línea de tiempo del día
        </p>
        <DispatchGantt
          routes={ganttRoutes}
          routeDateIso={routeDate}
          selectedStopId={selectedStopId}
          onSelectStop={(id) => setSelectedStopId(id === selectedStopId ? null : id)}
        />
      </div>
    </div>
  );
}
