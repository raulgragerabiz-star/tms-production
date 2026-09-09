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
//
// Fase 7: la maqueta original dejaba un hueco muerto entre la tabla y el
// mapa, y el mapa se veía pequeño para lo que hay que vigilar en un
// despacho real. Se sustituye ese hueco por un panel central (estilo Bringg)
// que siempre tiene contenido -- por defecto, la lista de rutas del día (lo
// que antes eran unas píldoras sueltas bajo el mapa); al seleccionar una
// parada o una ruta, ese mismo panel pasa a mostrar su ficha (conductor,
// vehículo, transportista, posición, contacto) con accesos directos para
// centrar el mapa o llamar. El mapa gana espacio y altura.
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
    // Fase 7: se suma el teléfono del conductor (ya existía en el modelo,
    // solo faltaba pedirlo aquí) para poder ofrecer la acción "Llamar" en el
    // panel de detalle.
    driver: { fullName: string; phone: string | null } | null;
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

// Qué se muestra en el panel central: nada (lista de rutas por defecto), una
// ruta completa, o una parada concreta dentro de una ruta.
type Selection = { kind: "route"; routeId: string } | { kind: "stop"; stopId: string } | null;

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

export default function DispatchBoard({ warehouseId, routeDate, onManageRoute }: Props) {
  const [selection, setSelection] = useState<Selection>(null);
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

  const selectedStopId = selection?.kind === "stop" ? selection.stopId : null;

  // Ficha resuelta de la selección actual (ruta, y parada si aplica) -- si la
  // selección apunta a algo que ya no está en los datos (p. ej. la ruta se
  // cerró y desapareció de este día), se ignora sola sin romper nada.
  const selectedEntry = useMemo(() => {
    if (!selection) return null;
    if (selection.kind === "stop") {
      const found = stopRows.find((r) => r.stop.id === selection.stopId);
      return found ? { route: found.route, stop: found.stop } : null;
    }
    const route = routes.find((r) => r.id === selection.routeId);
    return route ? { route, stop: null as StopRow | null } : null;
  }, [selection, stopRows, routes]);

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

  // Fase 7: punto sobre el que se centra el mapa cuando hay algo
  // seleccionado en el panel -- prioriza la parada elegida, luego la
  // posición en vivo del vehículo, luego el almacén. Sin selección, el mapa
  // vuelve solo a encuadrar todos los puntos (comportamiento de siempre).
  const focusPoint = useMemo(() => {
    if (!selectedEntry) return null;
    const { route, stop } = selectedEntry;
    if (stop?.order.deliveryPoint.lat != null && stop.order.deliveryPoint.lng != null) {
      return { lat: stop.order.deliveryPoint.lat, lng: stop.order.deliveryPoint.lng };
    }
    if (route.shipment?.lastPosition?.lat != null && route.shipment?.lastPosition?.lng != null) {
      return { lat: route.shipment.lastPosition.lat, lng: route.shipment.lastPosition.lng };
    }
    if (route.warehouse.lat != null && route.warehouse.lng != null) {
      return { lat: route.warehouse.lat, lng: route.warehouse.lng };
    }
    return null;
  }, [selectedEntry]);

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

  function selectStop(stopId: string) {
    setSelection((current) => (current?.kind === "stop" && current.stopId === stopId ? null : { kind: "stop", stopId }));
  }

  function selectRoute(routeId: string) {
    setSelection((current) => (current?.kind === "route" && current.routeId === routeId ? null : { kind: "route", routeId }));
  }

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
        {/* Tabla de paradas -- alternativa accesible del Gantt de abajo. El
            color de cada ruta se indica con un borde a la izquierda en vez de
            una columna aparte, para dejar sitio a las demás columnas. */}
        <div className="col-span-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Paradas del día</p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-[520px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-3 py-2">Hora</th>
                    <th className="text-left px-3 py-2">Pedido / cliente</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {isLoading && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                        Cargando…
                      </td>
                    </tr>
                  )}
                  {!isLoading && stopRows.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-3 py-6 text-center text-slate-400">
                        No hay paradas planificadas este día.
                      </td>
                    </tr>
                  )}
                  {stopRows.map(({ stop, route }) => (
                    <tr
                      key={stop.id}
                      onClick={() => selectStop(stop.id)}
                      style={{ borderLeft: `3px solid ${routeColorMap.get(route.id) ?? PENDING_COLOR}` }}
                      className={`cursor-pointer ${stop.id === selectedStopId ? "bg-brand-50" : "hover:bg-brand-50/60"}`}
                    >
                      <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                        {stop.eta ? new Date(stop.eta).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <p className="font-mono font-medium text-slate-800">{stop.order.orderNumber}</p>
                        <p className="text-xs text-slate-400 truncate max-w-[140px]">{stop.order.customer.legalName}</p>
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

        {/* Fase 7: panel central -- por defecto, lista de rutas del día (con
            acceso directo a "Gestionar"); al seleccionar una parada o una
            ruta, muestra su ficha completa. Nunca queda vacío. */}
        <div className="col-span-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {selectedEntry ? "Detalle" : "Rutas del día"}
            </p>
            {selectedEntry && (
              <button
                onClick={() => setSelection(null)}
                className="text-[11px] text-slate-400 hover:text-slate-600 font-medium"
              >
                ‹ Volver al listado
              </button>
            )}
          </div>

          {!selectedEntry && (
            <div className="space-y-2 max-h-[520px] overflow-y-auto pr-0.5">
              {routes.length === 0 && !isLoading && (
                <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-4 text-center">
                  No hay rutas este día.
                </p>
              )}
              {routes.map((r) => (
                <button
                  key={r.id}
                  onClick={() => selectRoute(r.id)}
                  className="w-full text-left bg-white border border-slate-200 rounded-lg p-3 text-sm hover:border-brand-300 transition"
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
                  </p>
                  {r.shipment?.lastPosition?.occurredAt && (
                    <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                      Posición {timeAgo(r.shipment.lastPosition.occurredAt)}
                    </p>
                  )}
                  <div className="mt-2">
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onManageRoute(r.id);
                      }}
                      className="inline-block text-brand-600 hover:text-brand-700 text-xs font-medium"
                    >
                      Gestionar →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {selectedEntry && (
            <div className="bg-white border border-slate-200 rounded-xl p-4 text-sm space-y-3">
              {/* Cabecera: conductor si lo hay, si no transportista/vehículo */}
              <div className="flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-full bg-slate-800 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                  {selectedEntry.route.shipment?.driver ? initials(selectedEntry.route.shipment.driver.fullName) : "—"}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">
                    {selectedEntry.route.shipment?.driver?.fullName ?? "Sin conductor asignado"}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {selectedEntry.route.vehicle?.plate ?? "Sin vehículo"} · {selectedEntry.route.carrier?.legalName ?? "Sin transportista"}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <StatusBadge status={selectedEntry.route.status} />
                {selectedEntry.route.shipment?.lastPosition?.occurredAt && (
                  <span className="text-[11px] text-slate-400 font-mono">
                    Posición {timeAgo(selectedEntry.route.shipment.lastPosition.occurredAt)}
                  </span>
                )}
              </div>

              {/* Acciones rápidas -- estilo Bringg (localizar/llamar), usando
                  solo datos reales: sin valoración ni foto porque todavía no
                  existe esa información en la ficha del conductor. */}
              <div className="flex flex-wrap gap-2 pt-1">
                {focusPoint && (
                  <span className="text-xs bg-slate-100 text-slate-500 rounded-md px-2 py-1">
                    📍 Centrado en el mapa
                  </span>
                )}
                {selectedEntry.route.shipment?.driver?.phone ? (
                  <a
                    href={`tel:${selectedEntry.route.shipment.driver.phone}`}
                    className="text-xs bg-slate-900 hover:bg-slate-800 text-white rounded-md px-2.5 py-1.5"
                  >
                    📞 Llamar al conductor
                  </a>
                ) : (
                  <span className="text-xs bg-slate-50 text-slate-400 rounded-md px-2.5 py-1.5">Sin teléfono de conductor</span>
                )}
                <button
                  onClick={() => onManageRoute(selectedEntry.route.id)}
                  className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded-md px-2.5 py-1.5"
                >
                  Gestionar ruta
                </button>
              </div>

              {/* Ficha de la parada, si la selección es una parada concreta */}
              {selectedEntry.stop && (
                <div className="pt-3 border-t border-slate-100 space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Parada {selectedEntry.stop.sequence} · {selectedEntry.stop.order.orderNumber}
                  </p>
                  <p className="font-medium text-slate-700">{selectedEntry.stop.order.customer.legalName}</p>
                  <p className="text-xs text-slate-500">
                    {selectedEntry.stop.order.deliveryPoint.address}
                    {selectedEntry.stop.order.deliveryPoint.city ? `, ${selectedEntry.stop.order.deliveryPoint.city}` : ""}
                  </p>
                  {(selectedEntry.stop.order.deliveryTimeWindowFrom || selectedEntry.stop.order.deliveryTimeWindowTo) && (
                    <p className="text-xs text-slate-500">
                      Ventana: {selectedEntry.stop.order.deliveryTimeWindowFrom ?? "—"} - {selectedEntry.stop.order.deliveryTimeWindowTo ?? "—"}
                    </p>
                  )}
                  <div className="flex items-center justify-between pt-1">
                    <StatusBadge status={selectedEntry.stop.status} />
                    {selectedEntry.stop.order.deliveryPoint.contactPhone && (
                      <a
                        href={`tel:${selectedEntry.stop.order.deliveryPoint.contactPhone}`}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >
                        📞 Llamar al cliente
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Sin parada concreta seleccionada: mini listado de las paradas
                  de la ruta para poder entrar directamente en una de ellas. */}
              {!selectedEntry.stop && selectedEntry.route.stops.length > 0 && (
                <div className="pt-3 border-t border-slate-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1.5">
                    Paradas ({selectedEntry.route.stops.length})
                  </p>
                  <div className="space-y-1 max-h-[180px] overflow-y-auto">
                    {selectedEntry.route.stops.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => selectStop(s.id)}
                        className="w-full flex items-center justify-between text-left text-xs px-1.5 py-1 rounded hover:bg-brand-50/60"
                      >
                        <span className="truncate">
                          {s.sequence}. {s.order.customer.legalName}
                        </span>
                        <StatusBadge status={s.status} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Mapa en vivo -- más ancho y más alto que antes de la Fase 7 para
            que sea realmente el foco de la vista de Despacho. */}
        <div className="col-span-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Mapa en vivo</p>
          <PlannerMap center={GETAFE_CENTER} points={mapPoints} lines={mapLines} height={460} focus={focusPoint} />
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
          onSelectStop={(id) => selectStop(id)}
        />
      </div>
    </div>
  );
}
