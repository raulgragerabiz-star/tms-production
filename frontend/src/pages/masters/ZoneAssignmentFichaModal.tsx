import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Chip from "@/components/Chip";

// Fase 8T: "ficha" de una asignación circuito↔transportista -- sustituye a
// los checkboxes + 4 campos compartidos que había antes en la propia fila de
// la tabla (ver TransportistasTab.tsx). Aquí dentro se elige qué tipos de
// vehículo aporta el transportista PARA ESTE CIRCUITO CONCRETO y se fija una
// tarifa independiente para cada uno -- exactamente lo que pidió Raúl:
// "seleccionar que tipo de vehiculos tiene y en cada vehiculo incorporar la
// tarifa correspondiente, para que al hacer el enrutado, aplique la tarifa
// segun el vehiculo que se seleccione". El motor real que aplica esta
// tarifa está en rate-resolution.service.ts (nivel "by_delivery_zone_vehicle").

export interface VehicleTypeOption {
  id: string;
  name: string;
}

export interface VehicleRateRow {
  id: string;
  vehicleTypeId: string;
  flatFee: string | null;
  pricePerTon: string | null;
  unloadFee: string | null;
  partnerIncomePerTon: string | null;
  vehicleType: { id: string; name: string };
}

export interface AssignmentForFicha {
  id: string;
  validFrom: string;
  validTo: string | null;
  scheduleNote: string | null;
  deliveryZone: { id: string; name: string };
  carrier: { id: string; legalName: string; active: boolean };
  vehicleRates: VehicleRateRow[];
}

interface Props {
  open: boolean;
  assignment: AssignmentForFicha | null;
  vehicleTypes: VehicleTypeOption[];
  onClose: () => void;
  onError: (message: string) => void;
}

const numCellCls =
  "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500";

interface Draft {
  flatFee: string;
  pricePerTon: string;
  unloadFee: string;
  partnerIncomePerTon: string;
}

const emptyDraft: Draft = { flatFee: "", pricePerTon: "", unloadFee: "", partnerIncomePerTon: "" };

function draftFromRate(rate: VehicleRateRow | undefined): Draft {
  if (!rate) return { ...emptyDraft };
  return {
    flatFee: rate.flatFee ?? "",
    pricePerTon: rate.pricePerTon ?? "",
    unloadFee: rate.unloadFee ?? "",
    partnerIncomePerTon: rate.partnerIncomePerTon ?? "",
  };
}

