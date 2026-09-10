import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: UsersPage ya dejaba activar/desactivar, pero no corregir un
// nombre o email mal escrito, ni cambiar los roles de un usuario interno --
// solo se podía dar de baja y crear uno nuevo. Deliberadamente NO toca aquí
// el tipo de acceso (userType) ni a qué transportista/cliente/conductor
// apunta un usuario de portal externo -- eso es su "scope" y cambiarlo aquí
// podría desengancharlo sin querer; para eso sigue haciendo falta dar de
// baja y crear uno nuevo. Tampoco toca la contraseña -- ya tiene su propio
// "Restablecer contraseña".

export interface UserEditable {
  id: string;
  email: string;
  fullName: string;
  userType: string;
  roles: { role: { id: string; name: string } }[];
}

interface RoleOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  user: UserEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function EditUserModal({ open, user, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/users/roles")).data as { items: RoleOption[] },
    enabled: open && user?.userType === "internal",
  });

  useEffect(() => {
    if (!open || !user) return;
    setFullName(user.fullName);
    setEmail(user.email);
    setRoleIds(user.roles.map((r) => r.role.id));
  }, [open, user]);

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.put(`/users/${user!.id}`, {
          fullName: fullName.trim(),
          email: email.trim(),
          roleIds: user!.userType === "internal" ? roleIds : undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onSuccess("Usuario actualizado correctamente");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al actualizar el usuario"),
  });

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  if (!user) return null;
  const canSubmit = fullName.trim().length > 0 && email.trim().length > 0;

  return (
    <Modal open={open} title={`Editar usuario — ${user.email}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre completo" required>
            <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field label="Email" required>
            <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>

        {user.userType === "internal" && (
          <Field label="Roles">
            <div className="space-y-1 border border-slate-200 rounded-lg p-2 max-h-32 overflow-y-auto">
              {rolesQuery.data?.items.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm px-1 py-0.5">
                  <input type="checkbox" checked={roleIds.includes(r.id)} onChange={() => toggleRole(r.id)} className="rounded border-slate-300" />
                  {r.name}
                </label>
              ))}
            </div>
          </Field>
        )}

        <p className="text-xs text-slate-400">
          Para cambiar la contraseña o el tipo de acceso, usa "Restablecer contraseña" o da de baja y crea uno nuevo.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : "Guardar cambios"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
