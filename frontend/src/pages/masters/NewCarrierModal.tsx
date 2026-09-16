import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  // Fase 8X: dirección/CP/teléfono completos -- hacen falta para el bloque
  // "Transportista efectivo" del DeCA (ver document-pdf.service.ts).
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
  // Fase 8k: jornada laboral máxima (horas) admitida para los conductores de
  // este transportista -- ver comentario en el modelo Carrier (schema.prisma).
  maxRouteDurationHours: number | null;
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

interface VehicleTariffRow {
  enabled: boolean;
  flatFee: string;
  pricePerTon: string;
  unloadFee: string;
  partnerIncomePerTon: string;
}

const emptyVehicleRow: VehicleTariffRow = { enabled: false, flatFee: "", pricePerTon: "", unloadFee: "", partnerIncomePerTon: "" };

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCarrierModal({ open, carrier, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const isEdit = !!carrier;
  const [legalName, setLegalName] = useState("");
  const [taxId, setTaxId] = useState("");
  const [city, setCity] = useState("");
  const [province, setProvince] = useState("");
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceType, setServiceType] = useState("both");
  const [ownsFleet, setOwnsFleet] = useState(false);
  const [temperatureCapability, setTemperatureCapability] = useState("ambient");
  const [notes, setNotes] = useState("");
  const [maxRouteDurationHours, setMaxRouteDurationHours] = useState("");

  // Fase 15: "crear en un paso" -- petición explícita de Raúl ("poder
  // asignarle ruta y tipologias de vehiculo... mas las tarifas. para hacer
  // todo en un paso"). Solo tiene sentido AL CREAR: un transportista que ya
  // existe puede tener varias asignaciones de circuito simultáneas (colabora
  // en más de uno), así que esas se siguen gestionando una a una desde
  // "+ Añadir asignación" / "Ver ficha", como hasta ahora -- aquí solo se
  // cubre el alta inicial con su primer circuito.
  const [zoneId, setZoneId] = useState("");
  const [validFrom, setValidFrom] = useState(todayIso());
  const [vehicleRows, setVehicleRows] = useState<Record<string, VehicleTariffRow>>({});

  const { data: zonesData } = useQuery({
    queryKey: ["delivery-zones"],
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: { id: string; name: string }[] },
    enabled: open && !isEdit,
  });
  const { data: vehicleTypesData } = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: { id: string; name: string }[] },
    enabled: open && !isEdit,
  });

  useEffect(() => {
    if (!open) return;
    setLegalName(carrier?.legalName ?? "");
    setTaxId(carrier?.taxId ?? "");
    setCity(carrier?.city ?? "");
    setProvince(carrier?.province ?? "");
    setAddress(carrier?.address ?? "");
    setPostalCode(carrier?.postalCode ?? "");
    setPhone(carrier?.phone ?? "");
    setServiceType(carrier?.serviceType ?? "both");
    setOwnsFleet(carrier?.ownsFleet ?? false);
    setTemperatureCapability(carrier?.temperatureCapability ?? "ambient");
    setNotes(carrier?.notes ?? "");
    setMaxRouteDurationHours(carrier?.maxRouteDurationHours != null ? String(carrier.maxRouteDurationHours) : "");
    setZoneId("");
    setValidFrom(todayIso());
    setVehicleRows({});
  }, [open, carrier]);

  function toggleVehicleRow(vehicleTypeId: string, enabled: boolean) {
    setVehicleRows((prev) => ({ ...prev, [vehicleTypeId]: { ...(prev[vehicleTypeId] ?? emptyVehicleRow), enabled } }));
  }
  function updateVehicleRow(vehicleTypeId: string, field: keyof Omit<VehicleTariffRow, "enabled">, value: string) {
    setVehicleRows((prev) => ({ ...prev, [vehicleTypeId]: { ...(prev[vehicleTypeId] ?? emptyVehicleRow), [field]: value } }));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        legalName: legalName.trim(),
        taxId: taxId.trim(),
        city: city.trim() || undefined,
        province: province.trim() || undefined,
        address: address.trim() || undefined,
        postalCode: postalCode.trim() || undefined,
        phone: phone.trim() || undefined,
        serviceType,
        ownsFleet,
        temperatureCapability,
        notes: notes.trim() || undefined,
        maxRouteDurationHours: maxRouteDurationHours ? Number(maxRouteDurationHours) : undefined,
      };
      if (isEdit) {
        const updated = (await api.put(`/carriers/${carrier!.id}`, payload)).data;
        return { carrier: updated, partialWarning: null as string | null };
      }

      const created = (await api.post("/carriers", payload)).data;
      let partialWarning: string | null = null;

      // Fase 15: circuito + tipos de vehículo + tarifas en el mismo alta,
      // solo si Raúl ha elegido un circuito. Si algo falla a partir de aquí
      // el transportista YA está creado -- se avisa del fallo parcial en vez
      // de perderlo, en vez de deshacer la creación (mismo criterio de
      // "degradar con aviso, no bloquear" que ya usa Fase 14).
      if (zoneId) {
        const enabledEntries = Object.entries(vehicleRows).filter(([, r]) => r.enabled);
        if (enabledEntries.length === 0) {
          partialWarning = "Transportista creado, pero no se asignó ningún circuito: marca al menos un tipo de vehículo o hazlo después desde \"+ Añadir asignación\".";
        } else {
          try {
            const rate = (
              await api.post(`/delivery-zones/${zoneId}/rates`, { carrierId: created.id, validFrom })
            ).data;
            for (const [vehicleTypeId, row] of enabledEntries) {
              await api.put(`/delivery-zones/rates/${rate.id}/vehicle-types/${vehicleTypeId}`, {
                flatFee: row.flatFee ? Number(row.flatFee) : undefined,
                pricePerTon: row.pricePerTon ? Number(row.pricePerTon) : undefined,
                unloadFee: row.unloadFee ? Number(row.unloadFee) : undefined,
                partnerIncomePerTon: row.partnerIncomePerTon ? Number(row.partnerIncomePerTon) : undefined,
              });
            }
          } catch (err: any) {
            partialWarning = `Transportista creado, pero no se pudo guardar el circuito/tarifa (${
              err?.response?.data?.message ?? "error desconocido"
            }). Complétalo desde "Ver ficha".`;
          }
        }
      }
      return { carrier: created, partialWarning };
    },
    onSuccess: ({ partialWarning }) => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      onSuccess(partialWarning ?? (isEdit ? "Transportista actualizado correctamente" : "Transportista creado correctamente, con su circuito y tarifas"));
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
        <Field
          label="Dirección completa"
          hint="Para el bloque «Transportista efectivo» del DeCA (documento de control administrativo del transporte)."
        >
          <input className={inputCls} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Calle, número, polígono…" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Código postal">
            <input className={inputCls} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          </Field>
          <Field label="Teléfono">
            <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
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
        <Field
          label="Jornada laboral máxima (horas)"
          hint="Opcional — por tacógrafo/jornada, una ruta con este transportista no se podrá confirmar si su duración estimada la supera. Si también hay un límite en el almacén, se aplica el más restrictivo de los dos."
        >
          <input
            type="number"
            step="0.5"
            min="0"
            max="24"
            className={inputCls}
            value={maxRouteDurationHours}
            onChange={(e) => setMaxRouteDurationHours(e.target.value)}
            placeholder="Sin límite propio"
          />
        </Field>
        <Field label="Notas">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {/* Fase 15: circuito + tipos de vehículo + tarifa, en el mismo alta --
            petición explícita de Raúl ("al crear uno poder asignarle ruta y
            tipologias de vehiculo... mas las tarifas. para hacer todo en un
            paso"). Solo al crear: un transportista ya existente puede
            colaborar en varios circuitos a la vez, así que esos se siguen
            gestionando desde "+ Añadir asignación" / "Ver ficha". */}
        {!isEdit && (
          <div className="border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-700 mb-1">Circuito y tarifas (opcional)</p>
            <p className="text-xs text-slate-500 mb-3">
              Si ya sabes en qué circuito va a colaborar, asígnaselo aquí mismo con los tipos de vehículo que aporta y su
              tarifa de cada uno — se crea todo junto al guardar. Si lo dejas sin elegir, podrás asignárselo más tarde
              desde "+ Añadir asignación".
            </p>
            <Field label="Circuito de reparto">
              <select className={inputCls} value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                <option value="">Sin asignar todavía</option>
                {zonesData?.items.map((z: { id: string; name: string }) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </Field>

            {zoneId && (
              <div className="mt-3 space-y-3">
                <Field label="Vigente desde">
                  <input type="date" className={inputCls} value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
                </Field>
                <p className="text-xs text-slate-500">Marca los tipos de vehículo que aporta para este circuito y su tarifa:</p>
                {!vehicleTypesData?.items.length && <p className="text-xs text-slate-400">No hay tipos de vehículo dados de alta todavía.</p>}
                <div className="space-y-2">
                  {vehicleTypesData?.items.map((vt: { id: string; name: string }) => {
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
                          <div className="grid grid-cols-4 gap-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Tarifa plana €"
                              className={inputCls}
                              value={row.flatFee}
                              onChange={(e) => updateVehicleRow(vt.id, "flatFee", e.target.value)}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="€/TN"
                              className={inputCls}
                              value={row.pricePerTon}
                              onChange={(e) => updateVehicleRow(vt.id, "pricePerTon", e.target.value)}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Descarga €"
                              className={inputCls}
                              value={row.unloadFee}
                              onChange={(e) => updateVehicleRow(vt.id, "unloadFee", e.target.value)}
                            />
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="Ingreso €/TN socios"
                              className={inputCls}
                              value={row.partnerIncomePerTon}
                              onChange={(e) => updateVehicleRow(vt.id, "partnerIncomePerTon", e.target.value)}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
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
            {mutation.isPending ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear transportista"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
