import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 8: alta de una fila de la nueva tabla "Transportistas" -- un circuito
// de reparto (p.ej. "MAD1") servido por un transportista, con su tarifa. El
// transportista debe existir ya (se da de alta con el botón separado "+
// Nuevo transportista", que sigue igual); el circuito, en cambio, se puede
// escribir aquí mismo si es nuevo -- así no hace falta ir a otro sitio a
// crear un circuito antes de poder asignarle un transportista.

interface DeliveryZoneOption {
  id: string;
  name: string;
}

interface CarrierOption {
  id: string;
  legalName: string;
}

interface Props {
  open: boolean;
  zones: DeliveryZoneOption[];
  carriers: CarrierOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewZoneAssignmentModal({ open, zones, carriers, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [zoneMode, setZoneMode] = useState<"existing" | "new">("existing");
  const [zoneId, setZoneId] = useState("");
  const [newZoneName, setNewZoneName] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [flatFee, setFlatFee] = useState("");
  const [pricePerTon, setPricePerTon] = useState("");
  const [unloadFee, setUnloadFee] = useState("");
  const [partnerIncomePerTon, setPartnerIncomePerTon] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setZoneMode(zones.length > 0 ? "existing" : "new");
    setZoneId(zones[0]?.id ?? "");
    setNewZoneName("");
    setCarrierId(carriers[0]?.id ?? "");
    setValidFrom(new Date().toISOString().slice(0, 10));
    setFlatFee("");
    setPricePerTon("");
    setUnloadFee("");
    setPartnerIncomePerTon("");
    setScheduleNote("");
  }, [open, zones, carriers]);

  const mutation = useMutation({
    mutationFn: async () => {
      let targetZoneId = zoneId;
      if (zoneMode === "new") {
        const created = (await api.post("/delivery-zones", { name: newZoneName.trim() })).data as { id: string };
        targetZoneId = created.id;
      }
      const payload = {
        carrierId,
        validFrom,
        flatFee: flatFee === "" ? null : Number(flatFee),
        pricePerTon: pricePerTon === "" ? null : Number(pricePerTon),
        unloadFee: unloadFee === "" ? null : Number(unloadFee),
        partnerIncomePerTon: partnerIncomePerTon === "" ? null : Number(partnerIncomePerTon),
        scheduleNote: scheduleNote.trim() || undefined,
      };
      return (await api.post(`/delivery-zones/${targetZoneId}/rates`, payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zones"] });
      onSuccess("Asignación creada correctamente");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo crear la asignación"),
  });

  const canSubmit =
    !!carrierId && (zoneMode === "existing" ? !!zoneId : newZoneName.trim().length > 0) && !mutation.isPending;

  return (
    <Modal open={open} title="Nueva asignación circuito ↔ transportista" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Circuito" required>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setZoneMode("existing")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${zoneMode === "existing" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
              disabled={zones.length === 0}
            >
              Ya existente
            </button>
            <button
              type="button"
              onClick={() => setZoneMode("new")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${zoneMode === "new" ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Nuevo circuito
            </button>
          </div>
          {zoneMode === "existing" ? (
            <select className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={inputCls}
              placeholder="p. ej. MAD1, EXTREMADURA 1…"
              value={newZoneName}
              onChange={(e) => setNewZoneName(e.target.value)}
            />
          )}
        </Field>

        <Field label="Transportista" required hint={carriers.length === 0 ? "Da de alta primero un transportista con «+ Nuevo transportista»" : undefined}>
          <select className={inputCls} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} disabled={carriers.length === 0}>
            {carriers.map((c) => (
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
          <Field label="Cuaderno de servicio">
            <input className={inputCls} placeholder="p. ej. Martes y Jueves" value={scheduleNote} onChange={(e) => setScheduleNote(e.target.value)} />
          </Field>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <Field label="Tarifa plana €">
            <input type="number" min="0" step="0.01" className={inputCls} value={flatFee} onChange={(e) => setFlatFee(e.target.value)} />
          </Field>
          <Field label="€/Tn">
            <input type="number" min="0" step="0.01" className={inputCls} value={pricePerTon} onChange={(e) => setPricePerTon(e.target.value)} />
          </Field>
          <Field label="Descarga €">
            <input type="number" min="0" step="0.01" className={inputCls} value={unloadFee} onChange={(e) => setUnloadFee(e.target.value)} />
          </Field>
          <Field label="Ingreso €/tn socios">
            <input type="number" min="0" step="0.01" className={inputCls} value={partnerIncomePerTon} onChange={(e) => setPartnerIncomePerTon(e.target.value)} />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Guardando…" : "Crear asignación"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
