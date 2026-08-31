// Copiar a apps/carrier-portal/src/components/ShipmentChatPanel.tsx
// (y una copia gemela, ajustando solo el prefijo de URL de /carrier-portal
// a interno, en apps/backoffice/src/components/shipments/ShipmentChatPanel.tsx)

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { getSocket } from "@/realtime/socketClient"; // ver tracking/socketClient.ts de esta misma pasada

interface ShipmentMessage {
  id: string;
  senderType: "internal" | "carrier_portal";
  senderId: string;
  body: string;
  createdAt: string;
}

interface ShipmentChatPanelProps {
  shipmentId: string;
  currentSenderType: "internal" | "carrier_portal";
}

// Prefijo de endpoint según la app que consume este componente:
// - Portal Transportista: /carrier-portal/shipments/:id/messages
// - Backoffice:           /shipments/:id/messages
const BASE_PATH_FOR_CARRIER_PORTAL = "/carrier-portal";

export default function ShipmentChatPanel({ shipmentId, currentSenderType }: ShipmentChatPanelProps) {
  const [draft, setDraft] = useState("");
  const queryClient = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const basePath = currentSenderType === "carrier_portal" ? BASE_PATH_FOR_CARRIER_PORTAL : "";
  const messagesUrl = `${basePath}/shipments/${shipmentId}/messages`;

  const { data } = useQuery({
    queryKey: ["shipment-messages", shipmentId],
    queryFn: async () => (await apiClient.get<{ messages: ShipmentMessage[] }>(messagesUrl)).data.messages,
  });

  useEffect(() => {
    const socket = getSocket();
    socket.emit("subscribe:shipment", shipmentId);

    function handleNewMessage(message: ShipmentMessage) {
      queryClient.setQueryData<ShipmentMessage[]>(["shipment-messages", shipmentId], (old) => [
        ...(old ?? []),
        message,
      ]);
    }

    socket.on("shipment_message", handleNewMessage);
    return () => {
      socket.off("shipment_message", handleNewMessage);
      socket.emit("unsubscribe:shipment", shipmentId);
    };
  }, [shipmentId, queryClient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.length]);

  async function sendMessage() {
    if (!draft.trim()) return;
    await apiClient.post(messagesUrl, { body: draft.trim() });
    setDraft("");
    // No hace falta invalidar: el propio servidor difunde el mensaje por
    // socket también al emisor (mismo patrón que position_update), así
    // que llega por el listener de arriba.
  }

  return (
    <div className="flex flex-col h-96 border rounded-lg bg-white">
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {data?.map((m) => (
          <div
            key={m.id}
            className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
              m.senderType === currentSenderType
                ? "bg-slate-900 text-white ml-auto"
                : "bg-slate-100 text-slate-800"
            }`}
          >
            {m.body}
            <div className="text-[10px] opacity-60 mt-1">
              {new Date(m.createdAt).toLocaleTimeString("es-ES")}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="border-t p-2 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          onClick={sendMessage}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium"
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
