import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import Toast from "@/components/Toast";
import NewCarrierModal, { CarrierEditable } from "@/pages/masters/NewCarrierModal";

interface CarrierRow {
  id: string;
  legalName: string;
  taxId: string;
  city: string | null;
  province: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
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
  // Fase 7b: antes esta pantalla no tenía ni alta -- solo mostraba lo que ya
  // hubiera en la base de datos. El backend (carriers.routes.ts) ya soportaba
  // crear/editar; ahora también dar de baja.
  const [editing, setEditing] = useState<CarrierEditable | "new" | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/carriers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      showSuccess("Transportista dado de baja correctamente");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo dar de baja el transportista"),
  });

  function handleDelete(c: CarrierRow) {
    if (window.confirm(`¿Dar de baja al transportista "${c.legalName}"? Sus rutas y liquidaciones históricas no se ven afectadas.`)) {
      deleteMutation.mutate(c.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          {!embedded && <h1 className="text-xl font-semibold text-slate-900">Transportistas</h1>}
          <p className="text-sm text-slate-500">{data?.total ?? 0} transportistas subcontratados</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Nuevo transportista
        </button>
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
              <th className="text-left px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Sin transportistas registrados.</td>
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
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => setEditing(c)} className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3">
                    Editar
                  </button>
                  <button onClick={() => handleDelete(c)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewCarrierModal
        open={editing !== null}
        carrier={editing === "new" || editing === null ? null : editing}
        onClose={() => setEditing(null)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
