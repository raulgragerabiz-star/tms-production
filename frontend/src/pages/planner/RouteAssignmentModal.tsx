import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";
import StatusBadge from "@/components/StatusBadge";
import Chip from "@/components/Chip";
import { viewDocumentPdf, downloadDocumentPdf } from "@/lib/document-pdf";

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
// confirmar manualmente.
//
// Fase 26 ("usuarios app" sub-fase 4): el Portal Transportista
// (apps/carrier-portal), que en su día iba a asumir el aceptar/rechazar de
// este último paso, se retiró por completo -- petición explícita de Raúl
// ("carece de sentido"), ver claude/fase26-retirada-portal-transportista.md.
// La confirmación manual de aquí deja de ser un paso provisional "mientras
// no haya Portal Transportista": es la vía definitiva.

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
  // Fase 8Y: transportista subcontratado por el carrier asignado, rellenable
  // por ruta -- ver comentario en Route.subcontractedCarrier* (schema.prisma).
  subcontractedCarrierName: string | null;
  subcontractedCarrierTaxId: string | null;
  subcontractedCarrierAddress: string | null;
  subcontractedCarrierPhone: string | null;
  loadPlan: { weightOccupancyPct: number; palletOccupancyPct: number; totalWeightKg: string; totalPallets: string } | null;
  stops: { id: string; order: { orderNumber: string; customer: { legalName: string } } }[];
  costSimulations: {
    id: string;
    estimatedCost: string;
    // Fase 14: beneficio de BigMat para este candidato (ver
    // rate-resolution.service.ts) -- `null` cuando la tarifa aplicada no
    // viene de circuito+vehículo, no un beneficio "0" inventado.
    estimatedMargin: string | null;
    isSelected: boolean;
    carrier: { id: string; legalName: string };
    vehicleType: { name: string } | null;
  }[];
  shipment: { id: string; status: string; driverId: string | null } | null;
}

