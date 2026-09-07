import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import NewWarehouseModal from "@/pages/masters/NewWarehouseModal";

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
  const [modalOpen, setModalOpen] = useState(false);
  const { toast, showSuccess, showError, dismiss } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseRow[]; total: number },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Almacenes</h1>
        <button
          onClick={() => setModalOpen(true)}
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
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Nombre</th>
              <th className="text-left px-4 py-3">Dirección</th>
              <th className="text-left px-4 py-3">Ciudad</th>
              <th className="text-left px-4 py-3">Provincia</th>
              <th className="text-left px-4 py-3">Coordenadas</th>
              <th className="text-left px-4 py-3">Código externo</th>
              <th className="text-left px-4 py-3">Estado</th>
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
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Sin almacenes registrados.</td>
              </tr>
            )}
            {data?.items.map((w) => (
              <tr key={w.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{w.name}</td>
                <td className="px-4 py-3 text-slate-500">{w.address ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{w.city ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{w.province ?? "—"}</td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {w.lat && w.lng ? `${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono">{w.externalCode ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${w.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {w.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewWarehouseModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={showSuccess} onError={showError} />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
