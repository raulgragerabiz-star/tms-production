import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";

interface SettlementRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  totalAmount: string;
  carrier: { legalName: string };
  lines: { id: string }[];
}

export default function BillingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["settlements"],
    queryFn: async () => (await api.get("/billing/settlements")).data as { items: SettlementRow[]; total: number },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Facturación / Liquidaciones</h1>
      <p className="text-sm text-slate-500 mb-4">
        Liquidaciones por transportista y periodo, calculadas siempre contra la tarifa vigente en la fecha real
        del viaje.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Transportista</th>
              <th className="text-left px-4 py-3">Periodo</th>
              <th className="text-right px-4 py-3">Líneas</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin liquidaciones generadas.</td>
              </tr>
            )}
            {data?.items.map((s) => (
              <tr key={s.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3">{s.carrier.legalName}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(s.periodFrom).toLocaleDateString("es-ES")} — {new Date(s.periodTo).toLocaleDateString("es-ES")}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{s.lines.length}</td>
                <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{Number(s.totalAmount).toFixed(2)} €</td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
