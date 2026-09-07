import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";

interface SettlementRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  totalAmount: string;
  lines: { id: string }[];
}

const statusLabel: Record<string, string> = {
  draft: "Borrador",
  validated: "Validada",
  approved: "Aprobada",
  paid: "Pagada",
  disputed: "En disputa",
};

export default function SettlementsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["carrier-settlements"],
    queryFn: async () => (await api.get("/carrier-portal/settlements")).data as { items: SettlementRow[]; total: number },
  });

  const disputeMutation = useMutation({
    mutationFn: async ({ id, comment }: { id: string; comment: string }) =>
      (await api.post(`/carrier-portal/settlements/${id}/dispute`, { comment })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["carrier-settlements"] }),
  });

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Liquidaciones</h2>
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!isLoading && data?.items.length === 0 && <p className="text-sm text-slate-400">Sin liquidaciones generadas.</p>}
        {data?.items.map((s) => (
          <div key={s.id} className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-800">
                {new Date(s.periodFrom).toLocaleDateString("es-ES")} — {new Date(s.periodTo).toLocaleDateString("es-ES")}
              </p>
              <p className="text-xs text-slate-500">{s.lines.length} envíos · {Number(s.totalAmount).toFixed(2)} €</p>
            </div>
            <div className="text-right">
              <span className="text-xs bg-slate-100 px-2 py-0.5 rounded-full text-slate-600">{statusLabel[s.status] ?? s.status}</span>
              {s.status !== "disputed" && s.status !== "paid" && (
                <button
                  onClick={() => {
                    const comment = window.prompt("Motivo de la disputa:");
                    if (comment) disputeMutation.mutate({ id: s.id, comment });
                  }}
                  className="block mt-1 text-xs text-red-500 hover:text-red-600 font-medium"
                >
                  Marcar como disputada
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
