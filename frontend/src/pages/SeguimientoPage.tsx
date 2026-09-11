import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import PlannerMap, { MapLine, MapPoint, ROUTE_COLORS, WAREHOUSE_COLOR } from "@/pages/planner/PlannerMap";
import { useRealtimeChannel } from "@/lib/realtime";

// Sincronización en tiempo real despacho<->conductor: la Driver App ya manda
// su posición GPS en segundo plano (apps/driver-app/src/offline/gpsTracker.ts).
// Hasta la Fase 6 esta pantalla solo la consumía por sondeo cada 20s; ahora
// además se suscribe en vivo (WebSocket) a cada envío que se muestra aquí, y
// actualiza su posición al instante en cuanto llega un ping -- el sondeo de
// 20s se mantiene tal cual como red de seguridad, por si el canal en vivo no
// está disponible (sin romper nada de lo que ya funcionaba).
const POLL_INTERVAL_MS = 20_000;

interface StopLite {
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

interface ShipmentRow {
  id: string;
  status: string;
  departedAt: string | null;
  route: {
    id: string;
    warehouse: { name: string; lat: number | null; lng: number | null };
    stops: StopLite[];
  };
  carrier: { legalName: string } | null;
  vehicle: { plate: string } | null;
  driver: { fullName: string } | null;
  lastPosition: { lat: number | null; lng: number | null; occurredAt: string } | null;
}

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `hace ${hours} h`;
}

