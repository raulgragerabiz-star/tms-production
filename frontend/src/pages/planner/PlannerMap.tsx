import { useMemo } from "react";
import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string; // hex, usado para pintar el marcador
}

interface Props {
  center: { lat: number; lng: number };
  points: MapPoint[];
  height?: number;
}

const containerStyle = { width: "100%", height: "100%" };

// Paleta fija de colores por índice de ruta, para distinguir cada carga en el mapa
// sin depender de un color aleatorio inestable entre renders.
export const ROUTE_COLORS = ["#3760ff", "#e8590c", "#0ca678", "#e64980", "#7048e8", "#f59f00"];
export const PENDING_COLOR = "#94a3b8"; // slate-400: pedidos aún sin ruta asignada
export const WAREHOUSE_COLOR = "#111827"; // slate-900: almacén de origen

export default function PlannerMap({ center, points, height = 480 }: Props) {
  const { isLoaded, loadError } = useJsApiLoader({
    id: "google-map-script",
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "",
  });

  const bounds = useMemo(() => points, [points]);

  if (!import.meta.env.VITE_GOOGLE_MAPS_API_KEY) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-sm text-slate-400 text-center px-6"
      >
        Configura <code className="mx-1">VITE_GOOGLE_MAPS_API_KEY</code> en el .env del frontend para activar el
        mapa del planificador.
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ height }} className="flex items-center justify-center bg-red-50 rounded-xl text-sm text-red-500">
        No se pudo cargar Google Maps.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={{ height }} className="flex items-center justify-center bg-slate-50 rounded-xl text-sm text-slate-400">
        Cargando mapa…
      </div>
    );
  }

  return (
    <div style={{ height }} className="rounded-xl overflow-hidden border border-slate-200">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={center}
        zoom={9}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          styles: [{ featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] }],
        }}
      >
        {bounds.map((p) => (
          <Marker
            key={p.id}
            position={{ lat: p.lat, lng: p.lng }}
            title={p.label}
            icon={{
              path: window.google?.maps?.SymbolPath?.CIRCLE,
              fillColor: p.color,
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
              scale: 8,
            }}
          />
        ))}
      </GoogleMap>
    </div>
  );
}
