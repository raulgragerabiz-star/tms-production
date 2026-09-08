import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface TimelineStep {
  key: string;
  label: string;
  done: boolean;
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
}

interface PodDetail {
  signatureUrl: string | null;
  photoUrls: string[] | null;
  receivedByName: string | null;
  deliveredAt: string;
}

// Nota sobre los enlaces "download" de más abajo: un <a href download> sí puede
// descargar una data URL sin que el navegador la bloquee; window.open(dataUrl)
// en cambio se queda en blanco en Chrome/Firefox por política de seguridad
// frente a navegación a data: URLs -- por eso antes se veía la página en
// blanco al pulsar "Descargar justificante".
export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

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

  if (isLoading) {
    return <p className="p-6 text-sm text-slate-500">Cargando...</p>;
  }
  if (!data) {
    return <p className="p-6 text-sm text-slate-500">Pedido no encontrado.</p>;
  }

  const { order, timeline } = data;

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
                    
                      href={pod.signatureUrl}
                      download={`firma-${order.orderNumber}.png`}
                      className="inline-block mt-2 text-sm text-blue-700 font-medium underline"
                    >
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
      </main>
    </div>
  );
}
