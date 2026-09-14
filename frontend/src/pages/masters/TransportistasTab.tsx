import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Chip from "@/components/Chip";
import NewCarrierModal, { CarrierEditable } from "@/pages/masters/NewCarrierModal";
import NewZoneAssignmentModal from "@/pages/masters/NewZoneAssignmentModal";
import ZoneAssignmentFichaModal from "@/pages/masters/ZoneAssignmentFichaModal";

// Fase 8: sustituye a las antiguas pestañas "Empresa" + "Vehículos" +
// "Tarifas" de Flota y Transportistas por una única tabla, tal y como pidió
// Raúl a partir de la plantilla real que aportó -- una fila por cada
// combinación circuito↔transportista (un mismo transportista puede repetirse
// en varias filas porque colabora en varios circuitos, o varios
// transportistas pueden compartir un circuito porque colaboran para
// distintos destinos dentro de él).
//
// Fase 8T -- rediseño de esta misma tabla (petición explícita de Raúl): la
// línea fija con los checkboxes de tipo de vehículo y una única tarifa
// compartida al lado se sustituye por una "ficha" (modal, ver
// ZoneAssignmentFichaModal.tsx) que se abre por fila -- dentro se elige qué
// tipos de vehículo aporta el transportista PARA ESE CIRCUITO y se fija una
// tarifa independiente para cada uno, de forma que "al hacer el enrutado,
// aplique la tarifa según el vehículo que se seleccione" (motor real
// conectado en rate-resolution.service.ts). La fila de la tabla ahora solo
// muestra un resumen (cuántos tipos de vehículo tiene configurados) y el
// botón para abrir la ficha.
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
  // Fase 8X: ver comentario en NewCarrierModal.tsx / schema.prisma.
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
  active: boolean;
  // Fase 8k: ver comentario en NewCarrierModal.tsx / schema.prisma.
  maxRouteDurationHours: number | null;
  _count: { vehicles: number };
  vehicleTypeOfferings: { vehicleType: { id: string; name: string } }[];
}

interface AssignmentRow {
  id: string;
  validFrom: string;
  validTo: string | null;
  // Legacy (Fase 8T): tarifa plana única, ya no se edita desde esta pantalla
  // -- se mantiene en el tipo solo porque el backend sigue devolviéndola
  // (columnas conservadas sin borrar, ver comentario en schema.prisma). La
  // tarifa real ahora es vehicleRates, de abajo.
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
  // Fase 8T: tarifa real, una fila por cada tipo de vehículo que este
  // transportista tiene marcado para este circuito -- ver ZoneAssignmentFichaModal.tsx.
  vehicleRates: { id: string; vehicleTypeId: string; flatFee: string | null; pricePerTon: string | null; unloadFee: string | null; partnerIncomePerTon: string | null; vehicleType: { id: string; name: string } }[];
}

export default function TransportistasTab() {
  const queryClient = useQueryClient();
  const [assignmentModalOpen, setAssignmentModalOpen] = useState(false);
  const [editingCarrier, setEditingCarrier] = useState<CarrierEditable | "new" | null>(null);
  // Se guarda solo el id, no el objeto -- así, tras cada refetch (al marcar/
  // desmarcar un tipo de vehículo o guardar una tarifa dentro de la ficha),
  // la ficha abierta siempre lee los datos frescos de `assignments` en vez
  // de quedarse con la foto del momento en que se abrió.
  const [fichaAssignmentId, setFichaAssignmentId] = useState<string | null>(null);
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
  const fichaAssignment = assignments.find((a) => a.id === fichaAssignmentId) ?? null;

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
              <th className="text-left px-3 py-2">Tipos de vehículo con tarifa</th>
              <th className="text-left px-3 py-2">Vigencia</th>
              <th className="text-left px-3 py-2">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {assignmentsQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!assignmentsQuery.isLoading && assignments.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                  Todavía no hay ninguna asignación de circuito. Empieza con "+ Añadir asignación".
                </td>
              </tr>
            )}
            {assignments.map((a) => (
              <tr key={a.id} className="hover:bg-brand-50/60 align-top">
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800">{a.deliveryZone.name}</p>
                  <p className="text-xs text-slate-400">{a.deliveryZone._count.customers} clientes</p>
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800">{a.carrier.legalName}</p>
                  <p className="text-xs text-slate-400 font-mono">{a.carrier.taxId}</p>
                  {!a.carrier.active && <Chip color="slate">Baja</Chip>}
                </td>
                <td className="px-3 py-2 min-w-[220px]">
                  {a.vehicleRates.length === 0 ? (
                    <span className="text-xs text-slate-400">Sin tipos de vehículo configurados todavía</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {a.vehicleRates.map((vr) => (
                        <span key={vr.id} className="inline-block px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-xs whitespace-nowrap">
                          {vr.vehicleType.name}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                  desde {new Date(a.validFrom).toLocaleDateString("es-ES")}
                  {a.validTo ? ` hasta ${new Date(a.validTo).toLocaleDateString("es-ES")}` : ""}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button
                    onClick={() => setFichaAssignmentId(a.id)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
                  >
                    Ver ficha
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`¿Eliminar la asignación de "${a.carrier.legalName}" en "${a.deliveryZone.name}"?`)) {
                        deleteRateMutation.mutate(a.id);
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-600 font-medium"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
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
      <ZoneAssignmentFichaModal
        open={fichaAssignmentId !== null}
        assignment={fichaAssignment}
        vehicleTypes={vehicleTypes}
        onClose={() => setFichaAssignmentId(null)}
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

