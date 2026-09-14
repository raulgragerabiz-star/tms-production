import { DragEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Chip from "@/components/Chip";
import PlannerMap, { MapLine, MapPoint, PENDING_COLOR, ROUTE_COLORS, WAREHOUSE_COLOR } from "./PlannerMap";

interface DeliveryPoint {
  id: string;
  address: string;
  city: string | null;
  lat: number | null;
  lng: number | null;
  // Contacto del punto de entrega -- se muestran en la lista detallada de
  // paradas del planificador cuando existen; muchos puntos aún no los tienen
  // cargados, así que siempre se tratan como opcionales.
  contactPhone: string | null;
  contactEmail: string | null;
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
  // Mejora (2026-09-14): bultos/palés de cada pedido, visibles de un vistazo
  // en el tablero del Planificador -- petición explícita de Raúl. `totalBoxes`
  // es null cuando ningún producto del pedido tiene todavía `unitsPerBox`
  // cargado en el maestro (dato parcial-pero-honesto, igual que en el resto
  // del proyecto).
  totalPallets: number;
  totalBoxes: number | null;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: DeliveryPoint;
  warehouse: Warehouse;
}

// Mejora (2026-09-14): formato compacto "X.X palés" (+ "· N bultos" cuando se
// conoce) reutilizado en la tarjeta de pedido pendiente y en el resumen de
// cada ruta.
function formatPalletsBoxes(totalPallets: number, totalBoxes: number | null): string {
  const palletsLabel = `${totalPallets.toFixed(1)} palés`;
  return totalBoxes != null ? `${palletsLabel} · ${Math.round(totalBoxes)} bultos` : palletsLabel;
}

interface RouteStopLite {
  id: string;
  sequence: number;
  // Estado de la parada individual (pending/arrived/completed/failed/returned,
  // actualizado por el conductor desde la App) y hora estimada de llegada
  // (recalculada junto con la ruta) -- para la lista detallada de paradas.
  status: string;
  eta: string | null;
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
    // Volumen real ocupado (a partir de las dimensiones de palé de cada
    // producto) -- queda en 0 mientras los productos de la ruta no tengan
    // dimensiones cargadas en el maestro.
    volumeOccupancyPct: number;
    distanceKm: string | null;
    estimatedDurationMin: number | null;
    // Mejora (2026-09-14): totales absolutos (no solo el % de ocupación),
    // necesarios para poder proyectar "¿y si añado este pedido arrastrado?"
    // durante el hover, antes de soltarlo -- ya venían en la respuesta del
    // backend (`loadPlan: true` sin recortar campos), solo faltaba tiparlos.
    totalWeightKg: number;
    totalPallets: number;
  } | null;
  // Objetivo 2: sugerencia de tipo de vehículo según la zona de km del
  // almacén -- null si la ruta ya tiene vehículo asignado o si el almacén
  // no tiene zonas de influencia definidas para esa distancia.
  suggestedVehicleType: {
    vehicleType: { id: string; name: string; maxWeightKg: number; maxPallets: number; maxVolumeM3: number | null };
    fitsWeight: boolean;
    fitsPallets: boolean;
    fitsVolume: boolean;
    reasons: string[];
  } | null;
  // Mejora (2026-09-14): capacidad real cuando la ruta ya tiene vehículo
  // asignado -- referencia preferente sobre `suggestedVehicleType` (que es
  // solo una aproximación por zona de km) para el chequeo predictivo de hueco
  // al arrastrar un pedido. Decimal -> string al venir por JSON, igual que
  // `loadPlan.distanceKm`.
  vehicle: {
    vehicleType: { maxWeightKg: string; maxPallets: number };
  } | null;
  stops: RouteStopLite[];
}

interface CapacityRef {
  maxWeightKg: number;
  maxPallets: number;
}

// Mejora (2026-09-14): referencia de capacidad para el chequeo predictivo --
// el vehículo real si ya está asignado, si no la sugerencia por zona de km
// (ya calculada en /planner-board). Devuelve null si no hay ninguna
// referencia todavía (ruta sin vehículo y sin sugerencia posible).
function getCapacityRef(route: RouteLite): CapacityRef | null {
  if (route.vehicle?.vehicleType) {
    return {
      maxWeightKg: Number(route.vehicle.vehicleType.maxWeightKg),
      maxPallets: route.vehicle.vehicleType.maxPallets,
    };
  }
  if (route.suggestedVehicleType?.vehicleType) {
    return {
      maxWeightKg: route.suggestedVehicleType.vehicleType.maxWeightKg,
      maxPallets: route.suggestedVehicleType.vehicleType.maxPallets,
    };
  }
  return null;
}

