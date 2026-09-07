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

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewDriverModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [carrierId, setCarrierId] = useState("");
  const [fullName, setFullName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => (await api.post("/vehicles/drivers", { carrierId, fullName, taxId, phone: phone || undefined })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
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
    onClose();
  }

  const canSubmit = carrierId && fullName.trim() && taxId.trim();

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
          <select className={inputCls} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} required>
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
