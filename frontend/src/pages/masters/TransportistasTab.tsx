import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Chip from "@/components/Chip";
import NewCarrierModal, { CarrierEditable } from "@/pages/masters/NewCarrierModal";
import NewZoneAssignmentModal from "@/pages/masters/NewZoneAssignmentModal";

// Fase 8: sustituye a las antiguas pestañas "Empresa" + "Vehículos" +
// "Tarifas" de Flota y Transportistas por una única tabla, tal y como pidió
// Raúl a partir de la plantilla real que aportó -- una fila por cada
// combinación circuito↔transportista (un mismo transportista puede repetirse
// en varias filas porque colabora en varios circuitos, o varios
// transportistas pueden compartir un circuito porque colaboran para
// distintos destinos dentro de él), con:
//   - el tipo de vehículo que tiene ese transportista, como checkboxes en la
//     propia línea ("seleccionar simplemente en la línea el tipo de
//     vehículo que tiene"),
//   - y columnas según la tipología de tarifa (tarifa plana €, €/Tn,
//     descarga, ingreso €/tn socios) en vez de las columnas de analítica
//     (kg, pedidos, % del total) de la referencia que envió -- esas
//     pertenecen al módulo de Analítica, no a esta ficha.
// Los transportistas sin ningún circuito/tarifa asignado todavía (recién
// creados, o que solo hacen camión completo/paletería general) se listan
// aparte para que no "desaparezcan" de esta pantalla.

interface VehicleTypeOption {
  id: string;
  name: string;
}

interface CarrierRow {
  id: string;
  legalName: string;
  taxId: string;
  city: string | null;
  province: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
  active: boolean;
  _count: { vehicles: number };
  vehicleTypeOfferings: { vehicleType: { id: string; name: string } }[];
}

interface AssignmentRow {
  id: string;
  validFrom: string;
  validTo: string | null;
  flatFee: string | null;
  pricePerTon: string | null;
  unloadFee: string | null;
  partnerIncomePerTon: string | null;
  scheduleNote: string | null;
  deliveryZone: { id: string; name: string; active: boolean; _count: { customers: number } };
  carrier: {
    id: string;
    legalName: string;
    taxId: string;
    active: boolean;
    vehicleTypeOfferings: { vehicleType: { id: string; name: string } }[];
  };
}

const numCellCls = "w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm text-right";

