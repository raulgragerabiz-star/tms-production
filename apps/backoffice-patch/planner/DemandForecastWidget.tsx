// Copiar a apps/backoffice/src/components/planner/DemandForecastWidget.tsx
// Se monta en el Planificador (Fase 7, 08-planificador-rutas-TMS.md),
// como panel colapsable junto al lienzo de rutas — "anticipar necesidad
// de capacidad de flota antes de que el pool de pendientes se sature".

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface DemandForecast {
  id: string;
  province: string;
  forecastDate: string;
  expectedOrdersP50: string;
  expectedOrdersP80: string;
  expectedWeightKgP50: string;
  expectedWeightKgP80: string;
  sampleSize: number;
}

interface DemandForecastWidgetProps {
  warehouseId: string;
}

export default function DemandForecastWidget({ warehouseId }: DemandForecastWidgetProps) {
  const { data } = useQuery({
    queryKey: ["demand-forecast", warehouseId],
    queryFn: async () =>
      (
        await apiClient.get<{ forecasts: DemandForecast[] }>("/demand-forecast", {
          params: { warehouseId },
        })
      ).data.forecasts,
  });

  if (!data || data.length === 0) return null;

  // Agrupar por fecha, mostrar solo los próximos 7 días para no saturar
  // el panel — el resto está disponible vía /demand-forecast si se
  // necesita más horizonte.
  const next7Days = data.filter((f) => {
    const days = (new Date(f.forecastDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return days <= 7;
  });

  if (next7Days.length === 0) return null;

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-1">Demanda prevista (próximos 7 días)</h3>
      <p className="text-[10px] text-slate-400 mb-3">
        Basado en el histórico de las últimas 12 semanas del mismo día de la semana, por provincia.
      </p>
      <ul className="space-y-2 max-h-64 overflow-y-auto">
        {next7Days.map((f) => (
          <li key={f.id} className="flex items-center justify-between text-xs border-b last:border-0 pb-2">
            <div>
              <span className="font-medium text-slate-800">{f.province}</span>
              <span className="text-slate-400 ml-2">
                {new Date(f.forecastDate).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}
              </span>
            </div>
            <div className="text-right">
              <span className="text-slate-700">
                ~{Math.round(Number(f.expectedOrdersP50))} pedidos
              </span>
              <span className="text-amber-600 ml-2" title="Percentil 80 — refuerzo recomendado si se supera">
                (hasta {Math.round(Number(f.expectedOrdersP80))})
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
