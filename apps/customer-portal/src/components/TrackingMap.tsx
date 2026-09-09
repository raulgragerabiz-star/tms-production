import { useEffect } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Versión mínima, de un solo marcador, del `PlannerMap` que ya usa Backoffice
// (frontend/src/pages/planner/PlannerMap.tsx) para el mapa de Seguimiento --
// mismo motor (Leaflet + tiles de OpenStreetMap, sin API key ni coste), pero
// recortado a lo único que necesita esta pantalla: mostrar dónde está el
// vehículo ahora mismo, sin líneas de ruta ni varios puntos a la vez.
interface Props {
  lat: number;
  lng: number;
  label: string;
}

function CenterOnPoint({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], 13);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, lat, lng]);
  return null;
}

export default function TrackingMap({ lat, lng, label }: Props) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={13}
      scrollWheelZoom={false}
      style={{ height: 220, width: "100%", borderRadius: 8 }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <CenterOnPoint lat={lat} lng={lng} />
      <CircleMarker center={[lat, lng]} radius={9} pathOptions={{ color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.9 }}>
        <Tooltip permanent direction="top" offset={[0, -8]}>
          {label}
        </Tooltip>
      </CircleMarker>
    </MapContainer>
  );
}
