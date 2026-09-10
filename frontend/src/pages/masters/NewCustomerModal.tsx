import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: antes solo se podían dar de alta clientes importando un Excel
// (ImportCustomersModal) -- el backend ya tenía alta/edición/baja manual
// (customers.routes.ts: POST/PUT/DELETE) desde hace tiempo, pero no había
// ningún formulario que los usara. Este modal sirve para las dos cosas --
// alta y edición -- según se le pase o no `customer`, siguiendo el mismo
// patrón que NewWarehouseModal.

export interface CustomerEditable {
  id: string;
  businessCode: string;
  legalName: string;
  commercialName: string | null;
  taxId: string | null;
  active: boolean;
}

interface Props {
  open: boolean;
  customer?: CustomerEditable | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewCustomerModal({ open, customer, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!customer;
  const [businessCode, setBusinessCode] = useState("");
  const [legalName, setLegalName] = useState("");
  const [commercialName, setCommercialName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [active, setActive] = useState(true);

  // Rellena el formulario cuando se abre para editar un cliente concreto, y
  // lo limpia cuando se abre para dar uno de alta -- sin esto, reabrir el
  // modal para un cliente distinto seguiría mostrando los datos del anterior.
  useEffect(() => {
    if (!open) return;
    setBusinessCode(customer?.businessCode ?? "");
    setLegalName(customer?.legalName ?? "");
    setCommercialName(customer?.commercialName ?? "");
    setTaxId(customer?.taxId ?? "");
    setActive(customer?.active ?? true);
  }, [open, customer]);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        businessCode: businessCode.trim(),
        legalName: legalName.trim(),
        commercialName: commercialName.trim() || undefined,
        taxId: taxId.trim() || undefined,
        active,
      };
      if (isEdit) return (await api.put(`/customers/${customer!.id}`, payload)).data;
      return (await api.post("/customers", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      onSuccess(isEdit ? "Cliente actualizado correctamente" : "Cliente creado correctamente");
      onClose();
    },
    onError: (err: any) =>
      onError(err?.response?.data?.message ?? (isEdit ? "Error al actualizar el cliente" : "Error al crear el cliente")),
  });

  const canSubmit = businessCode.trim().length > 0 && legalName.trim().length > 0;

  return (
    <Modal open={open} title={isEdit ? `Editar cliente — ${customer!.businessCode}` : "Nuevo cliente"} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código de cliente" required hint={isEdit ? "Úsalo con cuidado: es el que enlaza con el ERP" : undefined}>
            <input className={inputCls} value={businessCode} onChange={(e) => setBusinessCode(e.target.value)} required maxLength={10} />
          </Field>
          <Field label="NIF / CIF">
            <input className={inputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </Field>
        </div>
        <Field label="Razón social" required>
          <input className={inputCls} value={legalName} onChange={(e) => setLegalName(e.target.value)} required />
        </Field>
        <Field label="Nombre comercial">
          <input className={inputCls} value={commercialName} onChange={(e) => setCommercialName(e.target.value)} />
        </Field>
        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="rounded border-slate-300" />
            Cliente activo
          </label>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear cliente"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
