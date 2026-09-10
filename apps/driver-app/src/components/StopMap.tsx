import { MapContainer, Marker, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIconUrl from "leaflet/dist/images/marker-icon.png";
import markerIconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import markerShadowUrl from "leaflet/dist/images/marker-shadow.png";

// Fase 8L (rediseño App Conductor): mapa "sticky" en la parte alta de la
// pantalla de la parada -- solo el destino (no hay recorrido que dibujar
// aquí, eso ya lo ve el conductor por su GPS/navegador), así que basta un
// widget pequeño y NO interactivo (arrastrar/zoom desactivados a propósito:
// es una miniatura de referencia, no un mapa para explorar; "Cómo llegar"
// abre la navegación real). Mismo motor que el resto de la suite (Leaflet +
// tiles de OpenStreetMap, sin API key ni coste) -- ver
// frontend/src/pages/planner/PlannerMap.tsx y
// apps/customer-portal/src/components/TrackingMap.tsx.
//
// A diferencia de TrackingMap.tsx (que usa CircleMarker para evitar el
// icono roto de Leaflet con bundlers), aquí interesa un pin real de
// destino, así que se corrige explícitamente la ruta de los iconos por
// defecto -- problema conocido de Leaflet con Vite/webpack.
const destinationIcon = L.icon({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIconRetinaUrl,
  shadowUrl: markerShadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface Props {
  lat: number;
  lng: number;
}

export default function StopMap({ lat, lng }: Props) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={15}
      zoomControl={false}
      dragging={false}
      scrollWheelZoom={false}
      doubleClickZoom={false}
      touchZoom={false}
      attributionControl={false}
      style={{ height: "100%", width: "100%" }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={destinationIcon} />
    </MapContainer>
  );
}
