import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Objetivo 2: visor de mapa gratuito, sin API key ni facturación -- sustituye
// al PlannerMap anterior basado en @react-google-maps/api (que dependía de
// VITE_GOOGLE_MAPS_API_KEY, sin configurar). Leaflet + tiles de OpenStreetMap
// no tienen coste ni límite de uso razonable para este volumen de peticiones.
// La interfaz pública (Props, MapPoint, colores exportados) se mantiene igual
// para no tener que tocar quien ya usa este componente (DragDropBoard).

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string; // hex, usado para pintar el marcador
}

// Línea de ruta (almacén + paradas en orden) para pintar el recorrido sobre
// el mapa -- opcional, así el componente sigue funcionando igual si no se
// pasa ninguna.
export interface MapLine {
  id: string;
  color: string;
  points: { lat: number; lng: number }[];
}

interface Props {
  center: { lat: number; lng: number };
  points: MapPoint[];
  lines?: MapLine[];
  // Fase 7b: admite también un alto relativo ("100%") para poder rellenar un
  // contenedor flex de altura variable (Despacho, Rutas) -- un número en
  // píxeles (el uso de siempre) sigue funcionando exactamente igual.
  height?: number | string;
  // Fase 7 (Despacho más productivo): al fijar `focus` el mapa se desplaza a
  // ese punto concreto (p. ej. la parada o el vehículo seleccionado en el
  // panel lateral) en vez de reencuadrar todos los puntos. Opcional -- quien
  // no lo pase (SeguimientoPage, DragDropBoard) sigue con el comportamiento
  // de siempre.
  focus?: { lat: number; lng: number } | null;
}

// 2026-09-09: paleta categórica alineada con la del resto del rediseño
// (mismo orden fijo que ya usa la guía de dataviz de Claude para series
// categóricas -- ámbar/teal/azul/rojo/púrpura/mostaza), en vez de los tonos
// sueltos de antes.
export const ROUTE_COLORS = ["#f2a33d", "#35c2a3", "#5b8def", "#e0596a", "#a677e0", "#e0c73d"];
export const PENDING_COLOR = "#94a3b8"; // slate-400: pedidos aún sin ruta asignada
export const WAREHOUSE_COLOR = "#111827"; // slate-900: almacén de origen

// Ajusta el encuadre del mapa a los puntos disponibles cada vez que cambian,
// en vez de dejar center/zoom fijos -- así funciona de verdad como visor de
// ruta (se ve la ruta completa, no solo el centro de Getafe).
function FitToPoints({
  center,
  points,
  focus,
}: {
  center: { lat: number; lng: number };
  points: MapPoint[];
  focus?: { lat: number; lng: number } | null;
}) {
  const map = useMap();

  useEffect(() => {
    // Fase 7: con un punto de foco concreto (selección en el panel lateral
    // de Despacho), nos acercamos a él en vez de reencuadrar todos los
    // puntos -- así "centrar en el mapa" tiene efecto real.
    if (focus) {
      map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 14), { duration: 0.6 });
      return;
    }
    if (points.length === 0) {
      map.setView([center.lat, center.lng], 9);
    } else if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 12);
    } else {
      map.fitBounds(
        points.map((p) => [p.lat, p.lng] as [number, number]),
        { padding: [32, 32], maxZoom: 13 }
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, center.lat, center.lng, points.map((p) => `${p.id}:${p.lat}:${p.lng}`).join("|"), focus?.lat, focus?.lng]);

  return null;
}

export default function PlannerMap({ center, points, lines = [], height = 480, focus = null }: Props) {
  const initialCenter = useMemo<[number, number]>(() => [center.lat, center.lng], []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ height }} className="rounded-xl overflow-hidden border border-slate-200">
      <MapContainer center={initialCenter} zoom={9} style={{ width: "100%", height: "100%" }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <FitToPoints center={center} points={points} focus={focus} />
        {lines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points.map((p) => [p.lat, p.lng] as [number, number])}
            pathOptions={{ color: line.color, weight: 3, opacity: 0.6 }}
          />
        ))}
        {points.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={8}
            pathOptions={{ color: "#ffffff", weight: 2, fillColor: p.color, fillOpacity: 1 }}
          >
            <Tooltip>{p.label}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
