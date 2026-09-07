import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

interface Props {
  open: boolean;
  kind: "customer" | "zone";
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

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Los 4 segmentos reales de ServiceType (columna `service_type` de customer_rate /
// zone_rate) — antes solo "Paletería"/"Camión completo", 2 valores heredados que ya
// no existen en el enum y hacían fallar cualquier alta de tarifa por cliente o zona.
const serviceTypeOptions = [
  { value: "paqueteria", label: "Paquetería" },
  { value: "paleteria", label: "Paletería" },
  { value: "paleteria_pesada", label: "Paletería pesada" },
  { value: "gran_volumen", label: "Gran volumen / Camión completo" },
] as const;

// Tarifas de mayor prioridad que la tarifa general del transportista (Fase 9: by_customer
// gana siempre sobre by_zone, y ambas sobre la tarifa base). Un único componente cubre
// ambos casos porque comparten forma (importe fijo + vigencia + servicio), solo cambia
// la clave de negocio (cliente concreto vs. nombre de zona/provincia).
export default function NewPriorityRateModal({ open, kind, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [carrierId, setCarrierId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [zoneName, setZoneName] = useState("");
  const [serviceType, setServiceType] = useState<
    "paqueteria" | "paleteria" | "paleteria_pesada" | "gran_volumen"
  >("paleteria");
  const [fixedAmount, setFixedAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open,
  });

  const customersQuery = useQuery({
    queryKey: ["customers-all"],
    queryFn: async () => (await api.get("/customers", { params: { pageSize: 100 } })).data as { items: CustomerOption[] },
    enabled: open && kind === "customer",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const base = { carrierId, serviceType, validFrom, validTo: validTo || null, fixedAmount: Number(fixedAmount) };
      if (kind === "customer") {
        return (await api.post("/rates/customer", { ...base, customerId })).data;
      }
      return (await api.post("/rates/zone", { ...base, zoneName })).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rates-customer"] });
      queryClient.invalidateQueries({ queryKey: ["rates-zone"] });
      onSuccess(kind === "customer" ? "Tarifa por cliente creada correctamente" : "Tarifa por zona creada correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear la tarifa"),
  });

  function resetAndClose() {
    setCarrierId("");
    setCustomerId("");
    setZoneName("");
    setFixedAmount("");
    setValidFrom("");
    setValidTo("");
    setServiceType("paleteria");
    onClose();
  }

  const canSubmit = carrierId && validFrom && fixedAmount !== "" && (kind === "customer" ? !!customerId : zoneName.trim().length > 0);

  return (
    <Modal open={open} title={kind === "customer" ? "Nueva tarifa por cliente" : "Nueva tarifa por zona"} onClose={resetAndClose}>
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

        {kind === "customer" ? (
          <Field label="Cliente" required hint="Esta tarifa gana siempre sobre la tarifa general y la de zona">
            <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {customersQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessCode} — {c.legalName}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label="Zona / Provincia" required hint="Debe coincidir exactamente con la provincia del punto de entrega, ej. 'Madrid'">
            <input className={inputCls} value={zoneName} onChange={(e) => setZoneName(e.target.value)} required />
          </Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de servicio" required>
            <select className={inputCls} value={serviceType} onChange={(e) => setServiceType(e.target.value as any)}>
              {serviceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Importe fijo (€)" required>
            <input type="number" min="0" step="0.01" className={inputCls} value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} required />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Vigente desde" required>
            <input type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
          </Field>
          <Field label="Vigente hasta" hint="Vacío = vigente indefinidamente">
            <input type="date" className={inputCls} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
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
            {mutation.isPending ? "Guardando…" : "Crear tarifa"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
