import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface TimelineStep {
  key: string;
  label: string;
  done: boolean;
}

interface FeedbackDetail {
  rating: number;
  comment: string | null;
}

interface OrderDetail {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    requestedDeliveryDate: string;
    deliveryPoint: { label: string; address: string; city: string };
    lines: { product: string; quantity: number; unit: string }[];
  };
  timeline: TimelineStep[];
  feedback: FeedbackDetail | null;
}

interface PodDetail {
  signatureUrl: string | null;
  photoUrls: string[] | null;
  receivedByName: string | null;
  deliveredAt: string;
}

const INCIDENT_TYPE_LABEL: Record<string, string> = {
  delay: "Retraso",
  damage: "Mercancía dañada",
  refused: "Rechazo del pedido",
  access_issue: "Problema de acceso al punto de entrega",
  other: "Otro",
};

// Nota sobre los enlaces "download" de más abajo: un <a href download> sí puede
// descargar una data URL sin que el navegador la bloquee; window.open(dataUrl)
// en cambio se queda en blanco en Chrome/Firefox por política de seguridad
// frente a navegación a data: URLs -- por eso antes se veía la página en
// blanco al pulsar "Descargar justificante".
export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const queryClient = useQueryClient();

  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentType, setIncidentType] = useState("delay");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentSent, setIncidentSent] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: async () => {
      const res = await apiClient.get<OrderDetail>(`/orders/${orderId}`);
      return res.data;
    },
    // Objetivo 4: que el seguimiento se actualice solo (antes había que
    // recargar la página a mano para ver un cambio de estado nuevo).
    refetchInterval: 30000,
  });

  // La firma/fotos pueden pesar varios cientos de KB en base64 -- solo se
  // piden cuando el pedido ya está entregado, y no en cada refresco de arriba.
  const { data: pod, isLoading: isLoadingPod } = useQuery({
    queryKey: ["customer-order-pod", orderId],
    queryFn: async () => {
      const res = await apiClient.get<PodDetail>(`/orders/${orderId}/pod`);
      return res.data;
    },
    enabled: data?.order.status === "delivered",
  });

  // Objetivo 4: reportar incidencia -- disponible sobre cualquier pedido no
  // cancelado, no solo los ya entregados (una incidencia puede surgir
  // mientras el pedido está en curso).
  const incidentMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/orders/${orderId}/incidents`, {
        incidentType,
        description: incidentDescription || undefined,
      });
    },
    onSuccess: () => {
      setIncidentSent(true);
      setIncidentOpen(false);
      setIncidentDescription("");
    },
  });

  // Objetivo 4: valoración de satisfacción tras la entrega.
  const feedbackMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post(`/orders/${orderId}/feedback`, {
        rating,
        comment: comment || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customer-order", orderId] });
    },
  });

  if (isLoading) {
    return <p className="p-6 text-sm text-slate-500">Cargando...</p>;
  }
  if (!data) {
    return <p className="p-6 text-sm text-slate-500">Pedido no encontrado.</p>;
  }

  const { order, timeline, feedback } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center gap-3">
        <Link to="/" className="text-sm text-slate-500 hover:text-slate-800">
          ← Volver
        </Link>
        <h1 className="text-lg font-semibold text-slate-800">{order.orderNumber}</h1>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-6">
        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-medium text-slate-500 mb-3">Entrega</h2>
          <p className="text-sm text-slate-800">{order.deliveryPoint.label}</p>
          <p className="text-sm text-slate-500">
            {order.deliveryPoint.address}, {order.deliveryPoint.city}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            Fecha comprometida:{" "}
            {new Date(order.requestedDeliveryDate).toLocaleDateString("es-ES")}
          </p>
        </section>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-medium text-slate-500 mb-4">Estado</h2>
          <ol className="flex items-center w-full">
            {timeline.map((step, i) => (
              <li key={step.key} className="flex-1 flex items-center">
                <div className="flex flex-col items-center flex-1">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      step.done ? "bg-green-500 text-white" : "bg-slate-200 text-slate-400"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </div>
                  <span className="text-xs text-slate-600 mt-2 text-center">{step.label}</span>
                </div>
                {i < timeline.length - 1 && (
                  <div
                    className={`h-0.5 flex-1 -mt-6 ${
                      step.done ? "bg-green-500" : "bg-slate-200"
                    }`}
                  />
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="bg-white rounded-lg shadow p-5">
          <h2 className="text-sm font-medium text-slate-500 mb-3">Líneas del pedido</h2>
          <ul className="divide-y divide-slate-100">
            {order.lines.map((l, i) => (
              <li key={i} className="py-2 flex justify-between text-sm">
                <span className="text-slate-700">{l.product}</span>
                <span className="text-slate-500">
                  {l.quantity} {l.unit}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {order.status === "delivered" && (
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-sm font-medium text-slate-500 mb-3">Justificante de entrega</h2>

            {isLoadingPod && <p className="text-sm text-slate-500">Cargando justificante...</p>}

            {!isLoadingPod && !pod && (
              <p className="text-sm text-slate-500">Todavía no hay justificante disponible para este pedido.</p>
            )}

            {pod && (
              <div className="space-y-4">
                <p className="text-sm text-slate-600">
                  Entregado el {new Date(pod.deliveredAt).toLocaleString("es-ES")}
                  {pod.receivedByName ? ` · Recibido por ${pod.receivedByName}` : ""}
                </p>

                {pod.signatureUrl && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">Firma</p>
                    <img
                      src={pod.signatureUrl}
                      alt="Firma de quien recibió el pedido"
                      className="w-full max-w-sm border border-slate-200 rounded-md bg-slate-50"
                    />
                    <a href={pod.signatureUrl} download={`firma-${order.orderNumber}.png`} className="inline-block mt-2 text-sm text-blue-700 font-medium underline">
                      Descargar firma
                    </a>
                  </div>
                )}

                {pod.photoUrls && pod.photoUrls.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-slate-500 mb-1">Fotos de la entrega</p>
                    <div className="grid grid-cols-3 gap-2">
                      {pod.photoUrls.map((url, idx) => (
                        <a key={idx} href={url} download={`foto-${order.orderNumber}-${idx + 1}.jpg`}>
                          <img
                            src={url}
                            alt={`Foto de entrega ${idx + 1}`}
                            className="w-full aspect-square object-cover rounded-md border border-slate-200"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {order.status === "delivered" && (
          <section className="bg-white rounded-lg shadow p-5">
            <h2 className="text-sm font-medium text-slate-500 mb-3">Tu valoración</h2>

            {feedback ? (
              <div>
                <div className="flex gap-1 text-lg text-amber-400">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n}>{n <= feedback.rating ? "★" : "☆"}</span>
                  ))}
                </div>
                {feedback.comment && <p className="text-sm text-slate-600 mt-2">{feedback.comment}</p>}
                <p className="text-xs text-slate-400 mt-1">Gracias por valorar esta entrega.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">¿Cómo ha sido la entrega de este pedido?</p>
                <div className="flex gap-1 text-2xl">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      className={n <= rating ? "text-amber-400" : "text-slate-300"}
                      aria-label={`${n} estrellas`}
                    >
                      {n <= rating ? "★" : "☆"}
                    </button>
                  ))}
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Comentario opcional..."
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                />
                <button
                  type="button"
                  disabled={rating === 0 || feedbackMutation.isPending}
                  onClick={() => feedbackMutation.mutate()}
                  className="rounded-md bg-blue-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40"
                >
                  {feedbackMutation.isPending ? "Enviando..." : "Enviar valoración"}
                </button>
                {feedbackMutation.isError && (
                  <p className="text-sm text-red-600">No se pudo enviar la valoración. Inténtalo de nuevo.</p>
                )}
              </div>
            )}
          </section>
        )}

        {order.status !== "cancelled" && (
          <section className="bg-white rounded-lg shadow p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-medium text-slate-500">¿Algún problema con este pedido?</h2>
              {!incidentOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setIncidentOpen(true);
                    setIncidentSent(false);
                  }}
                  className="text-sm text-blue-700 font-medium underline"
                >
                  Reportar incidencia
                </button>
              )}
            </div>

            {incidentSent && !incidentOpen && (
              <p className="text-sm text-green-700 mt-2">
                Incidencia reportada. Nuestro equipo la revisará en breve.
              </p>
            )}

            {incidentOpen && (
              <div className="space-y-3 mt-3">
                <select
                  value={incidentType}
                  onChange={(e) => setIncidentType(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {Object.entries(INCIDENT_TYPE_LABEL).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={incidentDescription}
                  onChange={(e) => setIncidentDescription(e.target.value)}
                  placeholder="Describe brevemente lo ocurrido (opcional)"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={incidentMutation.isPending}
                    onClick={() => incidentMutation.mutate()}
                    className="rounded-md bg-blue-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40"
                  >
                    {incidentMutation.isPending ? "Enviando..." : "Enviar incidencia"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIncidentOpen(false)}
                    className="rounded-md text-sm text-slate-500 px-4 py-2 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                </div>
                {incidentMutation.isError && (
                  <p className="text-sm text-red-600">
                    No se pudo reportar la incidencia (puede que el pedido aún no tenga un envío en curso).
                  </p>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}