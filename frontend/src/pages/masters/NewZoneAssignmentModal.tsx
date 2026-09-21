import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 8: alta de una fila de la nueva tabla "Transportistas" -- un circuito
// de reparto (p.ej. "MAD1") servido por un transportista, con su tarifa.
//
// Fase 18 -- rediseño completo (petición explícita de Raúl, tras detectar un
// bucle real de doble introducción de datos): "se añade transportista con
// todos los datos de costes y luego en la asignacion hay que volver a poner
// los datos de coste. tiene que poder crearse la ruta, y en ella introducir
// las empresas que colaboren en esa ruta. a las que añadirle los costes que
// tienen." Antes este modal pedía 4 campos de coste "planos" (flatFee/
// pricePerTon/unloadFee/partnerIncomePerTon) que NUNCA llegaban a usarse --
// el motor de tarifas (rate-resolution.service.ts, nivel
// "by_delivery_zone_vehicle") solo lee la tarifa POR TIPO DE VEHÍCULO
// (DeliveryZoneRateVehicleType), así que tras rellenar esos 4 campos aquí
// había que abrir "Ver ficha" (ZoneAssignmentFichaModal) y volver a
// escribirlos, ahora sí en el sitio correcto -- ese era el bucle.
//
// Ahora este modal:
//   1. Siempre está "anclado" a un circuito ya elegido (se abre desde el
//      botón "+ Añadir transportista" DENTRO de la tarjeta de esa ruta en
//      TransportistasTab.tsx) -- ya no permite elegir/crear circuito aquí
//      (eso se hace aparte, con "+ Nuevo circuito" / NewDeliveryZoneModal.tsx).
//   2. Pide directamente los tipos de vehículo que aporta el transportista
//      PARA ESTE CIRCUITO y su tarifa de cada uno (mismos 5 campos que
//      ZoneAssignmentFichaModal, incluido el €/km de Fase 17) -- en un único
//      paso: crear la asignación + guardar sus tarifas reales, sin segunda
//      pantalla. "Ver ficha" sigue existiendo para editar más tarde (añadir
//      otro tipo de vehículo, ajustar una tarifa).

interface CarrierOption {
  id: string;
  legalName: string;
}

interface VehicleTypeOption {
  id: string;
  name: string;
}

interface VehicleTariffRow {
  enabled: boolean;
  flatFee: string;
  pricePerTon: string;
  pricePerKm: string;
  unloadFee: string;
  partnerIncomePerTon: string;
}

const emptyVehicleRow: VehicleTariffRow = {
  enabled: false,
  flatFee: "",
  pricePerTon: "",
  pricePerKm: "",
  unloadFee: "",
  partnerIncomePerTon: "",
};

