import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";

// Motor de inteligencia (1/3): detección de anomalías -- ver
// anomaly-detection.service.ts. "Vigilancia de patrones fuera de lo
// habitual... generando alerta para revisión humana, no corrección
// automática": esta pantalla es exactamente eso, revisar y marcar cada
// alerta como revisada o descartarla (falso positivo), nunca corregir nada
// por su cuenta.
//
// Todavía no hay ningún job programado que ejecute la detección sola (no
// hay infraestructura de jobs en el backend); de momento se dispara a mano
// con el botón "Ejecutar detección ahora".
interface AnomalyAlert {
  id: string;
  alertType: string;
  severity: "low" | "medium" | "high";
  entityName: string;
  entityId: string;
  description: string;
  metricValue: string | null;
  expectedRange: string | null;
  status: "pending" | "reviewed" | "dismissed";
  detectedAt: string;
}

const alertTypeLabel: Record<string, string> = {
  order_weight_deviation: "Peso de pedido inusual",
  settlement_amount_deviation: "Importe de liquidación inusual",
  low_route_occupancy: "Ocupación de ruta baja",
  inefficient_route_distance: "Ruta ineficiente",
};

const severityStyle: Record<string, string> = {
  low: "bg-slate-100 text-slate-600",
  medium: "bg-amber-100 text-amber-700",
  high: "bg-red-100 text-red-700",
};

const severityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export default function AnomaliesPage() {
  const [status, setStatus] = useState<string>("pending");
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["anomalies", status],
    queryFn: async () =>
      (await api.get("/intelligence/anomalies", { params: status ? { status } : {} })).data as {
        alerts: AnomalyAlert[];
      },
  });

  const runMutation = useMutation({
    mutationFn: async () => (await api.post("/intelligence/anomalies/run")).data,
    onSuccess: (result: any) => {
      const total =
        (result.weightAnomalies ?? 0) +
        (result.settlementAnomalies ?? 0) +
        (result.occupancyAnomalies ?? 0) +
        (result.distanceAnomalies ?? 0);
      queryClient.invalidateQueries({ queryKey: ["anomalies"] });
      showSuccess(total > 0 ? `Detección completada: ${total} alerta(s) nueva(s)` : "Detección completada: sin alertas nuevas");
    },
    onError: () => showError("No se ha podido ejecutar la detección"),
  });

  const reviewMutation = useMutation({
    mutationFn: async (payload: { id: string; status: "reviewed" | "dismissed" }) =>
      api.patch(`/intelligence/anomalies/${payload.id}`, { status: payload.status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["anomalies"] }),
    onError: () => showError("No se ha podido actualizar la alerta"),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Alertas de anomalías</h1>
          <p className="text-sm text-slate-500">
            Patrones fuera de lo habitual detectados automáticamente -- revisión humana, no corrección automática.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2"
          >
            <option value="pending">Pendientes</option>
            <option value="reviewed">Revisadas</option>
            <option value="dismissed">Descartadas</option>
            <option value="">Todas</option>
          </select>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {runMutation.isPending ? "Ejecutando…" : "Ejecutar detección ahora"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Detectada</th>
              <th className="text-left px-4 py-3">Tipo</th>
              <th className="text-left px-4 py-3">Severidad</th>
              <th className="text-left px-4 py-3">Descripción</th>
              <th className="text-left px-4 py-3">Rango esperado</th>
              {status === "pending" && <th className="text-left px-4 py-3">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && (data?.alerts.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Sin alertas{status === "pending" ? " pendientes" : ""}.
                </td>
              </tr>
            )}
            {data?.alerts.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 align-top">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(a.detectedAt).toLocaleString("es-ES")}
                </td>
                <td className="px-4 py-3 text-slate-700">{alertTypeLabel[a.alertType] ?? a.alertType}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severityStyle[a.severity]}`}>
                    {severityLabel[a.severity] ?? a.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-600 max-w-md">{a.description}</td>
                <td className="px-4 py-3 text-slate-500">{a.expectedRange ?? "—"}</td>
                {status === "pending" && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <button
                      onClick={() => reviewMutation.mutate({ id: a.id, status: "reviewed" })}
                      className="text-emerald-600 hover:text-emerald-700 text-xs font-medium mr-3"
                    >
                      Marcar revisada
                    </button>
                    <button
                      onClick={() => reviewMutation.mutate({ id: a.id, status: "dismissed" })}
                      className="text-slate-400 hover:text-slate-600 text-xs font-medium"
                    >
                      Descartar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