// Fase 14: transportistas con capacidad suficiente para la ruta pero sin
// tarifa vigente resuelta (motivo real de "da error y no llega a mostrar
// lista de tte con costes" -- ver comentario en optimization.routes.ts).
// No se persisten como CostSimulation (no tienen coste), llegan solo en la
// respuesta de POST /simulate.
interface UnresolvedCandidate {
  carrierId: string;
  legalName: string;
  vehicleTypeId: string;
  reason: string;
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

// Estados en los que la ruta ya no se gestiona desde aquí: el conductor
// (App Conductor) lleva el resto.
const LOCKED_STATUSES = ["in_progress", "closed", "rejected"];

export default function RouteAssignmentModal({ routeId, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [manualCarrierId, setManualCarrierId] = useState("");
  const [showSubcontracted, setShowSubcontracted] = useState(false);
  const [subName, setSubName] = useState("");
  const [subTaxId, setSubTaxId] = useState("");
  const [subAddress, setSubAddress] = useState("");
  const [subPhone, setSubPhone] = useState("");
  // Fase 14: solo llega en la respuesta de la última comparativa (no se
  // persiste, ver UnresolvedCandidate) -- se pierde si se cierra el modal,
  // igual que el resto del estado local de este componente.
  const [unresolvedCandidates, setUnresolvedCandidates] = useState<UnresolvedCandidate[]>([]);
  const [noValidRateReason, setNoValidRateReason] = useState<string | null>(null);

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

  useEffect(() => {
    setSubName(route?.subcontractedCarrierName ?? "");
    setSubTaxId(route?.subcontractedCarrierTaxId ?? "");
    setSubAddress(route?.subcontractedCarrierAddress ?? "");
    setSubPhone(route?.subcontractedCarrierPhone ?? "");
    setShowSubcontracted(!!route?.subcontractedCarrierName);
  }, [route?.id, route?.subcontractedCarrierName, route?.subcontractedCarrierTaxId, route?.subcontractedCarrierAddress, route?.subcontractedCarrierPhone]);

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
      setUnresolvedCandidates(data.unresolvedCandidates ?? []);
      setNoValidRateReason(data.noValidRateReason ?? null);
      // Motor de inteligencia (3/3): si la empresa tiene activada la
      // auto-asignación (Configuración) y el mejor candidato superó el
      // umbral de confianza, /simulate ya lo ha asignado -- se refleja aquí
      // en vez de dejar que el usuario piense que hace falta elegir a mano.
      if (data.autoAssign?.autoAssigned) {
        const pct = Math.round((data.autoAssign.confidence ?? 0) * 100);
        onSuccess(
          `Comparativa generada (${data.candidates?.length ?? 0} candidatos) — transportista asignado automáticamente (confianza ${pct}%)`
        );
      } else if (data.candidates?.length === 0) {
        // Fase 14: antes esto era un error de red (HttpError.badRequest) --
        // ahora es una respuesta normal sin candidatos con coste, ver
        // `noValidRateReason`/`unresolvedCandidates` renderizados más abajo.
        onError(data.noValidRateReason ?? "Ningún transportista tiene tarifa vigente para esta ruta");
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

  // Fase 8Y: apartado rellenable por ruta -- corrección de Raúl, no es la
  // ficha permanente del transportista (Maestros → Flota y Transportistas).
  // Enviar los 4 campos vacíos limpia la subcontratación (el DeCA vuelve a
  // mostrar los datos del carrier asignado).
  const saveSubcontractedMutation = useMutation({
    // Acepta un override explícito (usado por "Quitar subcontratación") en vez
    // de leer siempre el estado del componente -- si se limpiara el estado y
    // se llamara a mutate() en el mismo tick, el closure de mutationFn seguiría
    // viendo los valores anteriores (React no re-renderiza de forma síncrona).
    mutationFn: async (override?: { name: string; taxId: string; address: string; phone: string }) =>
      (
        await api.patch(`/routes/${routeId}/subcontracted-carrier`, {
          subcontractedCarrierName: (override ? override.name : subName) || undefined,
          subcontractedCarrierTaxId: (override ? override.taxId : subTaxId) || undefined,
          subcontractedCarrierAddress: (override ? override.address : subAddress) || undefined,
          subcontractedCarrierPhone: (override ? override.phone : subPhone) || undefined,
        })
      ).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Guardado como borrador inicial del campo \"Transportista efectivo\" del DeCA — sigue siendo editable dentro del propio PDF");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo guardar el transportista subcontratado"),
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

  // Marcar como confirmada a mano: sin Portal Transportista (retirado en la
  // sub-fase 4 de "usuarios app"), backoffice es quien confirma siempre --
  // backoffice es quien manda internamente.
  const confirmMutation = useMutation({
    mutationFn: async () => (await api.patch(`/routes/${routeId}/status`, { status: "confirmed" })).data,
    onSuccess: () => {
      invalidateAll();
      onSuccess("Ruta confirmada");
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo confirmar la ruta"),
  });

  // Fase 8k: petición de Raúl -- "las rutas asignadas, también tienen que
  // poder borrarse si han tenido algún error. Las únicas que no deberían
  // poder borrarse son las que ya han sido entregadas a destino final". A
  // diferencia del resto de acciones de este modal, esta se ofrece también
  // cuando la ruta está "bloqueada" (LOCKED_STATUSES) -- justo el caso que
  // motivó la petición (rutas ya asignadas/confirmadas/en curso con algún
  // error), y se cierra el modal al terminar porque la ruta deja de existir.
  const deleteRouteMutation = useMutation({
    mutationFn: async () => api.delete(`/routes/${routeId}`),
    onSuccess: () => {
      invalidateAll();
      onSuccess("Ruta eliminada. Sus pedidos han vuelto a estar pendientes de planificar.");
      onClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "No se pudo eliminar la ruta"),
  });

  function handleDeleteRoute() {
    if (!route) return;
    const warning = route.shipment
      ? `¿Eliminar esta ruta (${route.stops.length} paradas)? Ya tiene un envío en curso: se borrarán también su seguimiento, incidencias y albaranes registrados hasta ahora. Sus pedidos volverán a estar pendientes de planificar. Esta acción no se puede deshacer.`
      : `¿Eliminar esta ruta (${route.stops.length} paradas)? Sus pedidos volverán a estar pendientes de planificar. Esta acción no se puede deshacer.`;
    if (window.confirm(warning)) deleteRouteMutation.mutate();
  }

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
            <div className="flex flex-col items-end gap-1.5">
              <StatusBadge status={route.status} />
              {/* Fase 8Q2: DeCA en PDF -- "control de mercancía por carretera
                  en modo virtual" pedido por Raúl; rediseñado por completo en
                  la Fase 8X (plantilla visual real, Orden FOM/2861/2012 · Ley
                  15/2009 LCTTM). Disponible en cuanto la ruta tiene paradas,
                  aunque todavía no tenga transportista/vehículo/conductor
                  asignado (el documento simplemente muestra "—" en lo que
                  falte). */}
              {route.stops.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => viewDocumentPdf(`/routes/${routeId}/documents/carriage-note.pdf`)}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Ver DeCA (PDF)
                  </button>
                  <button
                    onClick={() => downloadDocumentPdf(`/routes/${routeId}/documents/carriage-note.pdf`, `deca-${routeId?.slice(0, 8)}.pdf`)}
                    className="text-xs text-slate-400 hover:text-slate-600"
                  >
                    Descargar
                  </button>
                </div>
              )}
            </div>
          </div>

          {LOCKED_STATUSES.includes(route.status) && (
            <p className="text-sm text-slate-500">
              Esta ruta ya está en manos del conductor (App Conductor) — no se gestiona desde aquí.
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

                {route.costSimulations.length > 0 && (() => {
                  // Fase 14: "más rentable" = mayor beneficio de empresa
                  // calculable entre los candidatos -- mismo criterio de
                  // orden que aplica el backend (optimization.routes.ts).
                  const knownMargins = route.costSimulations
                    .map((c) => (c.estimatedMargin != null ? Number(c.estimatedMargin) : null))
                    .filter((m): m is number => m != null);
                  const bestMargin = knownMargins.length > 0 ? Math.max(...knownMargins) : null;
                  return (
                    <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {route.costSimulations.map((c) => {
                        const margin = c.estimatedMargin != null ? Number(c.estimatedMargin) : null;
                        const isMostProfitable = bestMargin != null && margin === bestMargin;
                        return (
                          <div key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
                            <div>
                              <span className="font-medium text-slate-700">{c.carrier.legalName}</span>
                              <span className="text-slate-400 text-xs ml-2">{c.vehicleType?.name}</span>
                              {isMostProfitable && <Chip color="teal">Más rentable</Chip>}
                            </div>
                            <div className="flex items-center gap-3">
                              <span className="text-right">
                                <span className="font-mono text-slate-600 block">{Number(c.estimatedCost).toFixed(2)} € coste</span>
                                <span className="font-mono text-xs block">
                                  {margin != null ? (
                                    <span className="text-emerald-600">{margin.toFixed(2)} € beneficio</span>
                                  ) : (
                                    <span className="text-slate-400">beneficio no calculable</span>
                                  )}
                                </span>
                              </span>
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
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Fase 14: transportistas con capacidad suficiente pero sin
                    tarifa vigente resuelta -- antes esto hacía fallar toda la
                    comparativa (bug reportado por Raúl), ahora se muestran
                    aquí con el motivo para poder revisarlo (p. ej. dar de
                    alta la tarifa del circuito que falta). */}
                {unresolvedCandidates.length > 0 && (
                  <div className="mt-2 border border-amber-200 bg-amber-50 rounded-lg divide-y divide-amber-100">
                    {noValidRateReason && <p className="text-xs text-amber-700 px-3 pt-2">{noValidRateReason}</p>}
                    {unresolvedCandidates.map((u) => (
                      <div key={`${u.carrierId}-${u.vehicleTypeId}`} className="px-3 py-2 text-sm">
                        <span className="font-medium text-amber-800">{u.legalName}</span>
                        <p className="text-xs text-amber-700">{u.reason}</p>
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

              {/* Fase 8Z: transportista subcontratado -- corrección de Raúl
                  sobre el diseño de la Fase 8Y: "Transportista efectivo" ya
                  no lo escribe Backoffice, es un campo de formulario real
                  dentro del propio PDF del DeCA (rellenable por la empresa
                  subcontratada, con cualquier lector de PDF). Este apartado
                  se mantiene solo como ayuda opcional: si se rellena aquí,
                  el campo del DeCA sale con estos datos como borrador inicial
                  -- pero sigue siendo editable dentro del propio documento,
                  esto nunca es la fuente final. Solo tiene sentido una vez
                  elegido un transportista. */}
              {route.carrier && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  {!showSubcontracted ? (
                    <button
                      onClick={() => setShowSubcontracted(true)}
                      className="text-xs font-medium text-amber-700 hover:text-amber-800"
                    >
                      + {route.carrier.legalName} subcontrata el transporte a otra empresa…
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-amber-800">
                        Transportista subcontratado por {route.carrier.legalName} (opcional)
                      </p>
                      <p className="text-xs text-amber-700">
                        Rellena esto solo si {route.carrier.legalName} no ejecuta el transporte él mismo, sino que lo
                        subcontrata a otra empresa. El DeCA de esta ruta traerá el nombre, CIF y dirección ya escritos
                        en las casillas correspondientes de "Transportista efectivo" -- las matrículas del vehículo
                        subcontratado y cualquier corrección quedan siempre editables dentro del propio PDF, así que
                        la empresa subcontratada puede completarlas o corregirlas ella misma al abrir el documento.
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="Nombre / razón social">
                          <input
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                            value={subName}
                            onChange={(e) => setSubName(e.target.value)}
                            placeholder="Empresa subcontratada"
                          />
                        </Field>
                        <Field label="CIF">
                          <input
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                            value={subTaxId}
                            onChange={(e) => setSubTaxId(e.target.value)}
                          />
                        </Field>
                        <Field label="Dirección">
                          <input
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                            value={subAddress}
                            onChange={(e) => setSubAddress(e.target.value)}
                          />
                        </Field>
                        <Field label="Teléfono" hint="Uso interno -- no sale impreso en el DeCA">
                          <input
                            className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm"
                            value={subPhone}
                            onChange={(e) => setSubPhone(e.target.value)}
                          />
                        </Field>
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          onClick={() => saveSubcontractedMutation.mutate()}
                          disabled={!subName.trim() || saveSubcontractedMutation.isPending}
                          className="text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg px-3 py-1.5 disabled:opacity-50"
                        >
                          Guardar
                        </button>
                        {route.subcontractedCarrierName && (
                          <button
                            onClick={() => {
                              saveSubcontractedMutation.mutate({ name: "", taxId: "", address: "", phone: "" });
                              setSubName("");
                              setSubTaxId("");
                              setSubAddress("");
                              setSubPhone("");
                              setShowSubcontracted(false);
                            }}
                            className="text-xs font-medium text-red-500 hover:text-red-600"
                          >
                            Quitar subcontratación
                          </button>
                        )}
                        {!route.subcontractedCarrierName && (
                          <button onClick={() => setShowSubcontracted(false)} className="text-xs text-slate-500 hover:text-slate-600">
                            Cancelar
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

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

              {/* Paso 4: confirmación manual (vía definitiva -- ver comentario de cabecera) */}
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
                    Confirmación manual desde Backoffice -- el transportista no tiene ningún portal propio para
                    aceptar/rechazar rutas.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Fase 8k: eliminar ruta -- disponible siempre (incluso bloqueada
              por LOCKED_STATUSES) salvo que el envío ya esté "finished"
              (entregado a destino final), ver comentario en la mutación. */}
          {route.shipment?.status !== "finished" && (
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                onClick={handleDeleteRoute}
                disabled={deleteRouteMutation.isPending}
                className="text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                Eliminar ruta
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
