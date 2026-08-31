// Copiar a apps/backoffice/src/pages/ReportsPage.tsx (Fase 5, Pantalla 12)

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface KpiCatalog {
  dimensions: { key: string }[];
  metrics: { key: string; label: string }[];
  periods: string[];
}

const DIMENSION_LABELS: Record<string, string> = {
  warehouseId: "Almacén",
  carrierId: "Transportista",
  vehicleTypeId: "Tipo de vehículo",
  driverId: "Conductor",
  customerId: "Cliente",
  serviceType: "Tipo de servicio",
  province: "Provincia",
};

export default function ReportsPage() {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["otifPct", "costRealSum"]);
  const [selectedDimensions, setSelectedDimensions] = useState<string[]>(["carrierId"]);
  const [period, setPeriod] = useState<string>("");
  const [from, setFrom] = useState(() => defaultFromDate());
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  const { data: catalog } = useQuery({
    queryKey: ["kpi-catalog"],
    queryFn: async () => (await apiClient.get<KpiCatalog>("/kpis/catalog")).data,
  });

  const queryMutation = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/kpis/query", {
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          metrics: selectedMetrics,
          dimensions: selectedDimensions,
          period: period || undefined,
        })
      ).data.rows as Record<string, string | number>[],
  });

  async function handleExport(format: "csv" | "xlsx" | "pdf") {
    const res = await apiClient.post(
      "/kpis/export",
      {
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        metrics: selectedMetrics,
        dimensions: selectedDimensions,
        period: period || undefined,
        format,
        title: "Informe TMS",
      },
      { responseType: "blob" }
    );

    const url = URL.createObjectURL(res.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = `informe-tms.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggle(list: string[], setList: (v: string[]) => void, key: string) {
    setList(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  }

  const rows = queryMutation.data ?? [];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-lg font-semibold text-slate-800">Informes / KPIs</h1>

      <div className="bg-white rounded-lg shadow p-5 space-y-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-xs font-medium text-slate-500">Desde</label>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Hasta</label>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="block rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-slate-500">Agrupar por periodo</label>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}
              className="block rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">(sin agrupar por fecha)</option>
              {catalog?.periods.map((p) => (
                <option key={p} value={p}>{p === "day" ? "Día" : p === "week" ? "Semana" : "Mes"}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">Dimensiones</p>
          <div className="flex flex-wrap gap-2">
            {catalog?.dimensions.map((d) => (
              <button
                key={d.key}
                onClick={() => toggle(selectedDimensions, setSelectedDimensions, d.key)}
                className={`text-xs px-3 py-1 rounded-full border ${
                  selectedDimensions.includes(d.key)
                    ? "bg-slate-900 text-white border-slate-900"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                {DIMENSION_LABELS[d.key] ?? d.key}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">Métricas</p>
          <div className="flex flex-wrap gap-2">
            {catalog?.metrics.map((m) => (
              <button
                key={m.key}
                onClick={() => toggle(selectedMetrics, setSelectedMetrics, m.key)}
                className={`text-xs px-3 py-1 rounded-full border ${
                  selectedMetrics.includes(m.key)
                    ? "bg-blue-600 text-white border-blue-600"
                    : "border-slate-300 text-slate-600"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => queryMutation.mutate()}
            disabled={selectedMetrics.length === 0 || queryMutation.isPending}
            className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {queryMutation.isPending ? "Consultando..." : "Consultar"}
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="bg-white rounded-lg shadow overflow-x-auto">
          <div className="flex justify-end gap-2 p-3 border-b">
            <button onClick={() => handleExport("csv")} className="text-xs text-slate-500 underline">CSV</button>
            <button onClick={() => handleExport("xlsx")} className="text-xs text-slate-500 underline">Excel</button>
            <button onClick={() => handleExport("pdf")} className="text-xs text-slate-500 underline">PDF</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b bg-slate-50">
                {columns.map((c) => <th key={c} className="py-2 px-3">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b last:border-0">
                  {columns.map((c) => (
                    <td key={c} className="py-2 px-3 text-slate-700">
                      {typeof row[c] === "number" ? Number(row[c]).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function defaultFromDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}
