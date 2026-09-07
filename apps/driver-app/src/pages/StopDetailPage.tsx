import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

interface TodayRouteResponse {
  shipment: {
    id: string;
    route: {
      stops: {
        id: string;
        sequence: number;
        status: string;
        order: {
          orderNumber: string;
          notes: string | null;
          customer: { legalName: string };
          deliveryPoint: { address: string; city: string | null; contactPhone: string | null };
          lines: { quantity: string; unit: string; product: { description: string } }[];
        };
        pod: { deliveredAt: string; receivedByName: string | null } | null;
      }[];
    };
  } | null;
}

export default function StopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [receivedByName, setReceivedByName] = useState("");
  const [showFailForm, setShowFailForm] = useState(false);
  const [failureReason, setFailureReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["today-route"],
    queryFn: async () => (await api.get("/driver-app/today-route")).data as TodayRouteResponse,
  });

  const stop = data?.shipment?.route.stops.find((s) => s.id === id);

  const arriveMutation = useMutation({
    mutationFn: async () => (await api.post(`/driver-app/stops/${id}/arrive`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-route"] }),
  });

  const completeMutation = useMutation({
    mutationFn: async () =>
      (await api.post(`/driver-app/stops/${id}/complete`, { receivedByName: receivedByName || "Firma en dispositivo" })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      navigate("/");
    },
  });

  const failMutation = useMutation({
    mutationFn: async () => (await api.post(`/driver-app/stops/${id}/complete`, { failed: true, failureReason })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      navigate("/");
    },
  });

  if (isLoading) return <p className="text-sm text-slate-400 text-center mt-10">Cargando…</p>;
  if (!stop) return <p className="text-sm text-slate-400 text-center mt-10">Parada no encontrada.</p>;

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="bg-white border-b border-slate-200 px-4 py-4 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate("/")} className="text-brand-600 text-xl leading-none">
          ←
        </button>
        <h1 className="text-base font-bold text-slate-800">Parada #{stop.sequence}</h1>
      </header>

      <main className="px-4 pt-4 max-w-lg mx-auto space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-lg font-semibold text-slate-900">{stop.order.customer.legalName}</p>
          <p className="text-sm text-slate-500">
            {stop.order.deliveryPoint.address}
            {stop.order.deliveryPoint.city ? `, ${stop.order.deliveryPoint.city}` : ""}
          </p>
          {stop.order.deliveryPoint.contactPhone && (
            <a href={`tel:${stop.order.deliveryPoint.contactPhone}`} className="text-sm text-brand-600 font-medium mt-1 inline-block">
              📞 {stop.order.deliveryPoint.contactPhone}
            </a>
          )}
          {stop.order.notes && <p className="text-xs text-amber-600 mt-2 bg-amber-50 rounded-lg p-2">{stop.order.notes}</p>}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-2">Contenido del pedido</p>
          <ul className="space-y-1">
            {stop.order.lines.map((l, idx) => (
              <li key={idx} className="text-sm text-slate-600">
                {l.quantity} {l.unit} — {l.product.description}
              </li>
            ))}
          </ul>
        </div>

        {stop.status === "pending" && (
          <button
            onClick={() => arriveMutation.mutate()}
            disabled={arriveMutation.isPending}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-2xl py-4 text-base font-semibold shadow"
          >
            He llegado
          </button>
        )}

        {(stop.status === "pending" || stop.status === "arrived") && !showFailForm && (
          <div className="space-y-3">
            <input
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              placeholder="Nombre de quien recibe (opcional)"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
            />
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl py-4 text-base font-semibold shadow"
            >
              ✓ Confirmar entrega
            </button>
            <button
              onClick={() => setShowFailForm(true)}
              className="w-full bg-white border border-red-300 text-red-600 rounded-2xl py-3 text-sm font-medium"
            >
              Entrega fallida / incidencia
            </button>
          </div>
        )}

        {showFailForm && (
          <div className="space-y-3 bg-white rounded-2xl border border-red-200 p-4">
            <textarea
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              placeholder="Motivo de la incidencia…"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
              rows={3}
            />
            <button
              onClick={() => failMutation.mutate()}
              disabled={!failureReason.trim() || failMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl py-3 text-sm font-semibold disabled:opacity-50"
            >
              Confirmar incidencia
            </button>
            <button onClick={() => setShowFailForm(false)} className="w-full text-sm text-slate-500">
              Cancelar
            </button>
          </div>
        )}

        {stop.status === "completed" && stop.pod && (
          <div className="bg-emerald-50 rounded-2xl p-4 text-center">
            <p className="text-emerald-700 font-medium">Entrega confirmada</p>
            <p className="text-xs text-emerald-600 mt-1">
              {new Date(stop.pod.deliveredAt).toLocaleString("es-ES")}
              {stop.pod.receivedByName ? ` · ${stop.pod.receivedByName}` : ""}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
