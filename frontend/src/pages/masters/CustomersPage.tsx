import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

interface CustomerRow {
  id: string;
  businessCode: string;
  legalName: string;
  commercialName: string | null;
  active: boolean;
  _count: { deliveryPoints: number };
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search],
    queryFn: async () => (await api.get("/customers", { params: { search } })).data as { items: CustomerRow[]; total: number },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} clientes registrados</p>
        </div>
        <input
          placeholder="Buscar por código o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-64"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Código</th>
              <th className="text-left px-4 py-3">Razón social</th>
              <th className="text-left px-4 py-3">Nombre comercial</th>
              <th className="text-left px-4 py-3">Puntos de entrega</th>
              <th className="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{c.businessCode}</td>
                <td className="px-4 py-3">{c.legalName}</td>
                <td className="px-4 py-3 text-slate-500">{c.commercialName ?? "—"}</td>
                <td className="px-4 py-3">{c._count.deliveryPoints}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {c.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
