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

interface VehicleOption {
  id: string;
  plate: string;
  vehicleType: { name: string };
}

interface VehicleTypeOption {
  id: string;
  name: string;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Fase 8j: petición explícita de Raúl -- "en la pestaña conductores es donde
// debe añadirse cada uno, con los datos personales, de agencia y de vehiculo
// que pertenece". Antes el vehículo solo se podía asignar después, desde la
// pestaña "Vehículos" (retirada del menú a petición suya). Ahora se puede
// elegir aquí mismo, en el mismo paso: reutilizar una matrícula ya dada de
// alta para ese transportista, o dar de alta una matrícula nueva sin salir
// del formulario. Sigue siendo opcional -- un conductor se puede crear sin
// vehículo y asignárselo más tarde desde su propia fila en "Conductores".
type VehicleMode = "none" | "existing" | "new";

function pillCls(active: boolean) {
  return `px-2.5 py-1 rounded-lg text-xs font-medium border ${
    active ? "bg-brand-600 border-brand-600 text-white" : "bg-white border-slate-300 text-slate-600"
  }`;
}

export default function NewDriverModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [carrierId, setCarrierId] = useState("");
  const [fullName, setFullName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");

  const [vehicleMode, setVehicleMode] = useState<VehicleMode>("none");
  const [existingVehicleId, setExistingVehicleId] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const [newVehicleTypeId, setNewVehicleTypeId] = useState("");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open,
  });

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "by-carrier", carrierId],
    queryFn: async () => (await api.get("/vehicles", { params: { carrierId } })).data as { items: VehicleOption[] },
    enabled: open && vehicleMode === "existing" && !!carrierId,
  });

  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeOption[] },
    enabled: open && vehicleMode === "new",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const driver = (await api.post("/vehicles/drivers", { carrierId, fullName, taxId, phone: phone || undefined }))
        .data as { id: string };

      let vehicleId = "";
      if (vehicleMode === "existing" && existingVehicleId) {
        vehicleId = existingVehicleId;
      } else if (vehicleMode === "new" && newPlate.trim() && newVehicleTypeId) {
        const created = (
          await api.post("/vehicles", { carrierId, vehicleTypeId: newVehicleTypeId, plate: newPlate.trim() })
        ).data as { id: string };
        vehicleId = created.id;
      }
      if (vehicleId) {
        await api.post(`/vehicles/${vehicleId}/assign-driver`, { driverId: driver.id });
      }
      return driver;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      onSuccess("Conductor creado correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear el conductor"),
  });

  function resetAndClose() {
    setCarrierId("");
    setFullName("");
    setTaxId("");
    setPhone("");
    setVehicleMode("none");
    setExistingVehicleId("");
    setNewPlate("");
    setNewVehicleTypeId("");
    onClose();
  }

  const canSubmit =
    !!carrierId &&
    !!fullName.trim() &&
    !!taxId.trim() &&
    (vehicleMode !== "existing" || !!existingVehicleId) &&
    (vehicleMode !== "new" || (!!newPlate.trim() && !!newVehicleTypeId));

  return (
    <Modal open={open} title="Nuevo conductor" onClose={resetAndClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Transportista" required>
          <select
            className={inputCls}
            value={carrierId}
            onChange={(e) => {
              setCarrierId(e.target.value);
              setVehicleMode("none");
              setExistingVehicleId("");
            }}
            required
          >
            <option value="">Selecciona…</option>
            {carriersQuery.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nombre completo" required>
          <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} required />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="NIF" required>
            <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} required />
          </Field>
          <Field label="Teléfono">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>

        <Field label="Vehículo">
          <div className="flex gap-2 mb-2">
            <button type="button" onClick={() => setVehicleMode("none")} className={pillCls(vehicleMode === "none")}>
              Sin asignar
            </button>
            <button
              type="button"
              onClick={() => setVehicleMode("existing")}
              disabled={!carrierId}
              className={`${pillCls(vehicleMode === "existing")} disabled:opacity-40`}
            >
              Vehículo existente
            </button>
            <button
              type="button"
              onClick={() => setVehicleMode("new")}
              disabled={!carrierId}
              className={`${pillCls(vehicleMode === "new")} disabled:opacity-40`}
            >
              Matrícula nueva
            </button>
          </div>

          {vehicleMode === "existing" && (
            <>
              <select className={inputCls} value={existingVehicleId} onChange={(e) => setExistingVehicleId(e.target.value)}>
                <option value="">Selecciona…</option>
                {vehiclesQuery.data?.items.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.plate} — {v.vehicleType.name}
                  </option>
                ))}
              </select>
              {!vehiclesQuery.isLoading && vehiclesQuery.data?.items.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">
                  Este transportista todavía no tiene ninguna matrícula dada de alta -- usa "Matrícula nueva".
                </p>
              )}
            </>
          )}

          {vehicleMode === "new" && (
            <div className="grid grid-cols-2 gap-2">
              <input
                className={inputCls}
                placeholder="Matrícula"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
              />
              <select className={inputCls} value={newVehicleTypeId} onChange={(e) => setNewVehicleTypeId(e.target.value)}>
                <option value="">Tipo de vehículo…</option>
                {vehicleTypesQuery.data?.items.map((vt) => (
                  <option key={vt.id} value={vt.id}>
                    {vt.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={resetAndClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : "Crear conductor"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
