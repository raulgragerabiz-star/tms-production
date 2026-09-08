import { DragEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import PlannerMap, { MapPoint, PENDING_COLOR, ROUTE_COLORS, WAREHOUSE_COLOR } from "./PlannerMap";

interface DeliveryPoint {
  id: string;
  address: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
}

interface Warehouse {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
}

interface OrderLite {
  id: string;
  orderNumber: string;
  priority: string;
  totalWeightKg: number;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: DeliveryPoint;
  warehouse: Warehouse;
}

interface RouteStopLite {
  id: string;
  sequence: number;
  order: OrderLite;
}

interface RouteLite {
  id: string;
  status: string;
  serviceType: string;
  vehicleId: string | null;
  warehouse: Warehouse;
  loadPlan: {
    weightOccupancyPct: number;
    palletOccupancyPct: number;
    distanceKm: string | null;
    estimatedDurationMin: number | null;
  } | null;
  // Objetivo 2: sugerencia de tipo de vehículo según la zona de km del
  // almacén -- null si la ruta ya tiene vehículo asignado o si el almacén
  // no tiene zonas de influencia definidas para esa distancia.
  suggestedVehicleType: {
    vehicleType: { id: string; name: string };
    fitsWeight: boolean;
    fitsPallets: boolean;
    reasons: string[];
  } | null;
  stops: RouteStopLite[];
}

interface BoardData {
  pendingOrders: OrderLite[];
  routes: RouteLite[];
}

// Los 4 segmentos reales de ServiceType (columna `service_type` de route) — antes
// solo "full_truck"/"pallet", 2 valores heredados que ya no existen en el enum.
export type ServiceType = "paqueteria" | "paleteria" | "paleteria_pesada" | "gran_volumen";

interface Props {
  warehouseId: string;
  routeDate: string;
  serviceType: ServiceType;
  onCreateRouteRequest: (orderId: string) => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

export default function DragDropBoard({ warehouseId, routeDate, serviceType, onCreateRouteRequest, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragOverRouteId, setDragOverRouteId] = useState<string | null>(null);

  const boardQuery = useQuery({
    queryKey: ["planner-board", warehouseId, routeDate],
    queryFn: async () =>
      (
        await api.get("/routes/planner-board", {
          params: { warehouseId: warehouseId || undefined, date: routeDate || undefined },
        })
      ).data as BoardData,
  });

  const addStopMutation = useMutation({
    mutationFn: async ({ routeId, orderId }: { routeId: string; orderId: string }) =>
      (await api.post(`/routes/${routeId}/stops`, { orderId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-board"] });
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      onSuccess("Pedido añadido a la ruta");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo añadir el pedido a la ruta"),
  });

  const routesOfSameService = useMemo(
    () => (boardQuery.data?.routes ?? []).filter((r) => r.serviceType === serviceType),
    [boardQuery.data, serviceType]
  );

  const routeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    routesOfSameService.forEach((r, idx) => map.set(r.id, ROUTE_COLORS[idx % ROUTE_COLORS.length]));
    return map;
  }, [routesOfSameService]);

  const mapPoints: MapPoint[] = useMemo(() => {
    const points: MapPoint[] = [];
    const warehouse = boardQuery.data?.pendingOrders[0]?.warehouse ?? boardQuery.data?.routes[0]?.warehouse;
    if (warehouse?.lat && warehouse?.lng) {
      points.push({ id: `wh-${warehouse.id}`, lat: warehouse.lat, lng: warehouse.lng, label: warehouse.name, color: WAREHOUSE_COLOR });
    }
    for (const o of boardQuery.data?.pendingOrders ?? []) {
      if (o.deliveryPoint.lat && o.deliveryPoint.lng) {
        points.push({
          id: `pending-${o.id}`,
          lat: o.deliveryPoint.lat,
          lng: o.deliveryPoint.lng,
          label: `${o.orderNumber} — ${o.customer.legalName} (sin ruta)`,
          color: PENDING_COLOR,
        });
      }
    }
    for (const r of routesOfSameService) {
      const color = routeColorMap.get(r.id) ?? PENDING_COLOR;
      for (const stop of r.stops) {
        if (stop.order.deliveryPoint.lat && stop.order.deliveryPoint.lng) {
          points.push({
            id: `stop-${stop.id}`,
            lat: stop.order.deliveryPoint.lat,
            lng: stop.order.deliveryPoint.lng,
            label: `${stop.order.orderNumber} — ruta ${r.id.slice(0, 8)}`,
            color,
          });
        }
      }
    }
    return points;
  }, [boardQuery.data, routesOfSameService, routeColorMap]);

  function handleDragStart(e: DragEvent<HTMLDivElement>, orderId: string) {
    setDraggingOrderId(orderId);
    e.dataTransfer.setData("text/plain", orderId);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDropOnRoute(e: DragEvent<HTMLDivElement>, routeId: string) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("text/plain") || draggingOrderId;
    setDragOverRouteId(null);
    setDraggingOrderId(null);
    if (!orderId) return;
    addStopMutation.mutate({ routeId, orderId });
  }

  function handleDropOnNewRouteZone(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData("text/plain") || draggingOrderId;
    setDraggingOrderId(null);
    if (!orderId) return;
    onCreateRouteRequest(orderId);
  }

  const pendingOrders = boardQuery.data?.pendingOrders ?? [];

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Panel izquierdo: pedidos pendientes arrastrables */}
      <div className="col-span-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Pendientes de planificar ({pendingOrders.length})
        </p>
        <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
          {boardQuery.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
          {!boardQuery.isLoading && pendingOrders.length === 0 && (
            <p className="text-sm text-slate-400">No hay pedidos validados pendientes para este filtro.</p>
          )}
          {pendingOrders.map((o) => (
            <div
              key={o.id}
              draggable
              onDragStart={(e) => handleDragStart(e, o.id)}
              onDragEnd={() => setDraggingOrderId(null)}
              className={`bg-white border border-slate-200 rounded-lg p-3 text-sm cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${
                draggingOrderId === o.id ? "opacity-40" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">{o.orderNumber}</span>
                {o.priority === "urgent" && (
                  <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENTE</span>
                )}
              </div>
              <p className="text-slate-500 text-xs mt-0.5">{o.customer.legalName}</p>
              <p className="text-slate-400 text-xs">
                {o.deliveryPoint.city ?? o.deliveryPoint.address} · {o.totalWeightKg.toFixed(0)} kg
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Panel derecho: mapa + rutas en construcción como zonas de destino */}
      <div className="col-span-8">
        <PlannerMap center={GETAFE_CENTER} points={mapPoints} height={340} />

        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Rutas en construcción ({routesOfSameService.length})
          </p>
          <div className="grid grid-cols-2 gap-3">
            {routesOfSameService.map((r) => (
              <div
                key={r.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverRouteId(r.id);
                }}
                onDragLeave={() => setDragOverRouteId(null)}
                onDrop={(e) => handleDropOnRoute(e, r.id)}
                className={`rounded-lg border-2 border-dashed p-3 text-sm transition ${
                  dragOverRouteId === r.id ? "border-brand-500 bg-brand-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full inline-block"
                    style={{ backgroundColor: routeColorMap.get(r.id) }}
                  />
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-slate-500 mb-1">{r.warehouse.name}</p>
                <p className="text-slate-700 font-medium">{r.stops.length} paradas</p>
                {r.loadPlan && (
                  <p className="text-xs text-slate-400 mt-1">
                    Ocupación: {Math.round(r.loadPlan.weightOccupancyPct * 100)}% peso /{" "}
                    {Math.round(r.loadPlan.palletOccupancyPct * 100)}% palés
                  </p>
                )}
                {r.loadPlan?.distanceKm != null && (
                  <p className="text-xs text-slate-400">
                    {Math.round(Number(r.loadPlan.distanceKm))} km estimados
                    {r.loadPlan.estimatedDurationMin != null &&
                      ` · ${Math.round(r.loadPlan.estimatedDurationMin / 60)} h ${r.loadPlan.estimatedDurationMin % 60} min`}
                  </p>
                )}
                {r.suggestedVehicleType && (
                  <p
                    className={`text-xs mt-1 ${
                      r.suggestedVehicleType.fitsWeight && r.suggestedVehicleType.fitsPallets
                        ? "text-emerald-600"
                        : "text-amber-600"
                    }`}
                  >
                    Vehículo sugerido: {r.suggestedVehicleType.vehicleType.name}
                    {!r.suggestedVehicleType.fitsWeight || !r.suggestedVehicleType.fitsPallets
                      ? ` (${r.suggestedVehicleType.reasons.join("; ")})`
                      : ""}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 mt-2 italic">Suelta aquí un pedido para añadirlo</p>
              </div>
            ))}

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnNewRouteZone}
              className="rounded-lg border-2 border-dashed border-slate-300 p-3 text-sm flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 transition min-h-[110px]"
            >
              <span className="text-2xl leading-none mb-1">+</span>
              <span className="text-xs text-center">Suelta aquí para crear una ruta nueva</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
