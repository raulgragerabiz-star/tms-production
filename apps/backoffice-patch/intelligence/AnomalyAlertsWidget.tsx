// Copiar a apps/backoffice/src/components/dashboard/AnomalyAlertsWidget.tsx
// Se monta en la zona "Atención" del Dashboard (07-dashboard-TMS.md), junto
// al listado de `incident.status = open` ya existente — mismo patrón:
// lista ordenada por antigüedad, acceso directo, acción rápida.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface AnomalyAlert {
  id: string;
  alertType:
    | "order_weight_deviation"
    | "settlement_amount_deviation"
    | "low_route_occupancy"
    | "inefficient_route_distance";
  severity: "low" | "medium" | "high";
  entityName: string;
  entityId: string;
  description: string;
  expectedRange: string | null;
  detectedAt: string;
}

const SEVERITY_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const ALERT_TYPE_LABEL: Record<string, string> = {
  order_weight_deviation: "Peso de pedido anómalo",
  settlement_amount_deviation: "Liquidación anómala",
  low_route_occupancy: "Ocupación baja recurrente",
  inefficient_route_distance: "Ruta ineficiente (distancia)",
};

export default function AnomalyAlertsWidget() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["anomaly-alerts", "pending"],
    queryFn: async () =>
      (await apiClient.get<{ alerts: AnomalyAlert[] }>("/anomalies", { params: { status: "pending" } })).data
        .alerts,
    refetchInterval: 5 * 60 * 1000, // cada 5 min — no es near-real-time, los jobs corren de madrugada
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "reviewed" | "dismissed" }) =>
      apiClient.patch(`/anomalies/${id}`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["anomaly-alerts"] }),
  });

  if (!data || data.length === 0) return null; // sin alertas, no ocupar espacio (mismo criterio que OfflineBanner)

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">Anomalías detectadas ({data.length})</h3>
      <ul className="space-y-2">
        {data.map((alert) => (
          <li key={alert.id} className={`border rounded-md p-3 text-xs ${SEVERITY_STYLE[alert.severity]}`}>
            <div className="flex justify-between items-start gap-2">
              <div>
                <span className="font-semibold">{ALERT_TYPE_LABEL[alert.alertType]}</span>
                <p className="mt-1 text-slate-700 font-normal">{alert.description}</p>
                {alert.expectedRange && (
                  <p className="mt-1 text-[10px] opacity-70">Rango esperado: {alert.expectedRange}</p>
                )}
              </div>
              <div className="flex flex-col gap-1 shrink-0">
                <button
                  onClick={() => reviewMutation.mutate({ id: alert.id, status: "reviewed" })}
                  className="text-[10px] underline"
                >
                  Marcar revisada
                </button>
                <button
                  onClick={() => reviewMutation.mutate({ id: alert.id, status: "dismissed" })}
                  className="text-[10px] underline opacity-60"
                >
                  Descartar
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