export default function ZoneAssignmentFichaModal({ open, assignment, vehicleTypes, onClose, onError }: Props) {
  const queryClient = useQueryClient();
  // Borrador local por tipo de vehículo -- permite escribir en los 4 campos
  // sin disparar una petición por tecla; se guarda al salir del campo
  // (onBlur), igual que el resto de tarifas de esta pantalla.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  useEffect(() => {
    if (!assignment) return;
    const byType: Record<string, Draft> = {};
    for (const vt of vehicleTypes) {
      const existing = assignment.vehicleRates.find((r) => r.vehicleTypeId === vt.id);
      byType[vt.id] = draftFromRate(existing);
    }
    setDrafts(byType);
    // Solo se re-inicializa cuando se abre una ficha distinta (o cambian sus
    // datos tras refetch) -- no en cada tecla, por eso assignment.id/JSON de
    // vehicleRates como dependencia en vez de todo el objeto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, JSON.stringify(assignment?.vehicleRates ?? []), vehicleTypes]);

  const upsertMutation = useMutation({
    mutationFn: async ({ vehicleTypeId, draft }: { vehicleTypeId: string; draft: Draft }) => {
      if (!assignment) return;
      const payload = {
        flatFee: draft.flatFee === "" ? null : Number(draft.flatFee),
        pricePerTon: draft.pricePerTon === "" ? null : Number(draft.pricePerTon),
        unloadFee: draft.unloadFee === "" ? null : Number(draft.unloadFee),
        partnerIncomePerTon: draft.partnerIncomePerTon === "" ? null : Number(draft.partnerIncomePerTon),
      };
      return (await api.put(`/delivery-zones/rates/${assignment.id}/vehicle-types/${vehicleTypeId}`, payload)).data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] }),
    onError: (err: any) => {
      onError(err?.response?.data?.message ?? "No se pudo guardar la tarifa de ese tipo de vehículo");
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (vehicleTypeId: string) => {
      if (!assignment) return;
      await api.delete(`/delivery-zones/rates/${assignment.id}/vehicle-types/${vehicleTypeId}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] }),
    onError: () => onError("No se pudo desmarcar ese tipo de vehículo"),
  });

  if (!assignment) return null;

  const selectedTypeIds = new Set(assignment.vehicleRates.map((r) => r.vehicleTypeId));

  function handleToggle(vehicleTypeId: string, enabled: boolean) {
    if (enabled) {
      upsertMutation.mutate({ vehicleTypeId, draft: drafts[vehicleTypeId] ?? emptyDraft });
    } else {
      removeMutation.mutate(vehicleTypeId);
    }
  }

  function handleFieldBlur(vehicleTypeId: string) {
    if (!selectedTypeIds.has(vehicleTypeId)) return; // solo autoguarda si el tipo está marcado
    upsertMutation.mutate({ vehicleTypeId, draft: drafts[vehicleTypeId] ?? emptyDraft });
  }

  function updateDraftField(vehicleTypeId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [vehicleTypeId]: { ...(prev[vehicleTypeId] ?? emptyDraft), [field]: value } }));
  }

  return (
    <Modal open={open} title="Ficha de circuito · transportista" onClose={onClose} wide>
      <div className="mb-4 flex items-start justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {assignment.deliveryZone.name} · {assignment.carrier.legalName}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Vigente desde {new Date(assignment.validFrom).toLocaleDateString("es-ES")}
            {assignment.validTo ? ` hasta ${new Date(assignment.validTo).toLocaleDateString("es-ES")}` : ""}
            {assignment.scheduleNote ? ` · ${assignment.scheduleNote}` : ""}
          </p>
        </div>
        {!assignment.carrier.active && <Chip color="slate">Baja</Chip>}
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Marca los tipos de vehículo que este transportista aporta para este circuito y fija su tarifa. El motor de
        enrutado aplicará la tarifa del tipo de vehículo que finalmente se seleccione al asignar la ruta.
      </p>

      {vehicleTypes.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No hay tipos de vehículo configurados todavía.</p>
      ) : (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
              <tr>
                <th className="text-left px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Tipo de vehículo</th>
                <th className="text-right px-2 py-2">Tarifa plana €</th>
                <th className="text-right px-2 py-2">€/Tn</th>
                <th className="text-right px-2 py-2">Descarga €</th>
                <th className="text-right px-2 py-2">Ingreso €/tn socios</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicleTypes.map((vt) => {
                const enabled = selectedTypeIds.has(vt.id);
                const draft = drafts[vt.id] ?? emptyDraft;
                return (
                  <tr key={vt.id} className={enabled ? "" : "opacity-50"}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => handleToggle(vt.id, e.target.checked)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">{vt.name}</td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!enabled}
                        value={draft.flatFee}
                        onChange={(e) => updateDraftField(vt.id, "flatFee", e.target.value)}
                        onBlur={() => handleFieldBlur(vt.id)}
                        className={numCellCls}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!enabled}
                        value={draft.pricePerTon}
                        onChange={(e) => updateDraftField(vt.id, "pricePerTon", e.target.value)}
                        onBlur={() => handleFieldBlur(vt.id)}
                        className={numCellCls}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!enabled}
                        value={draft.unloadFee}
                        onChange={(e) => updateDraftField(vt.id, "unloadFee", e.target.value)}
                        onBlur={() => handleFieldBlur(vt.id)}
                        className={numCellCls}
                      />
                    </td>
                    <td className="px-2 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        disabled={!enabled}
                        value={draft.partnerIncomePerTon}
                        onChange={(e) => updateDraftField(vt.id, "partnerIncomePerTon", e.target.value)}
                        onBlur={() => handleFieldBlur(vt.id)}
                        className={numCellCls}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-end pt-4">
        <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium">
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
