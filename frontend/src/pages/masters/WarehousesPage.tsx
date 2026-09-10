import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Chip from "@/components/Chip";
import { useToast } from "@/hooks/use-toast";
import NewWarehouseModal, { WarehouseEditable } from "@/pages/masters/NewWarehouseModal";

interface WarehouseRow {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  externalCode: string | null;
  active: boolean;
}

export default function WarehousesPage() {
  const [editing, setEditing] = useState<WarehouseEditable | "new" | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseRow[]; total: number },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/warehouses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      showSuccess("Almacén dado de baja correctamente");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo dar de baja el almacén"),
  });

  function handleDelete(w: WarehouseRow) {
    if (window.confirm(`¿Dar de baja el almacén "${w.name}"? Sus rutas y pedidos históricos no se ven afectados.`)) {
      deleteMutation.mutate(w.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Almacenes</h1>
        <button
          onClick={() => setEditing("new")}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Nuevo almacén
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Punto de origen de toda ruta. El sistema soporta multialmacén desde el diseño.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Nombre</th>
              <th className="text-left px-4 py-3">Dirección</th>
              <th className="text-left px-4 py-3">Ciudad</th>
              <th className="text-left px-4 py-3">Provincia</th>
              <th className="text-left px-4 py-3">Coordenadas</th>
              <th className="text-left px-4 py-3">Código externo</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">Sin almacenes registrados.</td>
              </tr>
            )}
            {data?.items.map((w) => (
              <tr key={w.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3 font-medium">{w.name}</td>
                <td className="px-4 py-3 text-slate-500">{w.address ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{w.city ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{w.province ?? "—"}</td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                  {w.lat && w.lng ? `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono font-semibold">{w.externalCode ?? "—"}</td>
                <td className="px-4 py-3">
                  <Chip color={w.active ? "teal" : "slate"}>{w.active ? "Activo" : "Inactivo"}</Chip>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => setEditing(w)} className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3">
                    Editar
                  </button>
                  <button onClick={() => handleDelete(w)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                    Eliminar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewWarehouseModal
        open={editing !== null}
        warehouse={editing === "new" || editing === null ? null : editing}
        onClose={() => setEditing(null)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
