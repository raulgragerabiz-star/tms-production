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

export default function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["customer-order", orderId],
    queryFn: async () => {
      const res = await apiClient.get<OrderDetail>(`/orders/${orderId}`);
      return res.data;
    },
  });

  async function downloadPod() {
    const res = await apiClient.get(`/orders/${orderId}/pod`);
    if (res.data.signatureUrl) {
      window.open(res.data.signatureUrl, "_blank");
    }
  }

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
          <button
            onClick={downloadPod}
            className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium"
          >
            Descargar justificante de entrega (POD)
          </button>
        )}
      </main>
    </div>
  );
}
