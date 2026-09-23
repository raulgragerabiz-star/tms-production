import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface CarrierOption {
  id: string;
  legalName: string;
}

interface CustomerOption {
  id: string;
  businessCode: string;
  legalName: string;
}

interface DriverOption {
  id: string;
  fullName: string;
  carrier: { legalName: string };
}

interface RoleOption {
  id: string;
  name: string;
  code: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Fase 26 ("usuarios app" sub-fase 4): "Portal Transportista" se retira de las
// opciones de "Tipo de acceso" que se pueden dar de alta -- la app
// (apps/carrier-portal) y su API (/api/carrier-portal) se retiraron por
// completo (petición explícita de Raúl: "carece de sentido"). Ver
// claude/fase26-retirada-portal-transportista.md. Cualquier cuenta antigua de
// ese tipo se sigue viendo (con su etiqueta) en la lista de Maestros →
// Usuarios (ver UsersPage.tsx) -- solo deja de poderse crear una nueva aquí.
const userTypeLabel: Record<string, string> = {
  internal: "Interno (backoffice)",
  driver_app: "App Conductor",
  customer_portal: "Portal Cliente",
};

export default function NewUserModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [userType, setUserType] = useState<"internal" | "driver_app" | "customer_portal">("internal");
  const [carrierId, setCarrierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [driverId, setDriverId] = useState("");
  // Fase 23: "usuarios app" -- un usuario interno tiene exactamente UN rol
  // (Administrador o Planificador), ya no varios a la vez -- ver comentario
  // en users.routes.ts. `roleId` sustituye al antiguo array `roleIds`
  // (checkbox múltiple); se sigue mandando como array de 1 elemento al
  // backend para no tocar la forma del payload.
  const [roleId, setRoleId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open && userType === "driver_app",
  });

  const customersQuery = useQuery({
    queryKey: ["customers-all"],
    queryFn: async () => (await api.get("/customers", { params: { pageSize: 100 } })).data as { items: CustomerOption[] },
    enabled: open && userType === "customer_portal",
  });

  const driversQuery = useQuery({
    queryKey: ["drivers", carrierId],
    queryFn: async () => (await api.get("/vehicles/drivers", { params: carrierId ? { carrierId } : {} })).data as { items: DriverOption[] },
    enabled: open && userType === "driver_app" && !!carrierId,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/users/roles")).data as { items: RoleOption[] },
    enabled: open && userType === "internal",
  });

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
    enabled: open && userType === "internal",
  });

  const selectedRole = rolesQuery.data?.items.find((r) => r.id === roleId);
  // Fase 23: Planificador siempre atado a un centro; Administrador puede
  // quedar "sin centro" = todos (ver warehouse-scope.ts) -- por eso el
  // desplegable de centro solo es obligatorio para Planificador.
  const warehouseRequired = selectedRole?.code === "planificador";

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/users", {
          email,
          fullName,
          password,
          userType,
          carrierId: userType === "driver_app" ? carrierId : undefined,
          customerId: userType === "customer_portal" ? customerId : undefined,
          driverId: userType === "driver_app" ? driverId : undefined,
          roleIds: userType === "internal" ? [roleId] : undefined,
          warehouseId: userType === "internal" && warehouseId ? warehouseId : undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      onSuccess("Usuario creado correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear el usuario"),
  });

  function resetAndClose() {
    setEmail("");
    setFullName("");
    setPassword("");
    setUserType("internal");
    setCarrierId("");
    setCustomerId("");
    setDriverId("");
    setRoleId("");
    setWarehouseId("");
    onClose();
  }

  const canSubmit =
    email.trim() &&
    fullName.trim() &&
    password.length >= 8 &&
    (userType !== "customer_portal" || customerId) &&
    (userType !== "driver_app" || (carrierId && driverId)) &&
    (userType !== "internal" || (roleId && (!warehouseRequired || warehouseId)));

  return (
    <Modal open={open} title="Nuevo usuario" onClose={resetAndClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Tipo de acceso" required>
          <select
            className={inputCls}
            value={userType}
            onChange={(e) => {
              setUserType(e.target.value as any);
              setCarrierId("");
              setCustomerId("");
              setDriverId("");
            }}
          >
            {Object.entries(userTypeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Nombre completo" required>
            <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
          <Field label="Email" required>
            <input type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>

        <Field label="Contraseña" required hint="Mínimo 8 caracteres. Compártela con la persona por un canal seguro.">
          <input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </Field>

        {userType === "driver_app" && (
          <Field label="Transportista" required>
            <select className={inputCls} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {carriersQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.legalName}
                </option>
              ))}
            </select>
          </Field>
        )}

        {userType === "driver_app" && (
          <Field label="Conductor" required hint={!carrierId ? "Selecciona primero un transportista" : "El conductor debe existir en Maestros → Flota y Transportistas → Conductores"}>
            <select className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)} disabled={!carrierId} required>
              <option value="">Selecciona…</option>
              {driversQuery.data?.items.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </select>
          </Field>
        )}

        {userType === "customer_portal" && (
          <Field label="Cliente" required>
            <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {customersQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessCode} — {c.legalName}
                </option>
              ))}
            </select>
          </Field>
        )}

        {userType === "internal" && (
          <>
            {/* Fase 23: "usuarios app" -- exactamente 2 roles posibles, uno
                por cuenta (antes checkboxes múltiples). Se pueden crear
                varios usuarios (perfiles) distintos para la misma persona
                si necesita más de un rol/centro, en vez de una cuenta con
                varios roles a la vez. */}
            <Field label="Rol" required>
              <div className="space-y-1 border border-slate-200 rounded-lg p-2">
                {rolesQuery.data?.items.map((r) => (
                  <label key={r.id} className="flex items-center gap-2 text-sm px-1 py-1">
                    <input
                      type="radio"
                      name="roleId"
                      checked={roleId === r.id}
                      onChange={() => setRoleId(r.id)}
                      className="border-slate-300"
                    />
                    {r.name}
                  </label>
                ))}
              </div>
            </Field>

            <Field
              label="Centro"
              required={warehouseRequired}
              hint={
                selectedRole?.code === "admin_empresa"
                  ? "Déjalo sin seleccionar para un Administrador general con acceso a todos los centros."
                  : "El Planificador solo puede crear/editar datos de su propio centro."
              }
            >
              <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                <option value="">{selectedRole?.code === "admin_empresa" ? "Todos los centros" : "Selecciona…"}</option>
                {warehousesQuery.data?.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={resetAndClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Creando…" : "Crear usuario"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
