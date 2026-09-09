import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";
import StatusBadge from "@/components/StatusBadge";
import Chip from "@/components/Chip";

// Hueco crítico encontrado por Raúl probando el Planificador: "Comparar
// transportistas" (POST /optimization/:id/simulate) generaba candidatos con
// coste, pero no existía NINGUNA pantalla para elegir uno (el endpoint
// POST /optimization/:id/select/:costSimulationId ya existía en el backend
// desde antes, sin usar), así que una ruta se quedaba en "optimized" para
// siempre sin transportista. Tampoco existía forma de crear el Shipment
// (POST /shipments) que es justo lo que hace que la ruta aparezca en la App
// Conductor y en Seguimiento -- de ahí que ningún pedido de prueba llegara a
// ninguna app. Este modal cierra ese hueco de punta a punta: comparar →
// elegir transportista → elegir vehículo → elegir conductor → crear envío →
// (mientras no haya Portal Transportista real en uso) confirmar manualmente.

interface Props {
  routeId: string | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface RouteDetail {
  id: string;
  status: string;
  serviceType: string;
  routeDate: string;
  warehouse: { name: string };
  carrier: { id: string; legalName: string } | null;
  vehicle: { id: string; plate: string } | null;
  loadPlan: { weightOccupancyPct: number; palletOccupancyPct: number; totalWeightKg: string; totalPallets: string } | null;
  stops: { id: string; order: { orderNumber: string; customer: { legalName: string } } }[];
  costSimulations: {
    id: string;
    estimatedCost: string;
    isSelected: boolean;
    carrier: { id: string; legalName: string };
    vehicleType: { name: string } | null;
  }[];
  shipment: { id: string; status: string; driverId: string | null } | null;
}

interface VehicleOption {
  id: string;
  plate: string;
  vehicleType: { name: string };
}

interface DriverOption {
  id: string;
  fullName: string;
}

interface CarrierOption {
  id: string;
  legalName: string;
}

// Estados en los que la ruta ya no se gestiona desde aquí: el transportista
// (Portal Transportista) o el conductor (App Conductor) llevan el resto.
const LOCKED_STATUSES = ["in_progress", "closed", "rejected"];

export default function RouteAssignmentModal({ routeId, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [manualCarrierId, setManualCarrierId] = useState("");

  const routeQuery = useQuery({
    queryKey: ["route-detail", routeId],
    queryFn: async () => (await api.get(`/routes/${routeId}`)).data as RouteDetail,
    enabled: !!routeId,
  });
  const route = routeQuery.data;

  useEffect(() => {
    setSelectedVehicleId(route?.vehicle?.id ?? "");
    setSelectedDriverId(route?.shipment?.driverId ?? "");
  }, [route?.id, route?.vehicle?.id, route?.shipment?.driverId]);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "by-carrier", route?.carrier?.id],
    queryFn: async () => (await api.get("/vehicles", { params: { carrierId: route!.carrier!.id } })).data as { items: VehicleOption[] },
    enabled: !!route?.carrier?.id,
  });

  const driversQuery = useQuery({
    queryKey: ["drivers", route?.carrier?.id],
    queryFn: async () => (await api.get("/vehicles/drivers", { params: { carrierId: route!.carrier!.id } })).data as { items: DriverOption[] },
    enabled: !!route?.carrier?.id,
  });

  // Asignación manual de transportista, sin pasar por la comparativa de
  // coste -- necesaria porque "Comparar transportistas" falla si ningún
  // transportista tiene tarifa vigente cargada para la fecha/servicio (algo
  // habitual mientras se prueba con datos nuevos), y sin ella no había forma
  // de sacar la ruta de "optimized"/"draft".
  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
    enabled: !!routeId,
  });

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["route-detail", routeId] });
    queryClient.invalidateQueries({ queryKey: ["routes"] });
    queryClient.invalidateQueries({ queryKey: ["planner-board"] });
  }

  const simulateMutation = useMutation({
    mutationFn: async () => (await api.post(`/optimization/${routeId}/simulate`)).data,
    onSuccess: (data: any) => {
      invalidateAll();
      // Motor de inteligencia (3/3): si la empresa tiene activada la
      // auto-asignación (Configuración) y el mejor candidato superó el
      // umbral de confianza, /simulate ya lo ha asignado -- se refleja aquí
      // en vez de dejar que el usuario piense que hace falta elegir a mano.
      if (data.autoAssign?.autoAssigned) {
        const pct = Math.round((data.autoAssign.confidence ?? 0) * 100);
        onSuccess(
          `Comparativa generada (${data.candidates?.length ?? 0} candidatos) — transportista asignado automáticamente (confianza ${pct}%)`
        );
      } else {
        onSuccess(`Comparativa generada (${data.candidates?.length ?? 0} candidatos)`);
      }
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo comparar transportistas"),
  });

  const selectMutation = useMutation({
    mutationFn: async (costSimulationId: string) => (await api.post(`/optimization/${routeId}/select/${costSimulationId}`)).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Transportista asignado");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo asignar el transportista"),
  });

  const manualAssignCarrierMutation = useMutation({
    mutationFn: async (carrierId: string) => (await api.patch(`/routes/${routeId}/status`, { status: "assigned", carrierId })).data,
    onSuccess: () => {
      invalidateAll();
      setManualCarrierId("");
      onSuccess("Transportista asignado directamente (sin comparativa de coste)");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo asignar el transportista"),
  });

  const setVehicleMutation = useMutation({
    mutationFn: async (vehicleId: string) =>
      (await api.patch(`/routes/${routeId}/status`, { status: "assigned", vehicleId })).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Vehículo guardado");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo guardar el vehículo"),
  });

  const createShipmentMutation = useMutation({
    mutationFn: async () =>
      (await api.post("/shipments", { routeId, driverId: selectedDriverId || undefined })).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Envío creado: ya es visible en Seguimiento y, si tiene conductor, en la App Conductor");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo crear el envío"),
  });

  const assignDriverMutation = useMutation({
    mutationFn: async (driverId: string) => (await api.patch(`/shipments/${route!.shipment!.id}/driver`, { driverId })).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Conductor asignado al envío");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo asignar el conductor"),
  });

  // Marcar como confirmada a mano: en producción este paso lo hace el
  // transportista desde su Portal (aceptar/rechazar), pero mientras no haya
  // usuarios de Portal Transportista dados de alta para probar, backoffice
  // puede destrabarlo igualmente -- backoffice es quien manda internamente.
  const confirmMutation = useMutation({
    mutationFn: async () => (await api.patch(`/routes/${routeId}/status`, { status: "confirmed" })).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Ruta confirmada");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo confirmar la ruta"),
  });

  if (!routeId) return null;

  return (
    <Modal open={!!routeId} title="Gestionar ruta" onClose={onClose} wide>
      {routeQuery.isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {route && (
        <div className="space-y-5">
          <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-slate-800">
                {route.warehouse.name} · {new Date(route.routeDate).toLocaleDateString("es-ES")}
              </p>
              <p className="text-xs text-slate-500">
                {route.stops.length} paradas
                {route.loadPlan &&
                  ` · ${Math.round(route.loadPlan.weightOccupancyPct * 100)}% peso / ${Math.round(route.loadPlan.palletOccupancyPct * 100)}% palés`}
              </p>
            </div>
            <StatusBadge status={route.status} />
          </div>

          {LOCKED_STATUSES.includes(route.status) && (
            <p className="text-sm text-slate-500">
              Esta ruta ya está en manos del transportista/conductor (App Conductor o Portal Transportista) — no se gestiona
              desde aquí.
            </p>
          )}

          {!LOCKED_STATUSES.includes(route.status) && (
            <>
              {/* Paso 1: comparativa y elección de transportista */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-semibold text-slate-700">1. Transportista</p>
                  {route.status !== "confirmed" && (
                    <button
                      onClick={() => simulateMutation.mutate()}
                      disabled={simulateMutation.isPending || route.stops.length === 0}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                    >
                      {simulateMutation.isPending
                        ? "Comparando…"
                        : route.costSimulations.length > 0
                          ? "Volver a comparar"
                          : "Comparar transportistas"}
                    </button>
                  )}
                </div>

                {route.costSimulations.length === 0 && (
                  <p className="text-xs text-slate-400">Todavía no se ha comparado ningún transportista para esta ruta.</p>
                )}

                {route.costSimulations.length > 0 && (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {route.costSimulations.map((c) => (
                      <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                        <div>
                          <span className="font-medium text-slate-700">{c.carrier.legalName}</span>
                          <span className="text-slate-400 text-xs ml-2">{c.vehicleType?.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono text-slate-600">{Number(c.estimatedCost).toFixed(2)} €</span>
                          {c.isSelected ? (
                            <Chip color="teal">Seleccionado</Chip>
                          ) : (
                            route.status !== "confirmed" && (
                              <button
                                onClick={() => selectMutation.mutate(c.id)}
                                disabled={selectMutation.isPending}
                                className="text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-50"
                              >
                                Seleccionar
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {route.status !== "confirmed" && (
                  <div className="flex items-center gap-2 mt-2">
                    <select
                      value={manualCarrierId}
                      onChange={(e) => setManualCarrierId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">…o asigna un transportista directamente (sin comparar coste)</option>
                      {carriersQuery.data?.items.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.legalName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => manualAssignCarrierMutation.mutate(manualCarrierId)}
                      disabled={!manualCarrierId || manualAssignCarrierMutation.isPending}
                      className="text-xs font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg px-3 py-2 disabled:opacity-50"
                    >
                      Asignar
                    </button>
                  </div>
                )}
              </div>

              {/* Paso 2: vehículo del transportista ya elegido */}
              {route.carrier && (
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-2">2. Vehículo ({route.carrier.legalName})</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedVehicleId}
                      onChange={(e) => setSelectedVehicleId(e.target.value)}
                      disabled={route.status === "confirmed"}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-50"
                    >
                      <option value="">Selecciona…</option>
                      {vehiclesQuery.data?.items.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plate} — {v.vehicleType.name}
                        </option>
                      ))}
                    </select>
                    {route.status !== "confirmed" && (
                      <button
                        onClick={() => setVehicleMutation.mutate(selectedVehicleId)}
                        disabled={!selectedVehicleId || selectedVehicleId === route.vehicle?.id || setVehicleMutation.isPending}
                        className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-2 disabled:opacity-50"
                      >
                        Guardar
                      </button>
                    )}
                  </div>
                  {vehiclesQuery.data?.items.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">Este transportista no tiene vehículos dados de alta.</p>
                  )}
                </div>
              )}

              {/* Paso 3: conductor + creación del envío (lo que hace que la ruta
                  aparezca de verdad en Seguimiento y en la App Conductor) */}
              {route.carrier && route.vehicle && (
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-2">3. Conductor y envío</p>
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedDriverId}
                      onChange={(e) => setSelectedDriverId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      <option value="">Sin conductor todavía…</option>
                      {driversQuery.data?.items.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.fullName}
                        </option>
                      ))}
                    </select>
                    {!route.shipment && (
                      <button
                        onClick={() => createShipmentMutation.mutate()}
                        disabled={createShipmentMutation.isPending}
                        className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-2 disabled:opacity-50"
                      >
                        Crear envío
                      </button>
                    )}
                    {route.shipment && selectedDriverId !== (route.shipment.driverId ?? "") && (
                      <button
                        onClick={() => assignDriverMutation.mutate(selectedDriverId)}
                        disabled={!selectedDriverId || assignDriverMutation.isPending}
                        className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-2 disabled:opacity-50"
                      >
                        Guardar conductor
                      </button>
                    )}
                  </div>
                  {driversQuery.data?.items.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1">
                      Este transportista no tiene conductores dados de alta (Maestros → Flota y Transportistas → Conductores), ni por tanto
                      usuario de App Conductor (Maestros → Usuarios) — sin eso, nadie podrá ver esta ruta en el móvil.
                    </p>
                  )}
                  {route.shipment && (
                    <p className="text-xs text-slate-400 mt-1">
                      Envío ya creado (estado: {route.shipment.status}). Visible en Backoffice → Seguimiento
                      {route.shipment.driverId ? " y en la App Conductor del conductor asignado." : "; asígnale un conductor para que también aparezca en la App Conductor."}
                    </p>
                  )}
                </div>
              )}

              {/* Paso 4: confirmación manual, mientras no haya Portal Transportista en uso real */}
              {route.carrier && route.status === "assigned" && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    onClick={() => confirmMutation.mutate()}
                    disabled={confirmMutation.isPending}
                    className="text-xs font-medium text-white bg-slate-700 hover:bg-slate-800 rounded-lg px-3 py-2 disabled:opacity-50"
                  >
                    Marcar como confirmada (manual)
                  </button>
                  <p className="text-xs text-slate-400 mt-1">
                    En producción lo hace el transportista desde su Portal (aceptar/rechazar). Úsalo mientras pruebas sin un
                    usuario de Portal Transportista dado de alta.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
