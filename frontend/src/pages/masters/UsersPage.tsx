import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Chip from "@/components/Chip";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth-store";
import NewUserModal from "@/pages/masters/NewUserModal";
import EditUserModal from "@/pages/masters/EditUserModal";

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  userType: string;
  active: boolean;
  createdAt: string;
  roles: { role: { id: string; name: string } }[];
}

const userTypeLabel: Record<string, string> = {
  internal: "Interno",
  carrier_portal: "Portal Transportista",
  driver_app: "App Conductor",
  customer_portal: "Portal Cliente",
};

export default function UsersPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);

  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get("/users")).data as { items: UserRow[]; total: number },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => (await api.patch(`/users/${id}/active`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo actualizar el usuario"),
  });

  // Fase 8i: "Eliminar" de verdad (no solo desactivar) -- petición explícita
  // de Raúl. Borrado físico en el backend (a diferencia de Clientes/
  // Transportistas, que son bajas lógicas); por eso aquí sí hace falta una
  // confirmación explícita, igual que ya se pide en otros borrados
  // definitivos del proyecto.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/users/${id}`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      showSuccess("Usuario eliminado");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo eliminar el usuario"),
  });

  function handleDelete(u: UserRow) {
    if (window.confirm(`¿Eliminar definitivamente al usuario "${u.fullName}" (${u.email})? Esta acción no se puede deshacer.`)) {
      deleteMutation.mutate(u.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Usuarios</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Nuevo usuario
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Da de alta accesos internos y de los portales externos (Transportista, Conductor, Cliente).
        Cada portal usa su propia app y comparte este mismo backend con scope restringido.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Nombre</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Tipo de acceso</th>
              <th className="text-left px-4 py-3">Roles</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((u) => (
              <tr key={u.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">{userTypeLabel[u.userType] ?? u.userType}</td>
                <td className="px-4 py-3 text-slate-500">{u.roles.map((r) => r.role.name).join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  <Chip color={u.active ? "teal" : "slate"}>{u.active ? "Activo" : "Inactivo"}</Chip>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button onClick={() => setEditingUser(u)} className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3">
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActiveMutation.mutate({ id: u.id, active: !u.active })}
                    className="text-xs text-red-500 hover:text-red-600 font-medium mr-3"
                  >
                    {u.active ? "Desactivar" : "Reactivar"}
                  </button>
                  {/* No se puede eliminar la propia cuenta desde aquí -- mismo
                      guard que ya aplica el backend, para no dejar el botón
                      visible ofreciendo algo que luego el servidor rechaza. */}
                  {u.id !== currentUser?.id && (
                    <button onClick={() => handleDelete(u)} className="text-xs text-red-700 hover:text-red-800 font-semibold">
                      Eliminar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewUserModal open={modalOpen} onClose={() => setModalOpen(false)} onSuccess={showSuccess} onError={showError} />
      <EditUserModal
        open={editingUser !== null}
        user={editingUser}
        onClose={() => setEditingUser(null)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
