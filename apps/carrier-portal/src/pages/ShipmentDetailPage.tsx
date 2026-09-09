import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Chip, { ChipColor } from "@/components/Chip";

const stopStatusLabel: Record<string, string> = {
  pending: "Pendiente",
  arrived: "Llegada",
  completed: "Completada",
  failed: "Fallida",
  returned: "Devuelta",
};

const stopStatusColor: Record<string, ChipColor> = {
  pending: "slate",
  arrived: "amber",
  completed: "teal",
  failed: "red",
  returned: "amber",
};

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  order: {
    orderNumber: string;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null };
  };
  pod: { deliveredAt: string; receivedByName: string | null } | null;
}

interface ShipmentDetail {
  id: string;
  status: string;
  route: { routeDate: string; warehouse: { name: string }; stops: StopRow[] };
  vehicle: { plate: string };
}

interface MessageRow {
  id: string;
  senderType: string;
  senderName: string;
  body: string;
  createdAt: string;
}

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [messageBody, setMessageBody] = useState("");
  const [incidentDescription, setIncidentDescription] = useState("");

  const shipmentsQuery = useQuery({
    queryKey: ["carrier-shipments"],
    queryFn: async () => (await api.get("/carrier-portal/shipments")).data as { items: ShipmentDetail[] },
  });
  const shipment = shipmentsQuery.data?.items.find((s) => s.id === id);

  const messagesQuery = useQuery({
    queryKey: ["shipment-messages", id],
    queryFn: async () => (await api.get(`/carrier-portal/shipments/${id}/messages`)).data as { items: MessageRow[] },
    enabled: !!id,
    refetchInterval: 10000,
  });

  const sendMessageMutation = useMutation({
    mutationFn: async () => (await api.post(`/carrier-portal/shipments/${id}/messages`, { body: messageBody })).data,
    onSuccess: () => {
      setMessageBody("");
      queryClient.invalidateQueries({ queryKey: ["shipment-messages", id] });
    },
  });

  const podMutation = useMutation({
    mutationFn: async (routeStopId: string) =>
      (await api.post(`/carrier-portal/stops/${routeStopId}/pod`, { receivedByName: "Confirmado desde portal" })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["carrier-shipments"] }),
  });

  const incidentMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/carrier-portal/shipments/${id}/incidents`, {
          incidentType: "other",
          description: incidentDescription,
        })
      ).data,
    onSuccess: () => setIncidentDescription(""),
  });

  function handleSendMessage(e: FormEvent) {
    e.preventDefault();
    if (messageBody.trim()) sendMessageMutation.mutate();
  }

  if (!shipment) return <p className="text-sm text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Viaje {new Date(shipment.route.routeDate).toLocaleDateString("es-ES")} — {shipment.route.warehouse.name}
        </h2>
        <p className="text-sm text-slate-500">Vehículo {shipment.vehicle.plate} · Estado: {shipment.status}</p>
      </div>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Paradas</h3>
        <div className="space-y-2">
          {shipment.route.stops.map((stop) => (
            <div key={stop.id} className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between text-sm">
              <div>
                <p className="font-mono font-semibold text-slate-800">
                  #{stop.sequence} — {stop.order.orderNumber}
                </p>
                <p className="text-xs text-slate-500">
                  {stop.order.customer.legalName} · {stop.order.deliveryPoint.address}
                </p>
              </div>
              <div className="text-right">
                <Chip color={stopStatusColor[stop.status] ?? "slate"}>{stopStatusLabel[stop.status] ?? stop.status}</Chip>
                {!stop.pod && stop.status !== "completed" && (
                  <button
                    onClick={() => podMutation.mutate(stop.id)}
                    className="block mt-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Confirmar POD
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Reportar incidencia</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (incidentDescription.trim()) incidentMutation.mutate();
          }}
          className="flex gap-2"
        >
          <input
            value={incidentDescription}
            onChange={(e) => setIncidentDescription(e.target.value)}
            placeholder="Describe la incidencia…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-red-50 hover:bg-red-100 text-red-600 text-sm font-medium px-4 py-2 rounded-lg">
            Reportar
          </button>
        </form>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Chat con planificación</h3>
        <div className="bg-white rounded-xl border border-slate-200 p-3 space-y-2 max-h-52 overflow-y-auto mb-2">
          {messagesQuery.data?.items.length === 0 && <p className="text-xs text-slate-400">Sin mensajes todavía.</p>}
          {messagesQuery.data?.items.map((m) => (
            <div key={m.id} className={`text-sm ${m.senderType === "carrier_portal" ? "text-right" : ""}`}>
              <p
                className={`inline-block px-3 py-1.5 rounded-lg text-xs ${
                  m.senderType === "carrier_portal" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700"
                }`}
              >
                {m.body}
              </p>
            </div>
          ))}
        </div>
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            placeholder="Escribe un mensaje…"
            className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg">
            Enviar
          </button>
        </form>
      </section>
    </div>
  );
}
