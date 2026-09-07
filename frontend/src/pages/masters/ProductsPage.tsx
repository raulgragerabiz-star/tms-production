import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

interface ProductRow {
  id: string;
  sku: string;
  description: string;
  unitsPerPallet: number;
  grossWeightKg: string;
  fullPalletWeightKg: string;
  isReturnable: boolean;
  requiresCold: boolean;
}

export default function ProductsPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["products", search],
    queryFn: async () => (await api.get("/products", { params: { search } })).data as { items: ProductRow[]; total: number },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Productos</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} artículos en catálogo</p>
        </div>
        <input
          placeholder="Buscar por SKU o descripción…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-64"
        />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-left px-4 py-3">Descripción</th>
              <th className="text-left px-4 py-3">Uds/palé</th>
              <th className="text-left px-4 py-3">Peso bruto (kg)</th>
              <th className="text-left px-4 py-3">Peso palé lleno (kg)</th>
              <th className="text-left px-4 py-3">Retornable</th>
              <th className="text-left px-4 py-3">Frío</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3">{p.description}</td>
                <td className="px-4 py-3">{p.unitsPerPallet}</td>
                <td className="px-4 py-3">{Number(p.grossWeightKg).toFixed(2)}</td>
                <td className="px-4 py-3">{Number(p.fullPalletWeightKg).toFixed(1)}</td>
                <td className="px-4 py-3">{p.isReturnable ? "Sí" : "No"}</td>
                <td className="px-4 py-3">{p.requiresCold ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