export default function TransportistasTab() {
  const queryClient = useQueryClient();
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<CarrierEditable | "new" | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; error: boolean } | null>(null);

  function notifySuccess(text: string) {
    setToastMsg({ text, error: false });
  }
  function notifyError(text: string) {
    setToastMsg({ text, error: true });
  }

  const assignmentsQuery = useQuery({
    queryKey: ["delivery-zone-assignments"],
    queryFn: async () => (await api.get("/delivery-zones/assignments")).data as { items: AssignmentRow[]; total: number },
  });

  const zonesQuery = useQuery({
    queryKey: ["delivery-zones"],
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: { id: string; name: string }[] },
  });

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierRow[]; total: number },
  });

  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeOption[] },
  });

  const assignments = assignmentsQuery.data?.items ?? [];
  const vehicleTypes = vehicleTypesQuery.data?.items ?? [];
  const carriers = carriersQuery.data?.items ?? [];

  const carriersWithoutAssignment = useMemo(() => {
    const assignedCarrierIds = new Set(assignments.map((a) => a.carrier.id));
    return carriers.filter((c) => !assignedCarrierIds.has(c.id));
  }, [assignments, carriers]);

  const toggleVehicleTypeMutation = useMutation({
    mutationFn: async ({ carrierId, vehicleTypeId, enabled }: { carrierId: string; vehicleTypeId: string; enabled: boolean }) => {
      if (enabled) return (await api.post(`/carriers/${carrierId}/vehicle-types/${vehicleTypeId}`)).data;
      return (await api.delete(`/carriers/${carrierId}/vehicle-types/${vehicleTypeId}`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
    },
    onError: () => notifyError("No se pudo actualizar el tipo de vehículo"),
  });

  const updateRateMutation = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string; [key: string]: unknown }) => (await api.patch(`/delivery-zones/rates/${id}`, patch)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] }),
    onError: (err: any) => {
      notifyError(err?.response?.data?.message ?? "No se pudo guardar el cambio");
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
    },
  });

  const deleteRateMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/delivery-zones/rates/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      notifySuccess("Asignación eliminada");
    },
    onError: () => notifyError("No se pudo eliminar la asignación"),
  });

  const deleteCarrierMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/carriers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      notifySuccess("Transportista dado de baja correctamente");
    },
    onError: (err: any) => notifyError(err?.response?.data?.message ?? "No se pudo dar de baja el transportista"),
  });

  function handleDeleteCarrier(c: { id: string; legalName: string }) {
    if (window.confirm(`¿Dar de baja al transportista "${c.legalName}"? Sus rutas y liquidaciones históricas no se ven afectadas.`)) {
      deleteCarrierMutation.mutate(c.id);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {assignments.length} asignaciones de circuito · {carriers.length} transportistas
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setEditingCarrier("new")}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nuevo transportista
          </button>
          <button
            onClick={() => setAssignmentModalOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Añadir asignación
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2">Circuito</th>
              <th className="text-left px-3 py-2">Transportista</th>
              <th className="text-left px-3 py-2">Tipo de vehículo</th>
              <th className="text-right px-3 py-2">Tarifa plana €</th>
              <th className="text-right px-3 py-2">€/Tn</th>
              <th className="text-right px-3 py-2">Descarga €</th>
              <th className="text-right px-3 py-2">Ingreso €/tn socios</th>
              <th className="text-left px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assignmentsQuery.isLoading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!assignmentsQuery.isLoading && assignments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay ninguna asignación de circuito. Empieza con "+ Añadir asignación".
                </td>
              </tr>
            )}
            {assignments.map((a) => (
              <AssignmentTableRow
                key={a.id}
                assignment={a}
                vehicleTypes={vehicleTypes}
                onToggleVehicleType={(vehicleTypeId, enabled) =>
                  toggleVehicleTypeMutation.mutate({ carrierId: a.carrier.id, vehicleTypeId, enabled })
                }
                onSaveRate={(patch) => updateRateMutation.mutate({ id: a.id, ...patch })}
                onDelete={() => {
                  if (window.confirm(`¿Eliminar la asignación de "${a.carrier.legalName}" en "${a.deliveryZone.name}"?`)) {
                    deleteRateMutation.mutate(a.id);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      {carriersWithoutAssignment.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Transportistas sin circuito asignado todavía ({carriersWithoutAssignment.length})
          </p>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Transportista</th>
                  <th className="text-left px-3 py-2">NIF</th>
                  <th className="text-left px-3 py-2">Tipo de vehículo</th>
                  <th className="text-left px-3 py-2">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {carriersWithoutAssignment.map((c) => (
                  <tr key={c.id} className="hover:bg-brand-50/60">
                    <td className="px-3 py-2 font-medium">{c.legalName}</td>
                    <td className="px-3 py-2 font-mono text-xs">{c.taxId}</td>
                    <td className="px-3 py-2">
                      <VehicleTypeCheckboxes
                        vehicleTypes={vehicleTypes}
                        selectedIds={new Set(c.vehicleTypeOfferings.map((o) => o.vehicleType.id))}
                        onToggle={(vehicleTypeId, enabled) => toggleVehicleTypeMutation.mutate({ carrierId: c.id, vehicleTypeId, enabled })}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <button onClick={() => setEditingCarrier(c)} className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3">
                        Editar
                      </button>
                      <button onClick={() => handleDeleteCarrier(c)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewZoneAssignmentModal
        open={assignmentModalOpen}
        zones={zonesQuery.data?.items ?? []}
        carriers={carriers.map((c) => ({ id: c.id, legalName: c.legalName }))}
        onClose={() => setAssignmentModalOpen(false)}
        onSuccess={notifySuccess}
        onError={notifyError}
      />
      <NewCarrierModal
        open={editingCarrier !== null}
        carrier={editingCarrier === "new" || editingCarrier === null ? null : editingCarrier}
        onClose={() => setEditingCarrier(null)}
        onSuccess={notifySuccess}
        onError={notifyError}
      />

      {toastMsg && (
        <div
          className={`fixed bottom-4 right-4 px-4 py-2.5 rounded-lg text-sm text-white shadow-lg z-50 ${toastMsg.error ? "bg-red-600" : "bg-slate-900"}`}
          onAnimationEnd={() => setToastMsg(null)}
        >
          {toastMsg.text}
        </div>
      )}
    </div>
  );
}

function VehicleTypeCheckboxes({
  vehicleTypes,
  selectedIds,
  onToggle,
}: {
  vehicleTypes: VehicleTypeOption[];
  selectedIds: Set<string>;
  onToggle: (vehicleTypeId: string, enabled: boolean) => void;
}) {
  if (vehicleTypes.length === 0) {
    return <span className="text-xs text-slate-400">Sin tipos de vehículo configurados</span>;
  }
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {vehicleTypes.map((vt) => (
        <label key={vt.id} className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
          <input
            type="checkbox"
            checked={selectedIds.has(vt.id)}
            onChange={(e) => onToggle(vt.id, e.target.checked)}
            className="rounded border-slate-300"
          />
          {vt.name}
        </label>
      ))}
    </div>
  );
}

function AssignmentTableRow({
  assignment,
  vehicleTypes,
  onToggleVehicleType,
  onSaveRate,
  onDelete,
}: {
  assignment: AssignmentRow;
  vehicleTypes: VehicleTypeOption[];
  onToggleVehicleType: (vehicleTypeId: string, enabled: boolean) => void;
  onSaveRate: (patch: Record<string, number | null>) => void;
  onDelete: () => void;
}) {
  const [flatFee, setFlatFee] = useState(assignment.flatFee ?? "");
  const [pricePerTon, setPricePerTon] = useState(assignment.pricePerTon ?? "");
  const [unloadFee, setUnloadFee] = useState(assignment.unloadFee ?? "");
  const [partnerIncomePerTon, setPartnerIncomePerTon] = useState(assignment.partnerIncomePerTon ?? "");

  useEffect(() => setFlatFee(assignment.flatFee ?? ""), [assignment.flatFee]);
  useEffect(() => setPricePerTon(assignment.pricePerTon ?? ""), [assignment.pricePerTon]);
  useEffect(() => setUnloadFee(assignment.unloadFee ?? ""), [assignment.unloadFee]);
  useEffect(() => setPartnerIncomePerTon(assignment.partnerIncomePerTon ?? ""), [assignment.partnerIncomePerTon]);

  function saveIfChanged(field: string, value: string, original: string | null) {
    const normalized = value === "" ? null : Number(value);
    const originalNumber = original === null ? null : Number(original);
    if (normalized !== originalNumber) onSaveRate({ [field]: normalized });
  }

  const selectedVehicleTypeIds = new Set(assignment.carrier.vehicleTypeOfferings.map((o) => o.vehicleType.id));

  return (
    <tr className="hover:bg-brand-50/60 align-top">
      <td className="px-3 py-2">
        <p className="font-medium text-slate-800">{assignment.deliveryZone.name}</p>
        <p className="text-xs text-slate-400">{assignment.deliveryZone._count.customers} clientes</p>
      </td>
      <td className="px-3 py-2">
        <p className="font-medium text-slate-800">{assignment.carrier.legalName}</p>
        <p className="text-xs text-slate-400 font-mono">{assignment.carrier.taxId}</p>
        {!assignment.carrier.active && <Chip color="slate">Baja</Chip>}
      </td>
      <td className="px-3 py-2 min-w-[220px]">
        <VehicleTypeCheckboxes vehicleTypes={vehicleTypes} selectedIds={selectedVehicleTypeIds} onToggle={onToggleVehicleType} />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={flatFee}
          onChange={(e) => setFlatFee(e.target.value)}
          onBlur={() => saveIfChanged("flatFee", flatFee, assignment.flatFee)}
          className={numCellCls}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={pricePerTon}
          onChange={(e) => setPricePerTon(e.target.value)}
          onBlur={() => saveIfChanged("pricePerTon", pricePerTon, assignment.pricePerTon)}
          className={numCellCls}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={unloadFee}
          onChange={(e) => setUnloadFee(e.target.value)}
          onBlur={() => saveIfChanged("unloadFee", unloadFee, assignment.unloadFee)}
          className={numCellCls}
        />
      </td>
      <td className="px-2 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={partnerIncomePerTon}
          onChange={(e) => setPartnerIncomePerTon(e.target.value)}
          onBlur={() => saveIfChanged("partnerIncomePerTon", partnerIncomePerTon, assignment.partnerIncomePerTon)}
          className={numCellCls}
        />
      </td>
      <td className="px-3 py-2">
        <button onClick={onDelete} className="text-xs text-red-500 hover:text-red-600 font-medium whitespace-nowrap">
          Eliminar
        </button>
      </td>
    </tr>
  );
}
