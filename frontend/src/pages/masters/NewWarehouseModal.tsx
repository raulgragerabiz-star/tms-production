import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: este modal servía solo para dar de alta -- se extiende para
// editar también, pasándole `warehouse` (el backend ya tenía PUT /:id desde
// antes). Sin ese prop se comporta exactamente igual que hasta ahora.
export interface WarehouseEditable {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  externalCode: string | null;
}

interface Props {
  open: boolean;
  warehouse?: WarehouseEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewWarehouseModal({ open, warehouse, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!warehouse;
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [externalCode, setExternalCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(warehouse?.name ?? "");
    setAddress(warehouse?.address ?? "");
    setCity(warehouse?.city ?? "");
    setProvince(warehouse?.province ?? "");
    setPostalCode(warehouse?.postalCode ?? "");
    setLat(warehouse?.lat != null ? String(warehouse.lat) : "");
    setLng(warehouse?.lng != null ? String(warehouse.lng) : "");
    setExternalCode(warehouse?.externalCode ?? "");
  }, [open, warehouse]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name,
        address: address || undefined,
        city: city || undefined,
        province: province || undefined,
        postalCode: postalCode || undefined,
        lat: lat ? Number(lat) : undefined,
        lng: lng ? Number(lng) : undefined,
        externalCode: externalCode || undefined,
      };
      if (isEdit) return (await api.put(`/warehouses/${warehouse!.id}`, payload)).data;
      return (await api.post("/warehouses", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      onSuccess(isEdit ? "Almacén actualizado correctamente" : "Almacén creado correctamente");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? (isEdit ? "Error al actualizar el almacén" : "Error al crear el almacén")),
  });

  const canSubmit = name.trim().length > 0;

  return (
    <Modal open={open} title={isEdit ? `Editar almacén — ${warehouse!.name}` : "Nuevo almacén"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Nombre" required>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Dirección">
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Ciudad">
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Provincia">
            <input className={inputCls} value={province} onChange={(e) => setProvince(e.target.value)} />
          </Field>
          <Field label="CP">
            <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Latitud" hint="Para mostrarlo en el mapa del Planificador">
            <input type="number" step="any" className={inputCls} value={lat} onChange={(e) => setLat(e.target.value)} />
          </Field>
          <Field label="Longitud">
            <input type="number" step="any" className={inputCls} value={lng} onChange={(e) => setLng(e.target.value)} />
          </Field>
        </div>
        <Field
          label="Código externo"
          hint="Opcional — identificador para enlazar este almacén con otro sistema (p. ej. un proyecto de layout de almacén)"
        >
          <input className={inputCls} value={externalCode} onChange={(e) => setExternalCode(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear almacén"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
