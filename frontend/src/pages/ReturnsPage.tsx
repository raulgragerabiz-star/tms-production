import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

interface ReturnItemRow {
  id: string;
  itemDescription: string;
  pendingQuantity: string;
  status: string;
  customer: { legalName: string; businessCode: string };
  claims: { id: string; status: string }[];
}

const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  claimed: "Reclamado",
  collected: "Recogido",
  reconciled: "Conciliado",
};

export default function ReturnsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["return-items"],
    queryFn: async () => (await api.get("/returns/items")).data as { items: ReturnItemRow[]; total: number },
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Retornos</h1>
      <p className="text-sm text-slate-500 mb-4">
        Logística inversa: envases/palés pendientes de recogida por cliente. Se reclaman automáticamente en el
        viaje de vuelta al confirmar cada entrega.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Cliente</th>
              <th className="text-left px-4 py-3">Envase / palé</th>
              <th className="text-left px-4 py-3">Cantidad pendiente</th>
              <th className="text-left px-4 py-3">Reclamaciones</th>
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
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin retornos pendientes.</td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">{r.customer.businessCode} — {r.customer.legalName}</td>
                <td className="px-4 py-3">{r.itemDescription}</td>
                <td className="px-4 py-3">{r.pendingQuantity}</td>
                <td className="px-4 py-3">{r.claims.length}</td>
                <td className="px-4 py-3">{statusLabel[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