export default function SeguimientoPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const queryKey = ["shipments", "en-curso"];

  // "En curso" = ya cargado o circulando -- antes de "loaded" no hay vehículo
  // en la calle todavía que tenga sentido situar en el mapa.
  const shipmentsQuery = useQuery({
    queryKey,
    queryFn: async () => (await api.get("/shipments")).data as { items: ShipmentRow[]; total: number },
    refetchInterval: POLL_INTERVAL_MS,
  });

  const activeShipments = useMemo(
    () => (shipmentsQuery.data?.items ?? []).filter((s) => s.status === "loaded" || s.status === "in_transit"),
    [shipmentsQuery.data]
  );

  // Fase 6: un ping en vivo de cualquiera de los envíos mostrados actualiza
  // directamente su posición en la cache, sin esperar al sondeo.
  const realtimeStatus = useRealtimeChannel({ shipmentIds: activeShipments.map((s) => s.id) }, (msg) => {
    if (msg.type !== "position_update") {
      queryClient.invalidateQueries({ queryKey });
      return;
    }
    const { shipmentId, lat, lng, occurredAt } = msg.payload as { shipmentId: string; lat: number; lng: number; occurredAt: string };
    queryClient.setQueryData<{ items: ShipmentRow[]; total: number } | undefined>(queryKey, (current) =>
      current
        ? { ...current, items: current.items.map((s) => (s.id === shipmentId ? { ...s, lastPosition: { lat, lng, occurredAt } } : s)) }
        : current
    );
  });

  const selected = activeShipments.find((s) => s.id === selectedId) ?? null;

  // Fase 8O -- fix: antes el mapa solo pintaba la posición GPS en vivo, así
  // que mientras no llegara ni un ping (típicamente justo al salir a
  // reparto, o si el móvil del conductor no tiene buena cobertura) se veía
  // completamente vacío -- solo aparecía la tarjeta con "Sin posición GPS
  // todavía". Ahora, de respaldo, se pintan también el almacén de origen y
  // los puntos de entrega planificados del envío seleccionado (ya se piden
  // al backend, ver shipments.routes.ts), con una línea uniendo el
  // recorrido -- así siempre hay algo que mirar, en vivo o no.
  const mapPoints: MapPoint[] = useMemo(() => {
    const livePoints: MapPoint[] = activeShipments
      .filter((s) => s.lastPosition?.lat != null && s.lastPosition?.lng != null)
      .map((s, idx) => ({
        id: s.id,
        lat: s.lastPosition!.lat!,
        lng: s.lastPosition!.lng!,
        label: `${s.vehicle?.plate ?? "Vehículo"} — ${s.driver?.fullName ?? "sin conductor"} (${timeAgo(s.lastPosition!.occurredAt)})`,
        color: s.id === selectedId ? "#dc2626" : ROUTE_COLORS[idx % ROUTE_COLORS.length],
      }));

    if (!selected) return livePoints;

    const stopPoints: MapPoint[] = selected.route.stops
      .filter((stop) => stop.order.deliveryPoint.lat != null && stop.order.deliveryPoint.lng != null)
      .map((stop) => ({
        id: `stop-${stop.id}`,
        lat: stop.order.deliveryPoint.lat!,
        lng: stop.order.deliveryPoint.lng!,
        label: `${stop.sequence}. ${stop.order.customer.legalName}`,
        color: ROUTE_COLORS[0],
      }));

    const warehousePoint: MapPoint[] =
      selected.route.warehouse.lat != null && selected.route.warehouse.lng != null
        ? [{ id: `warehouse-${selected.id}`, lat: selected.route.warehouse.lat, lng: selected.route.warehouse.lng, label: selected.route.warehouse.name, color: WAREHOUSE_COLOR }]
        : [];

    return [...livePoints, ...warehousePoint, ...stopPoints];
  }, [activeShipments, selected, selectedId]);

  const mapLines: MapLine[] = useMemo(() => {
    if (!selected) return [];
    const points = [
      ...(selected.route.warehouse.lat != null && selected.route.warehouse.lng != null
        ? [{ lat: selected.route.warehouse.lat, lng: selected.route.warehouse.lng }]
        : []),
      ...selected.route.stops
        .filter((stop) => stop.order.deliveryPoint.lat != null && stop.order.deliveryPoint.lng != null)
        .map((stop) => ({ lat: stop.order.deliveryPoint.lat!, lng: stop.order.deliveryPoint.lng! })),
    ];
    return points.length >= 2 ? [{ id: `route-${selected.id}`, color: ROUTE_COLORS[0], points }] : [];
  }, [selected]);

  const mapCenter = useMemo(() => {
    const withPos = activeShipments.find((s) => s.lastPosition?.lat != null);
    if (withPos) return { lat: withPos.lastPosition!.lat!, lng: withPos.lastPosition!.lng! };
    const fallback = mapPoints[0];
    return fallback ? { lat: fallback.lat, lng: fallback.lng } : GETAFE_CENTER;
  }, [activeShipments, mapPoints]);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Seguimiento</h1>
        <p className="text-sm text-slate-500 flex items-center gap-1.5">
          Posición en vivo de los envíos en curso ({activeShipments.length}).
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${realtimeStatus === "live" ? "bg-emerald-500" : "bg-slate-300"}`} />
          {realtimeStatus === "live" ? "Empuje instantáneo activo" : "Actualizando por sondeo cada 20s"}
        </p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4">
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {shipmentsQuery.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
            {!shipmentsQuery.isLoading && activeShipments.length === 0 && (
              <p className="text-sm text-slate-400">No hay envíos en curso ahora mismo.</p>
            )}
            {activeShipments.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}
                className={`w-full text-left bg-white border rounded-lg p-3 text-sm transition ${
                  selectedId === s.id ? "border-brand-500 ring-1 ring-brand-500" : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-slate-800">{s.vehicle?.plate ?? "—"}</span>
                  <StatusBadge status={s.status} />
                </div>
                <p className="text-slate-500 text-xs mt-0.5">{s.driver?.fullName ?? "Sin conductor asignado"}</p>
                <p className="text-slate-400 text-xs">
                  {s.route.warehouse.name} · <span className="font-mono">{s.route.stops.length}</span> paradas
                </p>
                <p className="text-[11px] text-slate-400 mt-1 font-mono">
                  {s.lastPosition ? `Última posición ${timeAgo(s.lastPosition.occurredAt)}` : "Sin posición GPS todavía"}
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="col-span-8">
          <PlannerMap center={mapCenter} points={mapPoints} lines={mapLines} height={360} />

          {selected && (
            <div className="mt-4 bg-white rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-slate-800">
                  {selected.vehicle?.plate} — {selected.driver?.fullName ?? "sin conductor"}
                </h2>
                <StatusBadge status={selected.status} />
              </div>
              <p className="text-xs text-slate-500 mb-3">
                {selected.carrier?.legalName ?? "—"} · Almacén {selected.route.warehouse.name}
                {selected.lastPosition && ` · posición ${timeAgo(selected.lastPosition.occurredAt)}`}
              </p>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
                Paradas ({selected.route.stops.length})
              </p>
              <div className="space-y-1.5">
                {selected.route.stops.map((stop) => (
                  <div key={stop.id} className="flex items-center justify-between text-sm border-b border-slate-100 pb-1.5">
                    <div>
                      <span className="text-slate-400 font-mono mr-2">{stop.sequence}.</span>
                      <span className="font-medium text-slate-700">{stop.order.customer.legalName}</span>
                      <span className="text-slate-400 text-xs ml-2">
                        {stop.order.deliveryPoint.city ?? stop.order.deliveryPoint.address}
                      </span>
                    </div>
                    <StatusBadge status={stop.status} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
