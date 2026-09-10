import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: la ficha "Empresa" de Flota y Transportistas no tenía ni alta ni
// edición -- el backend (carriers.routes.ts) ya soportaba POST/PUT desde
// antes. Mismo patrón que NewCustomerModal/NewWarehouseModal: un único modal
// para alta y edición, según se le pase o no `carrier`.

export interface CarrierEditable {
  id: string;
  legalName: string;
  taxId: string;
  city: string | null;
  province: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
}

interface Props {
  open: boolean;
  carrier?: CarrierEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

const serviceTypeLabel: Record<string, string> = {
  full_truck: "Camión completo",
  pallet: "Paletería",
  both: "Ambos",
};

const temperatureLabel: Record<string, string> = {
  ambient: "Ambiente",
  refrigerated: "Refrigerado",
  frozen: "Congelado",
  mixed: "Mixto",
};

export default function NewCarrierModal({ open, carrier, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!carrier;
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [serviceType, setServiceType] = useState("both");
  const [ownsFleet, setOwnsFleet] = useState(false);
  const [temperatureCapability, setTemperatureCapability] = useState("ambient");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setLegalName(carrier?.legalName ?? "");
    setTaxId(carrier?.taxId ?? "");
    setCity(carrier?.city ?? "");
    setProvince(carrier?.province ?? "");
    setServiceType(carrier?.serviceType ?? "both");
    setOwnsFleet(carrier?.ownsFleet ?? false);
    setTemperatureCapability(carrier?.temperatureCapability ?? "ambient");
    setNotes(carrier?.notes ?? "");
  }, [open, carrier]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        legalName: legalName.trim(),
        taxId: taxId.trim(),
        city: city.trim() || undefined,
        province: province.trim() || undefined,
        serviceType,
        ownsFleet,
        temperatureCapability,
        notes: notes.trim() || undefined,
      };
      if (isEdit) return (await api.put(`/carriers/${carrier!.id}`, payload)).data;
      return (await api.post("/carriers", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      onSuccess(isEdit ? "Transportista actualizado correctamente" : "Transportista creado correctamente");
      onClose();
    },
    onError: (err: any) =>
      onError(err?.response?.data?.message ?? (isEdit ? "Error al actualizar el transportista" : "Error al crear el transportista")),
  });

  const canSubmit = legalName.trim().length > 0 && taxId.trim().length > 0;

  return (
    <Modal open={open} title={isEdit ? `Editar transportista — ${carrier!.legalName}` : "Nuevo transportista"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Razón social" required>
            <input className={inputCls} value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
          </Field>
          <Field label="NIF / CIF" required>
            <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Ciudad">
            <input className={inputCls} value={city} onChange={(e) => setCity(e.target.value)} />
          </Field>
          <Field label="Provincia">
            <input className={inputCls} value={province} onChange={(e) => setProvince(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de servicio">
            <select className={inputCls} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
              {Object.entries(serviceTypeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Capacidad de temperatura">
            <select className={inputCls} value={temperatureCapability} onChange={(e) => setTemperatureCapability(e.target.value)}>
              {Object.entries(temperatureLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={ownsFleet} onChange={(e) => setOwnsFleet(e.target.checked)} className="rounded border-slate-300" />
          Tiene flota propia
        </label>
        <Field label="Notas">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear transportista"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
