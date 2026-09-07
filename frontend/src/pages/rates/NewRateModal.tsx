import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

interface Props {
  open: boolean;
  serviceType: "full_truck" | "pallet";
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

export default function NewRateModal({ open, serviceType, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();

  const [carrierId, setCarrierId] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");

  // Camión completo
  const [includedKm, setIncludedKm] = useState("100");
  const [extraStopFee, setExtraStopFee] = useState("25");
  const [extraKmFee, setExtraKmFee] = useState("1");

  // Paletería
  const [fixedFeePerNote, setFixedFeePerNote] = useState("15");
  const [looseItemFee, setLooseItemFee] = useState("3");
  const [maxWeightPerPalletKg, setMaxWeightPerPalletKg] = useState("800");

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const base = { carrierId, validFrom, validTo: validTo || null };
      if (serviceType === "full_truck") {
        return (
          await api.post("/rates/full-truck", {
            ...base,
            includedKm: Number(includedKm),
            extraStopFee: Number(extraStopFee),
            extraKmFee: Number(extraKmFee),
          })
        ).data;
      }
      return (
        await api.post("/rates/pallet", {
          ...base,
          fixedFeePerNote: Number(fixedFeePerNote),
          looseItemFee: Number(looseItemFee),
          maxWeightPerPalletKg: Number(maxWeightPerPalletKg),
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rates-full-truck"] });
      queryClient.invalidateQueries({ queryKey: ["rates-pallet"] });
      onSuccess("Tarifa creada correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear la tarifa"),
  });

  function resetAndClose() {
    setCarrierId("");
    setValidFrom("");
    setValidTo("");
    onClose();
  }

  const canSubmit = carrierId && validFrom;

  return (
    <Modal
      open={open}
      title={serviceType === "full_truck" ? "Nueva tarifa — Camión completo" : "Nueva tarifa — Paletería"}
      onClose={resetAndClose}
    >
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
          <Field label="Vigente desde" required>
            <input type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} required />
          </Field>
          <Field label="Vigente hasta" hint="Vacío = vigente indefinidamente">
            <input type="date" className={inputCls} value={validTo} onChange={(e) => setValidTo(e.target.value)} />
          </Field>
        </div>

        {serviceType === "full_truck" ? (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Km incluidos" required>
              <input type="number" min="0" className={inputCls} value={includedKm} onChange={(e) => setIncludedKm(e.target.value)} required />
            </Field>
            <Field label="Parada adicional (€)" required>
              <input type="number" min="0" step="0.01" className={inputCls} value={extraStopFee} onChange={(e) => setExtraStopFee(e.target.value)} required />
            </Field>
            <Field label="€/km extra" required>
              <input type="number" min="0" step="0.01" className={inputCls} value={extraKmFee} onChange={(e) => setExtraKmFee(e.target.value)} required />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            <Field label="Fijo por albarán (€)" required>
              <input type="number" min="0" step="0.01" className={inputCls} value={fixedFeePerNote} onChange={(e) => setFixedFeePerNote(e.target.value)} required />
            </Field>
            <Field label="Bulto suelto (€)" required>
              <input type="number" min="0" step="0.01" className={inputCls} value={looseItemFee} onChange={(e) => setLooseItemFee(e.target.value)} required />
            </Field>
            <Field label="Peso máx/palé (kg)" required>
              <input type="number" min="0" className={inputCls} value={maxWeightPerPalletKg} onChange={(e) => setMaxWeightPerPalletKg(e.target.value)} required />
            </Field>
          </div>
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
            {mutation.isPending ? "Guardando…" : "Crear tarifa"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
