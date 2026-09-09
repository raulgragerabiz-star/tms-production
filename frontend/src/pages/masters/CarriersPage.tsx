import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";

interface CarrierRow {
  id: string;
  legalName: string;
  taxId: string;
  city: string | null;
  province: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  _count: { vehicles: number };
}

// 2026-09-09: "embedded" -- se usa desde el nuevo "Flota y Transportistas"
// (pestaña Empresa), que ya pone su propio título arriba; sin este prop
// (uso independiente, por si algún sitio la sigue montando suelta) el
// comportamiento no cambia en nada.
export default function CarriersPage({ embedded = false }: { embedded?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierRow[]; total: number },
  });

  return (
    <div>
      <div className="mb-4">
        {!embedded && <h1 className="text-xl font-semibold text-slate-900">Transportistas</h1>}
        <p className="text-sm text-slate-500">{data?.total ?? 0} transportistas subcontratados</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Razón social</th>
              <th className="text-left px-4 py-3">NIF</th>
              <th className="text-left px-4 py-3">Ciudad</th>
              <th className="text-left px-4 py-3">Servicio</th>
              <th className="text-left px-4 py-3">Flota propia</th>
              <th className="text-right px-4 py-3">Vehículos</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3 font-medium">{c.legalName}</td>
                <td className="px-4 py-3 font-mono font-semibold text-xs">{c.taxId}</td>
                <td className="px-4 py-3 text-slate-500">{c.city ?? "—"}</td>
                <td className="px-4 py-3 capitalize">{c.serviceType.replace("_", " ")}</td>
                <td className="px-4 py-3">{c.ownsFleet ? "Sí" : "No"}</td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{c._count.vehicles}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
