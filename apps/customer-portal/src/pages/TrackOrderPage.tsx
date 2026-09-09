import { FormEvent, useState } from "react";
import { lookupOrderTracking, TrackingResult } from "@/api/tracking";

// Consulta pública de estado de pedido: acceso único para cualquiera, sin
// usuario ni contraseña -- decisión explícita de Raúl para no tener que dar
// de alta un cliente + credenciales por cada pedido de prueba. Solo hace
// falta el Nº de pedido y el código postal de la entrega; la respuesta
// nunca incluye nada de otros pedidos ni datos internos (coste,
// observaciones...). El Portal Cliente con usuario/contraseña sigue
// existiendo en /login para quien ya lo tuviera configurado.
const statusLabel: Record<string, string> = {
  received: "Recibido",
  validated: "Validado",
  planned: "Planificado",
  loading: "En carga",
  dispatched: "Expedido",
  in_transit: "En reparto",
  delivered: "Entregado",
  incident: "Incidencia",
  cancelled: "Cancelado",
};

export default function TrackOrderPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const data = await lookupOrderTracking(orderNumber.trim(), postalCode.trim());
      setResult(data);
    } catch (err: any) {
      setError(
        err?.response?.status === 429
          ? "Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo."
          : "No se ha encontrado ningún pedido con ese número y código postal."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold text-slate-800">Consultar mi pedido</h1>
        <p className="text-sm text-slate-500">
          Introduce el número de pedido y el código postal de la entrega para ver su estado.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Nº de pedido</label>
            <input
              type="text"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Código postal de la entrega</label>
            <input
              type="text"
              required
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-slate-900 text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Consultando..." : "Consultar"}
          </button>
        </form>

        {result && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">Pedido {result.orderNumber}</p>
              <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-1 rounded-full">
                {statusLabel[result.status] ?? result.status}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Entrega en {result.city ?? "-"} · fecha comprometida{" "}
              {new Date(result.requestedDeliveryDate).toLocaleDateString("es-ES")}
            </p>
            <ul className="space-y-1.5">
              {result.timeline.map((step) => (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${step.done ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  <span className={step.done ? "text-slate-700" : "text-slate-400"}>{step.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
