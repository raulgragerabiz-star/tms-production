import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Chip from "@/components/Chip";
import NewCarrierModal, { CarrierEditable } from "@/pages/masters/NewCarrierModal";
import NewZoneAssignmentModal from "@/pages/masters/NewZoneAssignmentModal";
import NewDeliveryZoneModal, { DeliveryZoneEditable } from "@/pages/masters/NewDeliveryZoneModal";
import ZoneAssignmentFichaModal from "@/pages/masters/ZoneAssignmentFichaModal";
import { useAuthStore } from "@/store/auth-store";

// Fase 8: sustituye a las antiguas pestañas "Empresa" + "Vehículos" +
// "Tarifas" de Flota y Transportistas por una única tabla.
//
// Fase 8T: la tarifa real de cada transportista vive por tipo de vehículo
// (ver ZoneAssignmentFichaModal.tsx / rate-resolution.service.ts).
//
// Fase 18 -- rediseño "ruta primero" (petición explícita de Raúl, tras
// detectar el bucle de doble introducción de costes descrito en
// NewZoneAssignmentModal.tsx): "tiene que poder crearse la ruta, y en ella
// introducir las empresas que colaboren en esa ruta. a las que añadirle los
// costes que tienen. en cada ruta lo mismo, puesto que un transportista
// puede trabajar en dos rutas distintas pero con costes diferentes." La
// tabla plana (una fila por circuito↔transportista) se sustituye por una
// tarjeta POR CIRCUITO, con la lista de transportistas que colaboran en él
// dentro -- así se ve de un vistazo, y se añade, exactamente en ese sitio.
// Esto ya funcionaba así en el modelo de datos (cada asignación es su propio
// DeliveryZoneRate independiente, así que un mismo transportista puede tener
// una fila -- y una tarifa -- distinta en cada circuito); lo que cambiaba
// era solo la forma de presentarlo y de darlo de alta.
//
// Fase 20 -- petición explícita de Raúl: "deberia tener un deplegable
// inicial para seleccionar el centro de origen, y en base a cual se
// seleccione, mostrar las rutas que pertenecen a ese centro y los
// transportistas por cada ruta". Se añade un selector de almacén (mismo
// GET /warehouses que ya usa InfluenceZonesPage.tsx) que filtra las
// tarjetas de circuito por `DeliveryZone.warehouseId` -- puramente de
// presentación en el frontend, no cambia ninguna consulta ni el modelo de
// datos. Empieza en "Todos los centros" (no oculta nada hasta que Raúl
// elige uno) porque hay circuitos sin almacén asignado todavía que de otro
// modo desaparecerían nada más entrar en la pantalla.

