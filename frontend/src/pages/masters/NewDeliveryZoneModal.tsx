import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 18: petición explícita de Raúl -- "tiene que poder crearse la ruta, y
// en ella introducir las empresas que colaboren en esa ruta". Antes un
// circuito solo se podía dar de alta "de paso" dentro del modal de
// asignación (NewZoneAssignmentModal, toggle "Nuevo circuito"); ahora que ese
// modal queda dedicado por completo a añadir un transportista DENTRO de un
// circuito ya elegido (ver TransportistasTab.tsx), crear el circuito en sí
// necesita su propio punto de entrada -- este modal, con el botón "+ Nuevo
// circuito" al nivel superior de la pantalla.
//
// Mismo modal sirve para editar (nombre/almacén) un circuito ya existente --
// se le pasa `zone`, igual que el resto de modales de alta/edición
// (NewCarrierModal, NewCustomerModal, NewWarehouseModal).

export interface DeliveryZoneEditable {
  id: string;
  name: string;
  warehouse: { id: string; name: string } | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  zone?: DeliveryZoneEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewDeliveryZoneModal({ open, zone, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!zone;
  const [name, setName] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    setName(zone?.name ?? "");
    setWarehouseId(zone?.warehouse?.id ?? "");
  }, [open, zone]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim(), warehouseId: warehouseId || null };
      if (isEdit) return (await api.patch(`/delivery-zones/${zone!.id}`, payload)).data;
      return (await api.post("/delivery-zones", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zones"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      onSuccess(isEdit ? "Circuito actualizado correctamente" : "Circuito creado. Ya puedes añadirle transportistas.");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo guardar el circuito"),
  });

  const canSubmit = name.trim().length > 0 && !mutation.isPending;

  return (
    <Modal open={open} title={isEdit ? `Editar circuito — ${zone!.name}` : "Nuevo circuito"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Nombre del circuito" required hint="p. ej. MAD1, ASTURIAS, EXTREMADURA 1…">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Almacén" hint="Opcional -- puedes asignárselo más tarde.">
          <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="">Sin almacén asignado</option>
            {warehousesQuery.data?.items.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear circuito"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
