import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Fase 16: mapa interactivo de clientes con radio de distancia respecto al
// almacén de origen -- petición explícita de Raúl ("mapa interactivo con
// ubicación de clientes y radio de distancia respecto a almacén de
// origen... al clickar sobre el punto de un cliente, aparece la pestaña
// resumen"). No existía nada parecido en la app -- se construye como
// componente nuevo (no se toca PlannerMap, que ya usan Planificación y
// Seguimiento) reutilizando el mismo criterio de visor (Leaflet + tiles de
// OpenStreetMap, sin API key ni coste).
//
// Los anillos y el color de cada cliente son la clasificación por franja de
// distancia que calcula el backend (GET /dashboard/clients-map, ver
// DISTANCE_TIERS en dashboard.routes.ts). Petición explícita de Raúl: colores
// bien diferenciados por zona, no tonalidades de un mismo azul -- paleta
// categórica (5 de los 8 tonos fijos del skill de dataviz, mismo orden
// relativo que la paleta completa, nunca reordenados) en vez de la rampa
// secuencial original. Validado con validate_palette.js en modo claro con
// --pairs all (los puntos del mapa pueden quedar vecinos en cualquier
// combinación): sin FAIL. Dos zonas rozan el aviso de contraste sobre el
// fondo del mapa -- por eso cada punto lleva además un borde blanco/oscuro y
// nunca depende solo del color (leyenda con etiqueta de texto + tooltip al
// pasar el ratón + ficha de detalle con el nombre de la zona al hacer clic).
const TIER_COLORS: Record<string, string> = {
  metropolitana: "#2a78d6", // azul
  regional_cercana: "#1baf7a", // aguamarina
  regional_extendida: "#eda100", // amarillo
  larga_distancia: "#e87ba4", // magenta
  internacional: "#4a3aa7", // violeta
};
const RING_STROKE = "#94a3b8";

export interface ClientMapPoint {
  id: string;
  legalName: string;
  lat: number;
  lng: number;
  warehouseId: string;
  warehouseName: string;
  distanceKm: number;
  zoneTier: string;
  zoneTierLabel: string;
  routeName: string;
  suggestedFrequency: string;
  ordersCount: number;
}
export interface MapWarehouse {
  id: string;
  name: string;
  lat: number;
  lng: number;
}
export interface DistanceTierDef {
  tier: string;
  label: string;
  maxKm: number | null;
}

interface Props {
  warehouses: MapWarehouse[];
  clients: ClientMapPoint[];
  distanceTiers: DistanceTierDef[];
  height?: number;
}

function FitOnWarehouseChange({ center }: { center: { lat: number; lng: number } }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng]);
  return null;
}

export default function ClientDistanceMap({ warehouses, clients, distanceTiers, height = 480 }: Props) {
  const [warehouseId, setWarehouseId] = useState<string>(warehouses[0]?.id ?? "");
  const [selected, setSelected] = useState<ClientMapPoint | null>(null);

  const warehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId) ?? warehouses[0] ?? null,
    [warehouses, warehouseId]
  );
  const clientsForWarehouse = useMemo(
    () => clients.filter((c) => c.warehouseId === warehouse?.id),
    [clients, warehouse]
  );
  const ringRadiiKm = useMemo(() => distanceTiers.map((t) => t.maxKm).filter((km): km is number => km != null), [distanceTiers]);

  if (!warehouse) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin almacenes geolocalizados todavía.</p>;
  }

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 lg:col-span-8">
        {warehouses.length > 1 && (
          <select
            className="mb-2 text-sm border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700"
            value={warehouse.id}
            onChange={(e) => {
              setWarehouseId(e.target.value);
              setSelected(null);
            }}
          >
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ height }} className="rounded-xl overflow-hidden border border-slate-200">
          <MapContainer center={[warehouse.lat, warehouse.lng]} zoom={8} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />
            <FitOnWarehouseChange center={{ lat: warehouse.lat, lng: warehouse.lng }} />
            {ringRadiiKm.map((km) => (
              <Circle
                key={km}
                center={[warehouse.lat, warehouse.lng]}
                radius={km * 1000}
                pathOptions={{ color: RING_STROKE, weight: 1, fillOpacity: 0, dashArray: "4 4" }}
              />
            ))}
            <CircleMarker
              center={[warehouse.lat, warehouse.lng]}
              radius={9}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#111827", fillOpacity: 1 }}
            >
              <Tooltip>{warehouse.name} (almacén de origen)</Tooltip>
            </CircleMarker>
            {clientsForWarehouse.map((c) => (
              <CircleMarker
                key={c.id}
                center={[c.lat, c.lng]}
                radius={selected?.id === c.id ? 9 : 6}
                pathOptions={{
                  color: selected?.id === c.id ? "#0f172a" : "#ffffff",
                  weight: selected?.id === c.id ? 2 : 1.5,
                  fillColor: TIER_COLORS[c.zoneTier] ?? RING_STROKE,
                  fillOpacity: 1,
                }}
                eventHandlers={{ click: () => setSelected(c) }}
              >
                <Tooltip>{c.legalName}</Tooltip>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
          {distanceTiers.map((t) => (
            <span key={t.tier} className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: TIER_COLORS[t.tier] ?? RING_STROKE }} />
              {t.label}
            </span>
          ))}
        </div>
      </div>

      <div className="col-span-12 lg:col-span-4">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-center text-sm text-slate-400 border border-dashed border-slate-200 rounded-xl p-6">
            Selecciona un cliente en el mapa para ver su ficha resumen.
          </div>
        ) : (
          <div className="border border-slate-200 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
              <p className="text-sm font-bold text-slate-800">{selected.legalName}</p>
            </div>
            <dl className="text-sm space-y-2">
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Ruta / circuito</dt>
                <dd className="font-medium text-slate-800">{selected.routeName}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Distancia desde {warehouse.name}</dt>
                <dd className="font-mono font-semibold text-slate-800">{selected.distanceKm} km</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Zona de reparto recomendada</dt>
                <dd className="font-medium text-slate-800 text-right">{selected.zoneTierLabel}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Frecuencia de envío sugerida</dt>
                <dd className="font-medium text-slate-800">{selected.suggestedFrequency}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-slate-500">Pedidos registrados</dt>
                <dd className="font-mono text-slate-800">{selected.ordersCount}</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
