import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewWarehouseModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [externalCode, setExternalCode] = useState("");

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/warehouses", {
          name,
          address: address || undefined,
          city: city || undefined,
          province: province || undefined,
          postalCode: postalCode || undefined,
          lat: lat ? Number(lat) : undefined,
          lng: lng ? Number(lng) : undefined,
          externalCode: externalCode || undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["warehouses"] });
      onSuccess("Almacén creado correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear el almacén"),
  });

  function resetAndClose() {
    setName("");
    setAddress("");
    setCity("");
    setProvince("");
    setPostalCode("");
    setLat("");
    setLng("");
    setExternalCode("");
    onClose();
  }

  const canSubmit = name.trim().length > 0;

  return (
    <Modal open={open} title="Nuevo almacén" onClose={resetAndClose}>
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
          <button type="button" onClick={resetAndClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : "Crear almacén"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
