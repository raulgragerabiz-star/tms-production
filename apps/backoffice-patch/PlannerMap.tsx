// Sustituye a apps/backoffice/src/components/planner/PlannerMap.tsx
// Elimina la dependencia @react-google-maps/api (de pago por volumen) y la
// sustituye por react-leaflet + tiles de OpenStreetMap (gratuito, sin API key).
// Documento v1.1 §6.
//
// Instalación:
//   npm install leaflet react-leaflet --workspace=apps/backoffice
//   npm install -D @types/leaflet --workspace=apps/backoffice
//
// Trade-off asumido (documentado explícitamente, ver §6 y §9 del documento
// v1.1): se pierde el cálculo de ETA con tráfico real de Google Directions.
// La secuenciación geográfica sigue funcionando sobre distancia Haversine
// (motor ya existente, Fase 8), sin reaccionar a incidencias de tráfico
// en vivo. Reversible sin tocar el modelo de datos.

import { MapContainer, TileLayer, Marker, Polyline, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useMemo } from "react";

// Fix del icono por defecto de Leaflet (roto por el bundling de Vite si no
// se referencian los assets explícitamente).
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const defaultIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export interface PlannerStop {
  id: string;
  sequence: number;
  lat: number;
  lng: number;
  label: string;
  eta?: string | null;
  withinTimeWindow?: boolean; // colorea ámbar/rojo (Fase 7 ya existente)
}

export interface PlannerMapProps {
  stops: PlannerStop[];
  warehouseLat: number;
  warehouseLng: number;
  onStopClick?: (stopId: string) => void;
}

export default function PlannerMap({ stops, warehouseLat, warehouseLng, onStopClick }: PlannerMapProps) {
  const orderedStops = useMemo(() => [...stops].sort((a, b) => a.sequence - b.sequence), [stops]);

  const routeLine: [number, number][] = useMemo(
    () => [
      [warehouseLat, warehouseLng],
      ...orderedStops.map((s) => [s.lat, s.lng] as [number, number]),
    ],
    [orderedStops, warehouseLat, warehouseLng]
  );

  const center: [number, number] =
    orderedStops.length > 0 ? [orderedStops[0].lat, orderedStops[0].lng] : [warehouseLat, warehouseLng];

  return (
    <MapContainer center={center} zoom={9} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <Marker position={[warehouseLat, warehouseLng]} icon={defaultIcon}>
        <Popup>Almacén de salida</Popup>
      </Marker>

      {orderedStops.map((stop) => (
        <Marker
          key={stop.id}
          position={[stop.lat, stop.lng]}
          icon={defaultIcon}
          eventHandlers={{ click: () => onStopClick?.(stop.id) }}
        >
          <Popup>
            <strong>#{stop.sequence}</strong> {stop.label}
            <br />
            {stop.eta && <span>ETA: {new Date(stop.eta).toLocaleTimeString("es-ES")}</span>}
            {stop.withinTimeWindow === false && (
              <p className="text-red-600 text-xs mt-1">Fuera de ventana horaria</p>
            )}
          </Popup>
        </Marker>
      ))}

      <Polyline positions={routeLine} pathOptions={{ color: "#1e293b", weight: 3, opacity: 0.7 }} />
    </MapContainer>
  );
}
