import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

// Fase 7b: la ficha "Empresa" de Flota y Transportistas no tenía ni alta ni
// edición -- el backend (carriers.routes.ts) ya soportaba POST/PUT desde
// antes. Mismo patrón que NewCustomerModal/NewWarehouseModal: un único modal
// para alta y edición, según se le pase o no `carrier`.
//
// Fase 18: este modal dejó de incluir el alta de "circuito y tarifas" que
// tuvo brevemente en Fase 15 -- petición explícita de Raúl al detectar que
// duplicaba la introducción de costes con el flujo real de asignación (ver
// NewZoneAssignmentModal.tsx). Este modal ahora es solo el transportista en
// sí (datos base + tipos de vehículo que declara poder aportar EN GENERAL);
// su asignación a un circuito concreto, con la tarifa real por tipo de
// vehículo, se hace siempre desde dentro de esa ruta en TransportistasTab.tsx.

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
  // Fase 15 (más tarde): tipos de vehículo que este transportista declara
  // poder aportar (`CarrierVehicleType`) -- petición explícita de Raúl para
  // que este checklist esté en el propio modal de editar/crear, no solo en
  // la tabla de "sin circuito asignado" de TransportistasTab.tsx. Opcional:
  // si quien llama no lo trae (p. ej. un `CarrierRow` más simple en el
  // futuro), el modal simplemente arranca sin ninguno marcado.
  vehicleTypeOfferings?: { vehicleType: { id: string; name: string } }[];
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
  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceType, setServiceType] = useState("both");
  const [ownsFleet, setOwnsFleet] = useState(false);
  const [temperatureCapability, setTemperatureCapability] = useState("ambient");
  const [notes, setNotes] = useState("");
  const [maxRouteDurationHours, setMaxRouteDurationHours] = useState("");

  // Fase 15 (correcciones): tipos de vehículo que este transportista declara
  // poder aportar EN GENERAL (`CarrierVehicleType`), independiente de a qué
  // circuito(s) esté asignado -- petición explícita de Raúl ("la edicion y
  // creacion del transporte sigue indicando solo estas tipologias de
  // servicio, no el listado de los vehiculos que se estipularon ni
  // multiseleccion para elegirlos"). Antes esto solo se podía marcar desde la
  // tabla "sin circuito asignado" de TransportistasTab.tsx -- ahora vive
  // también aquí, visible tanto al crear como al editar.
  const [vehicleTypeIds, setVehicleTypeIds] = useState<Set<string>>(new Set());

  const { data: vehicleTypesData } = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: { id: string; name: string }[] },
    enabled: open,
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
    setVehicleTypeIds(new Set((carrier?.vehicleTypeOfferings ?? []).map((o) => o.vehicleType.id)));
  }, [open, carrier]);

  // Fase 15 (correcciones): al editar, cada checkbox se guarda al instante
  // (mismo patrón que `toggleVehicleTypeMutation` en TransportistasTab.tsx)
  // -- no hace falta pulsar "Guardar cambios" para que quede registrado. Al
  // crear, todavía no hay `carrier.id`, así que solo se actualiza el estado
  // local y se manda todo junto en `mutationFn` tras crear el transportista.
  const toggleVehicleTypeMutation = useMutation({
    mutationFn: async ({ vehicleTypeId, enabled }: { vehicleTypeId: string; enabled: boolean }) => {
      if (enabled) return (await api.post(`/carriers/${carrier!.id}/vehicle-types/${vehicleTypeId}`)).data;
      return (await api.delete(`/carriers/${carrier!.id}/vehicle-types/${vehicleTypeId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
    },
    onError: (err: any, { vehicleTypeId, enabled }) => {
      // Revertimos el checkbox local si la llamada falla, para no dejar la
      // pantalla mintiendo sobre lo que hay guardado de verdad.
      setVehicleTypeIds((prev) => {
        const next = new Set(prev);
        if (enabled) next.delete(vehicleTypeId);
        else next.add(vehicleTypeId);
        return next;
      });
      onError(err?.response?.data?.message ?? "No se pudo actualizar el tipo de vehículo");
    },
  });

  function toggleVehicleTypeOffering(vehicleTypeId: string, enabled: boolean) {
    setVehicleTypeIds((prev) => {
      const next = new Set(prev);
      if (enabled) next.add(vehicleTypeId);
      else next.delete(vehicleTypeId);
      return next;
    });
    if (isEdit) toggleVehicleTypeMutation.mutate({ vehicleTypeId, enabled });
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
      // Se acumula sobre `partialWarning` (con salto de línea) en vez de
      // pisarlo, para no perder un aviso si fallan varias cosas a la vez.
      const appendWarning = (msg: string) => {
        partialWarning = partialWarning ? `${partialWarning}\n${msg}` : msg;
      };

      // Fase 15 (correcciones): tipos de vehículo aportados en general
      // (independientes del circuito) -- se guardan tras crear. Un fallo aquí
      // tampoco deshace el alta.
      //
      // Fase 18: se quita de aquí el bloque "Circuito y tarifas (opcional)"
      // que había antes (Fase 15) -- petición explícita de Raúl, que
      // detectó que duplicaba la introducción de datos con el nuevo flujo
      // "crear la ruta y añadirle transportistas dentro" (ver
      // NewZoneAssignmentModal.tsx / TransportistasTab.tsx): ahora un
      // transportista siempre se asigna a un circuito, con su tarifa real
      // por tipo de vehículo, desde el botón "+ Añadir transportista" DENTRO
      // de la tarjeta de esa ruta -- un único sitio, no dos.
      if (vehicleTypeIds.size > 0) {
        const failedOfferings: string[] = [];
        for (const vehicleTypeId of vehicleTypeIds) {
          try {
            await api.post(`/carriers/${created.id}/vehicle-types/${vehicleTypeId}`);
          } catch {
            failedOfferings.push(vehicleTypesData?.items.find((vt) => vt.id === vehicleTypeId)?.name ?? vehicleTypeId);
          }
        }
        if (failedOfferings.length > 0) {
          appendWarning(`No se pudieron guardar estos tipos de vehículo: ${failedOfferings.join(", ")}. Márcalos de nuevo desde "Editar".`);
        }
      }
      return { carrier: created, partialWarning };
    },
    onSuccess: ({ partialWarning }) => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      onSuccess(
        partialWarning
          ? `Transportista creado, pero: ${partialWarning}`
          : isEdit
          ? "Transportista actualizado correctamente"
          : "Transportista creado correctamente. Para asignarlo a una ruta, entra en esa ruta (pestaña «Rutas / Transportistas») y usa «+ Añadir transportista»."
      );
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

        {/* Fase 15 (correcciones): tipos de vehículo que este transportista
            aporta EN GENERAL -- petición explícita de Raúl ("no [aparece] el
            listado de los vehiculos que se estipularon ni multiseleccion
            para elegirlos"). Visible tanto al crear como al editar; al
            editar cada checkbox se guarda al instante (ver
            toggleVehicleTypeMutation), al crear se manda todo junto con el
            alta del transportista. */}
        <div className="border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold text-slate-700 mb-1">Tipos de vehículo que aporta</p>
          <p className="text-xs text-slate-500 mb-3">
            Capacidad declarada de este transportista, independiente de a qué circuito(s) esté asignado.
          </p>
          {!vehicleTypesData?.items.length ? (
            <p className="text-xs text-slate-400">No hay tipos de vehículo dados de alta todavía.</p>
          ) : (
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {vehicleTypesData.items.map((vt: { id: string; name: string }) => (
                <label key={vt.id} className="flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={vehicleTypeIds.has(vt.id)}
                    onChange={(e) => toggleVehicleTypeOffering(vt.id, e.target.checked)}
                    className="rounded border-slate-300"
                  />
                  {vt.name}
                </label>
              ))}
            </div>
          )}
        </div>

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
