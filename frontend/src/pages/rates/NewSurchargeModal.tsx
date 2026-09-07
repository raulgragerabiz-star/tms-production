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

const surchargeTypeLabel: Record<string, string> = {
  fuel: "Combustible",
  adr: "ADR (mercancías peligrosas)",
  holiday: "Festivo",
  toll: "Peaje",
  waiting_time: "Tiempo de espera",
  zone: "Zona",
};

const calculationModeLabel: Record<string, string> = {
  fixed: "Importe fijo",
  percentage: "% sobre la tarifa base",
  per_km: "€ por km",
  per_hour: "€ por hora",
};

export default function NewSurchargeModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [carrierId, setCarrierId] = useState("");
  const [surchargeType, setSurchargeType] = useState("fuel");
  const [calculationMode, setCalculationMode] = useState("percentage");
  const [value, setValue] = useState("5");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/rates/surcharges", {
          carrierId,
          surchargeType,
          calculationMode,
          value: Number(value),
          validFrom,
          validTo: validTo || null,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rate-surcharges"] });
      onSuccess("Suplemento creado correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear el suplemento"),
  });

  function resetAndClose() {
    setCarrierId("");
    setValidFrom("");
    setValidTo("");
    onClose();
  }

  const canSubmit = carrierId && validFrom && value !== "";

  return (
    <Modal open={open} title="Nuevo suplemento" onClose={resetAndClose}>
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

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tipo de suplemento" required>
            <select className={inputCls} value={surchargeType} onChange={(e) => setSurchargeType(e.target.value)}>
              {Object.entries(surchargeTypeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Modo de cálculo" required>
            <select className={inputCls} value={calculationMode} onChange={(e) => setCalculationMode(e.target.value)}>
              {Object.entries(calculationModeLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field
          label="Valor"
          required
          hint={
            calculationMode === "percentage"
              ? "Porcentaje sobre la tarifa base ya resuelta (ej. 5 = 5%)"
              : calculationMode === "fixed"
                ? "Importe fijo en €. Para peajes, se sustituye por el importe real del viaje si se informa."
                : calculationMode === "per_km"
                  ? "€ por cada km del viaje"
                  : "€ por cada hora de espera"
          }
        >
          <input type="number" step="0.01" className={inputCls} value={value} onChange={(e) => setValue(e.target.value)} required />
        </Field>

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
            {mutation.isPending ? "Guardando…" : "Crear suplemento"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
