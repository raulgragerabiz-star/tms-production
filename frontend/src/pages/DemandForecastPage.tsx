import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";

// Motor de inteligencia (2/3): predicción de demanda -- ver
// demand-forecast.service.ts. Percentiles P50/P80 de pedidos y peso
// esperados por almacén+provincia y fecha, calculados sobre el histórico del
// mismo día de la semana en las últimas 12 semanas. Sin job programado
// todavía (no hay infraestructura de tareas periódicas en el backend); se
// recalcula a mano con el botón "Ejecutar pronóstico ahora", mismo criterio
// que Alertas (motor de inteligencia, pieza 1/3).
interface ForecastRow {
  id: string;
  warehouseId: string;
  warehouse: { id: string; name: string };
  province: string;
  forecastDate: string;
  expectedOrdersP50: string;
  expectedOrdersP80: string;
  expectedWeightKgP50: string;
  expectedWeightKgP80: string;
  sampleSize: number;
  calculatedAt: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

function formatKg(kg: number) {
  if (kg >= 1000) return `${(kg / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} t`;
  return `${kg.toLocaleString("es-ES", { maximumFractionDigits: 0 })} kg`;
}

export default function DemandForecastPage() {
  const [warehouseId, setWarehouseId] = useState<string>("");
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["demand-forecast", warehouseId],
    queryFn: async () =>
      (await api.get("/intelligence/demand-forecast", { params: warehouseId ? { warehouseId } : {} })).data as {
        items: ForecastRow[];
        total: number;
      },
  });

  const runMutation = useMutation({
    mutationFn: async () => (await api.post("/intelligence/demand-forecast/run")).data as { forecastsWritten: number; combosEvaluated: number },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["demand-forecast"] });
      showSuccess(
        result.forecastsWritten > 0
          ? `Pronóstico recalculado: ${result.forecastsWritten} previsión(es) sobre ${result.combosEvaluated} zona(s)`
          : `Sin histórico suficiente todavía en ninguna de las ${result.combosEvaluated} zona(s) con pedidos recientes`
      );
    },
    onError: () => showError("No se ha podido recalcular el pronóstico"),
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Previsión de demanda</h1>
          <p className="text-sm text-slate-500">
            Pedidos y peso esperados por almacén y provincia, próximos 14 días -- percentiles P50/P80 sobre el
            histórico del mismo día de la semana (últimas 12 semanas).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={warehouseId}
            onChange={(e) => setWarehouseId(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2"
          >
            <option value="">Todos los almacenes</option>
            {warehousesQuery.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            {runMutation.isPending ? "Calculando…" : "Ejecutar pronóstico ahora"}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Fecha</th>
              <th className="text-left px-4 py-3">Almacén</th>
              <th className="text-left px-4 py-3">Provincia</th>
              <th className="text-right px-4 py-3">Pedidos (P50)</th>
              <th className="text-right px-4 py-3">Pedidos (P80)</th>
              <th className="text-right px-4 py-3">Peso (P50)</th>
              <th className="text-right px-4 py-3">Peso (P80)</th>
              <th className="text-right px-4 py-3">Muestra</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {!isLoading && (data?.items.length ?? 0) === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                  Sin pronósticos calculados todavía. Pulsa "Ejecutar pronóstico ahora" -- hace falta al menos 4
                  semanas de histórico por almacén y provincia para poder pronosticar.
                </td>
              </tr>
            )}
            {data?.items.map((f) => (
              <tr key={f.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3 font-mono text-slate-600">
                  {new Date(f.forecastDate).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "short" })}
                </td>
                <td className="px-4 py-3 text-slate-700">{f.warehouse.name}</td>
                <td className="px-4 py-3 text-slate-500">{f.province}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{Math.round(Number(f.expectedOrdersP50))}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{Math.round(Number(f.expectedOrdersP80))}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{formatKg(Number(f.expectedWeightKgP50))}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{formatKg(Number(f.expectedWeightKgP80))}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-500">{f.sampleSize} sem.</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
