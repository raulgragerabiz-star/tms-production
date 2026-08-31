// apps/backoffice/src/components/tracking/LiveTrackingMap.tsx
//
// Implementa la Pantalla 6 (06-diseno-ux-TMS.md): "Mapa a pantalla completa
// con todos los envíos activos del día como puntos en movimiento; lista
// lateral filtrable por transportista/almacén. Clic en un envío abre panel
// lateral con su timeline de eventos sin salir del mapa (patrón
// master-detail)."
//
// Estrategia de datos: snapshot inicial vía REST (GET /tracking/live) para
// no arrancar con el mapa vacío, + actualizaciones incrementales vía
// Socket.io (evento `position_update`) — "near-real-time vía eventos, no
// polling agresivo", tal como fija 07-dashboard-TMS.md.

import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { getSocket, subscribeToWarehouse, unsubscribeFromWarehouse } from "@/realtime/socketClient";

import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

const vehicleIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

interface LivePosition {
  shipmentId: string;
  vehicleId: string;
  plate?: string;
  carrierName: string;
  lat: number;
  lng: number;
  occurredAt: string;
  nextStop?: { routeStopId: string; etaMinutes: number | null; etaSource?: string } | null;
}

interface LiveTrackingMapProps {
  warehouseId: string;
  warehouseLat: number;
  warehouseLng: number;
  onSelectShipment?: (shipmentId: string) => void;
}

export default function LiveTrackingMap({
  warehouseId,
  warehouseLat,
  warehouseLng,
  onSelectShipment,
}: LiveTrackingMapProps) {
  const [positions, setPositions] = useState<Record<string, LivePosition>>({});

  // 1. Snapshot inicial
  const { data: initialPositions } = useQuery({
    queryKey: ["tracking-live", warehouseId],
    queryFn: async () => (await apiClient.get<{ positions: LivePosition[] }>("/tracking/live", {
      params: { warehouseId },
    })).data.positions,
  });

  useEffect(() => {
    if (!initialPositions) return;
    setPositions(Object.fromEntries(initialPositions.map((p) => [p.shipmentId, p])));
  }, [initialPositions]);

  // 2. Suscripción en vivo
  useEffect(() => {
    const socket = getSocket();
    subscribeToWarehouse(warehouseId);

    function handleUpdate(payload: LivePosition) {
      setPositions((prev) => ({ ...prev, [payload.shipmentId]: payload }));
    }

    socket.on("position_update", handleUpdate);

    return () => {
      socket.off("position_update", handleUpdate);
      unsubscribeFromWarehouse(warehouseId);
    };
  }, [warehouseId]);

  const positionList = useMemo(() => Object.values(positions), [positions]);

  return (
    <MapContainer
      center={[warehouseLat, warehouseLng]}
      zoom={9}
      style={{ height: "100%", width: "100%" }}
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {positionList.map((p) => (
        <Marker
          key={p.shipmentId}
          position={[p.lat, p.lng]}
          icon={vehicleIcon}
          eventHandlers={{ click: () => onSelectShipment?.(p.shipmentId) }}
        >
          <Popup>
            <strong>{p.carrierName}</strong>
            {p.plate && <span> — {p.plate}</span>}
            <br />
            Última posición: {new Date(p.occurredAt).toLocaleTimeString("es-ES")}
            {p.nextStop?.etaMinutes != null && (
              <>
                <br />
                ETA próxima parada: ~{p.nextStop.etaMinutes} min
                <span className="block text-[10px] text-slate-400">
                  {p.nextStop.etaSource === "historical_calibration"
                    ? "(calibrado con histórico real)"
                    : "(estimación genérica, sin tráfico en vivo)"}
                </span>
              </>
            )}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