interface VehicleTypeOption {
  id: string;
  name: string;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface CarrierRow {
  id: string;
  legalName: string;
  taxId: string;
  city: string | null;
  province: string | null;
  address: string | null;
  postalCode: string | null;
  phone: string | null;
  serviceType: string;
  ownsFleet: boolean;
  temperatureCapability: string;
  notes: string | null;
  active: boolean;
  maxRouteDurationHours: number | null;
  _count: { vehicles: number };
  vehicleTypeOfferings: { vehicleType: { id: string; name: string } }[];
}

interface ZoneRow {
  id: string;
  name: string;
  active: boolean;
  warehouse: { id: string; name: string } | null;
  _count: { customers: number; rates: number };
  scheduleNotes: string[];
}

interface AssignmentRow {
  id: string;
  validFrom: string;
  validTo: string | null;
  scheduleNote: string | null;
  deliveryZone: { id: string; name: string; active: boolean; _count: { customers: number }; warehouse: { id: string; name: string } | null };
  carrier: CarrierEditable & {
    active: boolean;
    vehicleTypeOfferings: { vehicleType: { id: string; name: string } }[];
  };
  vehicleRates: { id: string; vehicleTypeId: string; flatFee: string | null; pricePerTon: string | null; pricePerKm: string | null; unloadFee: string | null; partnerIncomePerTon: string | null; vehicleType: { id: string; name: string } }[];
}

export default function TransportistasTab() {
  const queryClient = useQueryClient();
  const [editingCarrier, setEditingCarrier] = useState<CarrierEditable | "new" | null>(null);
  const [zoneModalState, setZoneModalState] = useState<DeliveryZoneEditable | "new" | null>(null);
  const [addAssignmentZone, setAddAssignmentZone] = useState<{ id: string; name: string } | null>(null);
  // Se guarda solo el id, no el objeto -- así, tras cada refetch (al marcar/
  // desmarcar un tipo de vehículo o guardar una tarifa dentro de la ficha),
  // la ficha abierta siempre lee los datos frescos de `assignments` en vez
  // de quedarse con la foto del momento en que se abrió.
  const [fichaAssignmentId, setFichaAssignmentId] = useState<string | null>(null);
  // Fase 25 ("usuarios app" sub-fase 3): QR de ruta (centro + circuito +
  // transportista) para esta asignación -- ver comentario en RouteQrModal
  // más abajo. Se guarda solo el id de la asignación, igual que
  // fichaAssignmentId, para leer siempre los datos frescos tras un refetch.
  const [qrAssignmentId, setQrAssignmentId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; error: boolean } | null>(null);
  // Fase 20: "" = Todos los centros (no filtra nada).
  const [warehouseFilter, setWarehouseFilter] = useState<string>("");

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
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: ZoneRow[] },
  });

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierRow[]; total: number },
  });

  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeOption[] },
  });

  // Fase 20: mismo endpoint que ya usa InfluenceZonesPage.tsx en la otra
  // sub-sección de "Zonas / Vehículos".
  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });

  const assignments = assignmentsQuery.data?.items ?? [];
  const zones = zonesQuery.data?.items ?? [];
  const vehicleTypes = vehicleTypesQuery.data?.items ?? [];
  const carriers = carriersQuery.data?.items ?? [];
  const warehouses = warehousesQuery.data?.items ?? [];
  const fichaAssignment = assignments.find((a) => a.id === fichaAssignmentId) ?? null;
  const qrAssignment = assignments.find((a) => a.id === qrAssignmentId) ?? null;

  // Una entrada por circuito (todos, incluso sin transportistas todavía) con
  // sus asignaciones dentro -- es la agrupación "ruta primero" que pidió
  // Raúl. Los circuitos que por algún motivo no llegan a aparecer en
  // `zonesQuery` (no debería pasar, pero por si acaso) no se pierden: se
  // añaden al final a partir de las propias asignaciones.
  const zoneGroups = useMemo(() => {
    const byZoneId = new Map<string, AssignmentRow[]>();
    for (const a of assignments) {
      const list = byZoneId.get(a.deliveryZone.id) ?? [];
      list.push(a);
      byZoneId.set(a.deliveryZone.id, list);
    }
    const groups = zones.map((z) => ({ zone: z, assignments: byZoneId.get(z.id) ?? [] }));
    const knownIds = new Set(zones.map((z) => z.id));
    for (const a of assignments) {
      if (knownIds.has(a.deliveryZone.id)) continue;
      groups.push({
        zone: { id: a.deliveryZone.id, name: a.deliveryZone.name, active: a.deliveryZone.active, warehouse: a.deliveryZone.warehouse, _count: { customers: a.deliveryZone._count.customers, rates: 0 }, scheduleNotes: [] },
        assignments: byZoneId.get(a.deliveryZone.id) ?? [],
      });
      knownIds.add(a.deliveryZone.id);
    }
    return groups;
  }, [zones, assignments]);

  // Fase 20: filtrado por centro de origen -- puramente de presentación,
  // sobre los grupos ya calculados arriba. "Todos los centros" (valor "")
  // no filtra nada; un circuito sin almacén asignado solo se ve ahí, nunca
  // bajo un centro concreto.
  const visibleZoneGroups = useMemo(() => {
    if (!warehouseFilter) return zoneGroups;
    return zoneGroups.filter((g) => g.zone.warehouse?.id === warehouseFilter);
  }, [zoneGroups, warehouseFilter]);

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

  // Fase 11: petición explícita de Raúl -- "quiero poder borrar cualquier
  // dato desde el perfil de administrador, incluidos datos que contengan
  // histórico". Ya no es una baja lógica: borra el transportista y todos sus
  // vehículos, conductores, envíos, liquidaciones y tarifas en cascada.
  // Fase 19: mismo criterio (y mismo rol exigido) para poder eliminar un
  // circuito por completo -- de ahí el nombre genérico `isAdmin` (antes
  // `canDeleteCarrier`, ahora se reutiliza para ambos borrados).
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.roles?.some((r) => r === "admin_empresa" || r === "admin_plataforma") ?? false;

  const deleteCarrierMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/carriers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carriers"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      notifySuccess("Transportista eliminado, junto con sus vehículos, conductores y envíos asociados");
    },
    onError: (err: any) => notifyError(err?.response?.data?.message ?? "No se pudo eliminar el transportista"),
  });

  function handleDeleteCarrier(c: { id: string; legalName: string }) {
    if (
      window.confirm(
        `¿Eliminar definitivamente al transportista "${c.legalName}"? Esta acción no se puede deshacer: se borrarán también sus vehículos, conductores, envíos, liquidaciones y tarifas, aunque sean históricos reales.`
      )
    ) {
      deleteCarrierMutation.mutate(c.id);
    }
  }

  // Fase 19: petición explícita de Raúl -- "hay que poder eliminar rutas,
  // actualmente solo se pueden añadir rutas o transportistas a cada ruta,
  // pero no se pueden eliminar si algún [circuito] se tiene que sacar de ese
  // almacén". Borrado real (no baja lógica, para eso ya está "Editar
  // circuito" -> desactivar), irreversible, solo admin -- ver comentario en
  // delivery-zones.routes.ts para qué se lleva por delante (sus tarifas por
  // transportista) y qué solo se desvincula (los clientes que lo tenían
  // como circuito, sin borrarlos).
  const deleteZoneMutation = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/delivery-zones/${id}`)).data as { name: string; transportistasEliminados: number; clientesDesvinculados: number },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ["delivery-zones"] });
      queryClient.invalidateQueries({ queryKey: ["delivery-zone-assignments"] });
      notifySuccess(
        `Circuito "${summary.name}" eliminado` +
          (summary.transportistasEliminados > 0 ? ` (${summary.transportistasEliminados} transportista(s) desvinculado(s) de él)` : "") +
          (summary.clientesDesvinculados > 0 ? ` · ${summary.clientesDesvinculados} cliente(s) sin circuito asignado ahora` : "")
      );
    },
    onError: (err: any) => notifyError(err?.response?.data?.message ?? "No se pudo eliminar el circuito"),
  });

  function handleDeleteZone(zone: { id: string; name: string; _count: { customers: number; rates: number } }) {
    const detalle: string[] = [];
    if (zone._count.rates > 0) detalle.push(`sus ${zone._count.rates} tarifa(s) de transportista`);
    if (zone._count.customers > 0) detalle.push(`${zone._count.customers} cliente(s) que lo tienen como circuito (se desvincularán, no se borrarán)`);
    const detalleTxt = detalle.length > 0 ? ` Se eliminarán también ${detalle.join(" y ")}.` : "";
    if (window.confirm(`¿Eliminar definitivamente el circuito "${zone.name}"? Esta acción no se puede deshacer.${detalleTxt}`)) {
      deleteZoneMutation.mutate(zone.id);
    }
  }

  const visibleAssignmentsCount = visibleZoneGroups.reduce((acc, g) => acc + g.assignments.length, 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-500">
          {visibleZoneGroups.length} circuitos · {visibleAssignmentsCount} asignaciones · {carriers.length} transportistas
          {warehouseFilter && zoneGroups.length !== visibleZoneGroups.length ? ` (de ${zoneGroups.length} circuitos en total)` : ""}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => setEditingCarrier("new")}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nuevo transportista
          </button>
          <button
            onClick={() => setZoneModalState("new")}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nuevo circuito
          </button>
        </div>
      </div>

      {/* Fase 20: desplegable de centro de origen -- petición explícita de
          Raúl. Filtra las tarjetas de circuito de abajo por el almacén del
          circuito (DeliveryZone.warehouseId); no cambia ninguna consulta. */}
      <div className="mb-4">
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Centro de origen</label>
        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2 min-w-[240px]"
        >
          <option value="">Todos los centros</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      {zonesQuery.isLoading && <p className="text-sm text-slate-400 py-6 text-center">Cargando circuitos…</p>}

      {!zonesQuery.isLoading && zoneGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-6 text-center text-slate-400 text-sm">
          Todavía no hay ningún circuito. Empieza con "+ Nuevo circuito" y, dentro de él, añade los transportistas que colaboran.
        </div>
      )}

      {!zonesQuery.isLoading && zoneGroups.length > 0 && visibleZoneGroups.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-3 py-6 text-center text-slate-400 text-sm">
          Ningún circuito tiene este centro como almacén asignado todavía.
        </div>
      )}

      <div className="space-y-4">
        {visibleZoneGroups.map(({ zone, assignments: zoneAssignments }) => (
          <div key={zone.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
              <div>
                <p className="font-semibold text-slate-800 flex items-center gap-2">
                  {zone.name}
                  {!zone.active && <Chip color="slate">Baja</Chip>}
                </p>
                <p className="text-xs text-slate-400">
                  {zone.warehouse ? zone.warehouse.name : "sin almacén asignado"} · {zone._count.customers} clientes ·{" "}
                  {zoneAssignments.length} transportista{zoneAssignments.length === 1 ? "" : "s"}
                  {zone.scheduleNotes.length > 0 ? ` · ${zone.scheduleNotes.join(", ")}` : ""}
                </p>
              </div>
              <div className="flex gap-3 whitespace-nowrap">
                <button
                  onClick={() => setZoneModalState({ id: zone.id, name: zone.name, warehouse: zone.warehouse })}
                  className="text-xs text-slate-500 hover:text-slate-700 font-medium"
                >
                  Editar circuito
                </button>
                <button
                  onClick={() => setAddAssignmentZone({ id: zone.id, name: zone.name })}
                  className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                >
                  + Añadir transportista
                </button>
                {isAdmin && (
                  <button onClick={() => handleDeleteZone(zone)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                    Eliminar circuito
                  </button>
                )}
              </div>
            </div>

            {zoneAssignments.length === 0 ? (
              <p className="px-4 py-4 text-sm text-slate-400">
                Todavía no hay transportistas asignados a este circuito. Usa "+ Añadir transportista".
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-white text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2">Transportista</th>
                    <th className="text-left px-4 py-2">Tipos de vehículo con tarifa</th>
                    <th className="text-left px-4 py-2">Vigencia</th>
                    <th className="text-left px-4 py-2">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {zoneAssignments.map((a) => (
                    <tr key={a.id} className="hover:bg-brand-50/60 align-top">
                      <td className="px-4 py-2">
                        <p className="font-medium text-slate-800">{a.carrier.legalName}</p>
                        <p className="text-xs text-slate-400 font-mono">{a.carrier.taxId}</p>
                        {!a.carrier.active && <Chip color="slate">Baja</Chip>}
                      </td>
                      <td className="px-4 py-2 min-w-[220px]">
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
                      <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                        desde {new Date(a.validFrom).toLocaleDateString("es-ES")}
                        {a.validTo ? ` hasta ${new Date(a.validTo).toLocaleDateString("es-ES")}` : ""}
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button
                          onClick={() => setFichaAssignmentId(a.id)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
                        >
                          Ver ficha
                        </button>
                        {/* Fase 25: QR de ruta (centro + este circuito + este
                            transportista) -- ver comentario en RouteQrModal
                            más abajo. Necesita un almacén concreto para el
                            centro del QR, así que se deshabilita si el
                            circuito todavía no tiene uno asignado (Editar
                            circuito). */}
                        <button
                          onClick={() => setQrAssignmentId(a.id)}
                          disabled={!zone.warehouse}
                          title={zone.warehouse ? undefined : "Este circuito todavía no tiene un almacén asignado (Editar circuito)"}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-brand-600"
                        >
                          Ver QR
                        </button>
                        <button
                          onClick={() => setEditingCarrier(a.carrier)}
                          className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`¿Eliminar la asignación de "${a.carrier.legalName}" en "${zone.name}"?`)) {
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
            )}
          </div>
        ))}
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
                      {isAdmin && (
                        <button onClick={() => handleDeleteCarrier(c)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <NewZoneAssignmentModal
        open={addAssignmentZone !== null}
        zone={addAssignmentZone}
        carriers={carriers.map((c) => ({ id: c.id, legalName: c.legalName }))}
        vehicleTypes={vehicleTypes}
        onClose={() => setAddAssignmentZone(null)}
        onSuccess={notifySuccess}
        onError={notifyError}
      />
      <NewDeliveryZoneModal
        open={zoneModalState !== null}
        zone={zoneModalState === "new" || zoneModalState === null ? null : zoneModalState}
        onClose={() => setZoneModalState(null)}
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
      {qrAssignment && qrAssignment.deliveryZone.warehouse && (
        <RouteQrModal
          warehouseId={qrAssignment.deliveryZone.warehouse.id}
          deliveryZoneId={qrAssignment.deliveryZone.id}
          carrierId={qrAssignment.carrier.id}
          carrierName={qrAssignment.carrier.legalName}
          zoneName={qrAssignment.deliveryZone.name}
          onClose={() => setQrAssignmentId(null)}
          onError={notifyError}
        />
      )}

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

// Fase 25 ("usuarios app" sub-fase 3): QR de ruta -- un único QR fijo por
// combinación centro + circuito + transportista, que sustituye al QR por
// vehículo/conductor como puerta de entrada a la App Conductor (ver
// comentario en RouteQrToken, schema.prisma). Corrección explícita de Raúl:
// vive aquí (Flota y Transportistas > Rutas / Transportistas), dentro de
// cada fila de asignación circuito↔transportista -- no en Maestros >
// Almacenes, que debe quedar exclusivamente con los datos propios de cada
// centro. El transportista y el circuito ya están fijados por la fila desde
// la que se abre, así que no hace falta elegirlos aquí (a diferencia del
// primer borrador de esta pantalla). Mismo patrón (y mismo servicio
// gratuito de generación de imagen QR, api.qrserver.com) que VehicleQrModal
// en VehiclesPage.tsx.
function RouteQrModal({
  warehouseId,
  deliveryZoneId,
  carrierId,
  carrierName,
  zoneName,
  onClose,
  onError,
}: {
  warehouseId: string;
  deliveryZoneId: string;
  carrierId: string;
  carrierName: string;
  zoneName: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const scopeParams = { warehouseId, deliveryZoneId, carrierId };

  const tokenQuery = useQuery({
    queryKey: ["route-qr-token", warehouseId, deliveryZoneId, carrierId],
    queryFn: async () => (await api.get("/route-qr", { params: scopeParams })).data as { token: string | null },
  });

  const issueMutation = useMutation({
    mutationFn: async () => (await api.post("/route-qr", scopeParams)).data as { token: string },
    onSuccess: () => tokenQuery.refetch(),
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo generar el QR"),
  });

  const token = issueMutation.data?.token ?? tokenQuery.data?.token ?? null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">QR de ruta — {carrierName}</h3>
        <p className="text-xs text-slate-400 mb-3">Circuito: {zoneName}</p>
        <p className="text-xs text-slate-500 mb-4">
          El conductor lo escanea desde la App Conductor para identificarse (nombre, DNI, teléfono, matrícula) y
          ver/operar la ruta de este circuito, cualquier día que este transportista tenga una asignada.
        </p>

        {tokenQuery.isLoading && <p className="text-sm text-slate-400 py-8">Cargando…</p>}

        {!tokenQuery.isLoading && token && (
          <>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(token)}`}
              alt={`Código QR de ruta para ${carrierName}`}
              className="mx-auto rounded-lg border border-slate-200"
              width={220}
              height={220}
            />
            <p className="text-[10px] font-mono text-slate-400 mt-3 break-all">{token}</p>
          </>
        )}

        {!tokenQuery.isLoading && !token && (
          <p className="text-sm text-slate-400 py-6">Todavía no se ha generado un QR para este transportista en este circuito.</p>
        )}

        <div className="flex gap-2 mt-5">
          <button
            onClick={() => issueMutation.mutate()}
            disabled={issueMutation.isPending}
            className="flex-1 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
          >
            {token ? "Generar nuevo (invalida el anterior)" : "Generar QR"}
          </button>
          <button onClick={onClose} className="text-sm text-slate-500 px-4 py-2">
            Cerrar
          </button>
        </div>
      </div>
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