// Mejora (2026-09-14): bultos/palés totales de una ruta ya construida, para
// mostrarlos junto a la ocupación % existente. Los palés reutilizan el total
// ya calculado en el backend (`loadPlan.totalPallets`, la misma fórmula de
// siempre); los bultos se suman aquí en el cliente a partir de cada parada,
// con el mismo criterio "parcial-pero-honesto" que en el pedido individual:
// si ninguna parada tiene bultos conocidos, el total es null, no 0.
function sumRouteBoxes(route: RouteLite): number | null {
  let total = 0;
  let anyKnown = false;
  for (const s of route.stops) {
    if (s.order.totalBoxes != null) {
      anyKnown = true;
      total += s.order.totalBoxes;
    }
  }
  return anyKnown ? total : null;
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

  // Objetivo 2: recorrido de cada ruta (almacén -> paradas en orden de
  // secuencia) para que el mapa funcione de verdad como visor de ruta, no
  // solo como lista de puntos sueltos.
  const mapLines: MapLine[] = useMemo(() => {
    const lines: MapLine[] = [];
    for (const r of routesOfSameService) {
      const color = routeColorMap.get(r.id) ?? PENDING_COLOR;
      const routePoints: { lat: number; lng: number }[] = [];
      if (r.warehouse.lat && r.warehouse.lng) {
        routePoints.push({ lat: r.warehouse.lat, lng: r.warehouse.lng });
      }
      for (const stop of r.stops) {
        if (stop.order.deliveryPoint.lat && stop.order.deliveryPoint.lng) {
          routePoints.push({ lat: stop.order.deliveryPoint.lat, lng: stop.order.deliveryPoint.lng });
        }
      }
      if (routePoints.length >= 2) {
        lines.push({ id: `line-${r.id}`, color, points: routePoints });
      }
    }
    return lines;
  }, [routesOfSameService, routeColorMap]);

  // Mejora (2026-09-14): "ofrecer una alternativa a la hora de enviar el
  // producto si no entra completa, indicando cuántos bultos quedarán
  // pendientes de envío y si hay otra ruta en la que se puedan integrar" --
  // NO existe envío parcial real en el sistema (no hay ningún modelo para
  // repartir las líneas de un pedido entre paradas/rutas distintas), así que
  // esto es deliberadamente un aviso predictivo mientras se arrastra, no una
  // división real del pedido: si no cabe entero, se muestra una magnitud
  // aproximada de lo que sobraría y qué otras rutas SÍ tienen hueco para el
  // pedido completo. El pedido se puede soltar igualmente -- no se bloquea el
  // drop, igual que el resto del tablero (sugerencia, no una acción forzada).
  const draggingOrder = useMemo(
    () => (boardQuery.data?.pendingOrders ?? []).find((o) => o.id === draggingOrderId) ?? null,
    [boardQuery.data, draggingOrderId]
  );

  const hoverFitCheck = useMemo(() => {
    if (!draggingOrder || !dragOverRouteId) return null;
    const route = routesOfSameService.find((r) => r.id === dragOverRouteId);
    if (!route) return null;
    const capacity = getCapacityRef(route);
    if (!capacity) return { known: false as const };

    const currentWeight = route.loadPlan?.totalWeightKg ?? 0;
    const currentPallets = route.loadPlan?.totalPallets ?? 0;
    const projectedWeight = currentWeight + draggingOrder.totalWeightKg;
    const projectedPallets = currentPallets + draggingOrder.totalPallets;
    const fits = projectedWeight <= capacity.maxWeightKg && projectedPallets <= capacity.maxPallets;
    if (fits) return { known: true as const, fits: true as const };

    const overWeightKg = Math.max(0, projectedWeight - capacity.maxWeightKg);
    const overPallets = Math.max(0, projectedPallets - capacity.maxPallets);
    // Proporción aproximada del pedido que "no entra" -- usada solo para dar
    // una magnitud orientativa de bultos/palés pendientes, no un reparto real.
    const overRatio = Math.min(
      1,
      Math.max(
        draggingOrder.totalWeightKg > 0 ? overWeightKg / draggingOrder.totalWeightKg : 0,
        draggingOrder.totalPallets > 0 ? overPallets / draggingOrder.totalPallets : 0
      )
    );
    const pendingPallets = draggingOrder.totalPallets * overRatio;
    const pendingBoxes = draggingOrder.totalBoxes != null ? draggingOrder.totalBoxes * overRatio : null;

    const alternatives = routesOfSameService.filter((alt) => {
      if (alt.id === route.id) return false;
      const altCapacity = getCapacityRef(alt);
      if (!altCapacity) return false;
      const altWeight = (alt.loadPlan?.totalWeightKg ?? 0) + draggingOrder.totalWeightKg;
      const altPallets = (alt.loadPlan?.totalPallets ?? 0) + draggingOrder.totalPallets;
      return altWeight <= altCapacity.maxWeightKg && altPallets <= altCapacity.maxPallets;
    });

    return { known: true as const, fits: false as const, pendingPallets, pendingBoxes, alternatives };
  }, [draggingOrder, dragOverRouteId, routesOfSameService]);

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
              className={`bg-white border border-slate-200 rounded-xl p-3 text-sm cursor-grab active:cursor-grabbing shadow-sm hover:shadow transition ${
                draggingOrderId === o.id ? "opacity-40" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-semibold text-slate-800">{o.orderNumber}</span>
                {o.priority === "urgent" && <Chip color="red">Urgente</Chip>}
              </div>
              <p className="text-slate-500 text-xs mt-0.5">{o.customer.legalName}</p>
              <p className="text-slate-400 text-xs">
                {o.deliveryPoint.city ?? o.deliveryPoint.address} · <span className="font-mono">{o.totalWeightKg.toFixed(0)} kg</span>
              </p>
              <p className="mt-1">
                <Chip color="blue">{formatPalletsBoxes(o.totalPallets, o.totalBoxes)}</Chip>
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Panel derecho: mapa + rutas en construcción como zonas de destino */}
      <div className="col-span-8">
        <PlannerMap center={GETAFE_CENTER} points={mapPoints} lines={mapLines} height={340} />

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
                className={`rounded-xl border-2 border-dashed p-3 text-sm transition ${
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
                <p className="text-slate-700 mb-1">
                  <span className="font-mono font-bold">{r.stops.length}</span> paradas
                  {r.loadPlan && (
                    <>
                      {" · "}
                      <Chip color="blue">{formatPalletsBoxes(r.loadPlan.totalPallets, sumRouteBoxes(r))}</Chip>
                    </>
                  )}
                </p>
                {r.stops.length > 0 && (
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1 mb-1 border border-slate-100 rounded-md bg-slate-50/60 p-1.5">
                    {r.stops.map((s) => (
                      <div key={s.id} className="flex items-start justify-between gap-2 text-xs bg-white rounded px-1.5 py-1">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-700 truncate">
                            <span className="font-mono">{s.sequence}.</span> {s.order.customer.legalName}
                          </p>
                          <p className="text-slate-400 truncate">
                            {s.order.deliveryPoint.city ?? s.order.deliveryPoint.address}
                            {s.order.deliveryPoint.contactPhone && ` · ${s.order.deliveryPoint.contactPhone}`}
                          </p>
                          {s.eta && (
                            <p className="text-slate-400 font-mono">
                              ETA {new Date(s.eta).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                            </p>
                          )}
                        </div>
                        <StatusBadge status={s.status} />
                      </div>
                    ))}
                  </div>
                )}
                {r.loadPlan && (
                  <p className="text-xs text-slate-400 mt-1 font-mono">
                    Ocupación: {Math.round(r.loadPlan.weightOccupancyPct * 100)}% peso /{" "}
                    {Math.round(r.loadPlan.palletOccupancyPct * 100)}% palés
                    {/* Volumen solo se muestra si hay algo que mostrar -- mientras los productos
                        de la ruta no tengan dimensiones cargadas, queda en 0 y ocultarlo evita dar
                        a entender que "0% volumen" es un dato real. */}
                    {r.loadPlan.volumeOccupancyPct > 0 && ` / ${Math.round(r.loadPlan.volumeOccupancyPct * 100)}% volumen`}
                  </p>
                )}
                {r.loadPlan?.distanceKm != null && (
                  <p className="text-xs text-slate-400 font-mono">
                    {Math.round(Number(r.loadPlan.distanceKm))} km estimados
                    {r.loadPlan.estimatedDurationMin != null &&
                      ` · ${Math.round(r.loadPlan.estimatedDurationMin / 60)} h ${r.loadPlan.estimatedDurationMin % 60} min`}
                  </p>
                )}
                {r.suggestedVehicleType && (
                  <p
                    className={`text-xs mt-1 ${
                      r.suggestedVehicleType.fitsWeight && r.suggestedVehicleType.fitsPallets && r.suggestedVehicleType.fitsVolume
                        ? "text-teal-600"
                        : "text-amber-600"
                    }`}
                  >
                    Vehículo sugerido: {r.suggestedVehicleType.vehicleType.name}
                    {!r.suggestedVehicleType.fitsWeight || !r.suggestedVehicleType.fitsPallets || !r.suggestedVehicleType.fitsVolume
                      ? ` (${r.suggestedVehicleType.reasons.join("; ")})`
                      : ""}
                  </p>
                )}
                {dragOverRouteId === r.id && hoverFitCheck?.known && !hoverFitCheck.fits && (
                  <div className="mt-1.5 text-xs bg-amber-50 border border-amber-200 rounded-md p-1.5 text-amber-700">
                    <p className="font-semibold">
                      No cabe entero: sobrarían ~{hoverFitCheck.pendingPallets.toFixed(1)} palés
                      {hoverFitCheck.pendingBoxes != null && ` (~${Math.round(hoverFitCheck.pendingBoxes)} bultos)`}
                    </p>
                    {hoverFitCheck.alternatives.length > 0 ? (
                      <p className="mt-0.5">
                        Cabe entero en:{" "}
                        {hoverFitCheck.alternatives
                          .map((alt) => `ruta ${alt.id.slice(0, 8)}`)
                          .join(", ")}
                      </p>
                    ) : (
                      <p className="mt-0.5">Ninguna otra ruta en construcción tiene hueco para el pedido completo.</p>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-2 italic">Suelta aquí un pedido para añadirlo</p>
              </div>
            ))}

            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropOnNewRouteZone}
              className="rounded-xl border-2 border-dashed border-slate-300 p-3 text-sm flex flex-col items-center justify-center text-slate-400 hover:border-brand-400 hover:text-brand-500 transition min-h-[110px]"
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