interface Props {
  open: boolean;
  zone: { id: string; name: string } | null;
  carriers: CarrierOption[];
  vehicleTypes: VehicleTypeOption[];
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";
const numCls = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewZoneAssignmentModal({ open, zone, carriers, vehicleTypes, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [carrierId, setCarrierId] = useState("");
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [scheduleNote, setScheduleNote] = useState("");
  const [vehicleRows, setVehicleRows] = useState<Record<string, VehicleTariffRow>>({});

  useEffect(() => {
    if (!open) return;
    setCarrierId(carriers[0]?.id ?? "");
    setValidFrom(new Date().toISOString().slice(0, 10));
    setScheduleNote("");
    setVehicleRows({});
  }, [open, carriers]);

  function toggleVehicleRow(vehicleTypeId: string, enabled: boolean) {
    setVehicleRows((prev) => ({ ...prev, [vehicleTypeId]: { ...(prev[vehicleTypeId] ?? emptyVehicleRow), enabled } }));
  }
  function updateVehicleRow(vehicleTypeId: string, field: keyof Omit<VehicleTariffRow, "enabled">, value: string) {
    setVehicleRows((prev) => ({ ...prev, [vehicleTypeId]: { ...(prev[vehicleTypeId] ?? emptyVehicleRow), [field]: value } }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      if (!zone) throw new Error("no_zone");
      const rate = (
        await api.post(`/delivery-zones/${zone.id}/rates`, {
          carrierId,
          validFrom,
          scheduleNote: scheduleNote.trim() || undefined,
        })
      ).data as { id: string };

      const enabledEntries = Object.entries(vehicleRows).filter(([, r]) => r.enabled);
      const failed: string[] = [];
      for (const [vehicleTypeId, row] of enabledEntries) {
        try {
          await api.put(`/delivery-zones/rates/${rate.id}/vehicle-types/${vehicleTypeId}`, {
            flatFee: row.flatFee === "" ? null : Number(row.flatFee),
            pricePerTon: row.pricePerTon === "" ? null : Number(row.pricePerTon),
            pricePerKm: row.pricePerKm === "" ? null : Number(row.pricePerKm),
            unloadFee: row.unloadFee === "" ? null : Number(row.unloadFee),
            partnerIncomePerTon: row.partnerIncomePerTon === "" ? null : Number(row.partnerIncomePerTon),
          });
        } catch {
          failed.push(vehicleTypes.find((vt) => vt.id === vehicleTypeId)?.name ?? vehicleTypeId);
        }
      }
      return { failed, hasAnyVehicleType: enabledEntries.length > 0 };
    },
    onSuccess: ({ failed, hasAnyVehicleType }) => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      if (failed.length > 0) {
        onSuccess(`Transportista añadido a la ruta, pero no se pudo guardar la tarifa de: ${failed.join(", ")}. Complétalo desde "Ver ficha".`);
      } else if (!hasAnyVehicleType) {
        onSuccess('Transportista añadido a la ruta. Marca al menos un tipo de vehículo (aquí o desde "Ver ficha") para que el motor de rutas pueda usarlo.');
      } else {
        onSuccess("Transportista añadido a la ruta, con su tarifa por tipo de vehículo");
      }
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo añadir el transportista a la ruta"),
  });

  const canSubmit = !!zone && !!carrierId && !mutation.isPending;

  return (
    <Modal open={open} title={zone ? `Añadir transportista a "${zone.name}"` : "Añadir transportista"} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
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

        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-700 mb-1">Tipos de vehículo que aporta en esta ruta, y su tarifa</p>
          <p className="text-xs text-slate-400 mb-3">
            Tarifa plana, €/Tn y €/km son coste para BigMat (lo que se paga al transportista); Descarga e Ingreso €/tn
            socios son ingreso para BigMat (lo que se cobra de más al cliente). El motor de enrutado aplicará la
            tarifa del tipo de vehículo que finalmente se seleccione.
          </p>
          {vehicleTypes.length === 0 ? (
            <p className="text-xs text-slate-400">No hay tipos de vehículo dados de alta todavía.</p>
          ) : (
            <div className="space-y-2">
              {vehicleTypes.map((vt) => {
                const row = vehicleRows[vt.id] ?? emptyVehicleRow;
                return (
                  <div key={vt.id} className="rounded-lg border border-slate-200 p-2.5">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-2">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => toggleVehicleRow(vt.id, e.target.checked)}
                        className="rounded border-slate-300"
                      />
                      {vt.name}
                    </label>
                    {row.enabled && (
                      <div className="grid grid-cols-5 gap-2">
                        <input type="number" min="0" step="0.01" placeholder="Tarifa plana €" className={numCls} value={row.flatFee} onChange={(e) => updateVehicleRow(vt.id, "flatFee", e.target.value)} />
                        <input type="number" min="0" step="0.01" placeholder="€/Tn" className={numCls} value={row.pricePerTon} onChange={(e) => updateVehicleRow(vt.id, "pricePerTon", e.target.value)} />
                        <input type="number" min="0" step="0.01" placeholder="€/km" className={numCls} value={row.pricePerKm} onChange={(e) => updateVehicleRow(vt.id, "pricePerKm", e.target.value)} />
                        <input type="number" min="0" step="0.01" placeholder="Descarga €" className={numCls} value={row.unloadFee} onChange={(e) => updateVehicleRow(vt.id, "unloadFee", e.target.value)} />
                        <input type="number" min="0" step="0.01" placeholder="Ingreso €/tn socios" className={numCls} value={row.partnerIncomePerTon} onChange={(e) => updateVehicleRow(vt.id, "partnerIncomePerTon", e.target.value)} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
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
            {mutation.isPending ? "Guardando…" : "Añadir a la ruta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
