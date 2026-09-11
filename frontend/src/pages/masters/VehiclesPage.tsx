import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Chip from "@/components/Chip";
import { useToast } from "@/hooks/use-toast";
import NewDriverModal from "@/pages/masters/DriversModal";

// Fase 8Q: características que faltaban de la ficha del vehículo (MMA, peso
// útil, etiqueta ambiental, radio de acción, equipamiento especial) --
// petición de Raúl para "completar la BD de vehículos" y que dejen de ser
// datos sueltos, conectándolas al motor de compatibilidad (ver
// optimization.routes.ts en el backend). Todos opcionales/con valor por
// defecto para no romper los vehículos ya dados de alta.
type EmissionsLabel = "sin_etiqueta" | "b" | "c" | "eco" | "cero_emisiones";

interface VehicleRow {
  id: string;
  plate: string;
  trailerPlate: string | null;
  workingTemperature: "ambient" | "refrigerated" | "frozen" | "mixed";
  mmaKg: string | null;
  usefulWeightKg: string | null;
  emissionsLabel: EmissionsLabel | null;
  actionRadiusKm: string | null;
  hasAdr: boolean;
  hasCrane: boolean;
  hasLiftgate: boolean;
  vehicleType: { name: string; maxWeightKg: string; maxPallets: number; allowsExceedingPallets: boolean };
  carrier: { legalName: string };
  active: boolean;
}

const emissionsLabelOptions: { value: EmissionsLabel; label: string }[] = [
  { value: "sin_etiqueta", label: "Sin distintivo" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
  { value: "eco", label: "ECO" },
  { value: "cero_emisiones", label: "0 emisiones" },
];

interface DriverRow {
  id: string;
  carrierId: string;
  fullName: string;
  taxId: string;
  phone: string | null;
  active: boolean;
  carrier: { legalName: string };
  // Fase 8j: vehículo al que pertenece el conductor (asignación vigente),
  // para poder gestionarlo -- matrícula y QR -- desde la propia fila, sin
  // pasar por una pestaña "Vehículos" aparte (ver comentario en
  // vehicles.routes.ts GET /drivers).
  vehicle: { id: string; plate: string } | null;
  // Fase 8Q: horario laboral PROGRAMADO/habitual del conductor ("HH:mm"),
  // distinto de `maxRouteDurationHours` (tope de duración total de una
  // ruta, ya existente en Warehouse/Carrier) -- ver comentario en
  // Driver.usualShiftStartTime/EndTime en schema.prisma.
  usualShiftStartTime: string | null;
  usualShiftEndTime: string | null;
}

// QR de conductor + jornada: turnos abiertos ahora mismo, para que despacho
// vea quién está de turno y con qué vehículo sin preguntar por teléfono.
interface ActiveShiftRow {
  id: string;
  startedAt: string;
  driver: { id: string; fullName: string };
  vehicle: { plate: string } | null;
}

interface VehicleTypeRow {
  id: string;
  name: string;
  maxWeightKg: string;
  maxPallets: number;
  maxVolumeM3: string | null;
  lengthM: string | null;
  widthM: string | null;
  heightM: string | null;
}

// 2026-09-09: "embedded" -- se usa desde el nuevo "Flota y Transportistas",
// donde el tab activo (Vehículos/Conductores/Tipo de vehículo) lo decide la
// barra de pestañas única de esa pantalla, no esta. Con `embedded`, esta
// página deja de dibujar su propio título y su propia barra de pestañas, y
// usa el `activeTab` que le pasan en vez de su estado interno. Sin `embedded`
// (uso independiente, por si algún sitio la sigue montando suelta) el
// comportamiento no cambia en absoluto -- mismo título, mismas 3 pestañas
// propias, mismo estado interno de siempre.
interface Props {
  embedded?: boolean;
  activeTab?: "vehicles" | "drivers" | "types";
}

// Fase 8Q: aviso de "jornada más larga de lo habitual" -- ayuda visual para
// detectar posibles excesos de tacógrafo, NUNCA un cálculo legal exacto de
// la normativa de tiempos de conducción/descanso (eso exigiría datos que
// este TMS no registra, como pausas o kilometraje real). Compara la
// duración transcurrida de la jornada REAL abierta (DriverShift.startedAt)
// contra la duración del horario habitual configurado para el conductor. Si
// el conductor no tiene horario habitual configurado, no se muestra ningún
// aviso -- mismo criterio permisivo que el resto de campos opcionales.
function shiftExceedsUsualHours(
  startedAt: string,
  usualShiftStartTime: string | null,
  usualShiftEndTime: string | null
): boolean {
  if (!usualShiftStartTime || !usualShiftEndTime) return false;

  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const startMin = toMinutes(usualShiftStartTime);
  const endMin = toMinutes(usualShiftEndTime);
  // Turno habitual que cruza medianoche (p.ej. 22:00-06:00): duración en
  // minutos "envuelta" sobre 24h.
  const usualDurationMin = endMin > startMin ? endMin - startMin : 24 * 60 - startMin + endMin;

  const elapsedMin = (Date.now() - new Date(startedAt).getTime()) / 60000;
  return elapsedMin > usualDurationMin;
}

export default function VehiclesPage({ embedded = false, activeTab }: Props) {
  const [internalTab, setInternalTab] = useState<"vehicles" | "drivers" | "types">("vehicles");
  const tab = embedded && activeTab ? activeTab : internalTab;
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [qrVehicleId, setQrVehicleId] = useState<string | null>(null);
  // Fase 8j: reasignar/asignar el vehículo de un conductor directamente
  // desde su fila en "Conductores" -- ver comentario en DriverVehicleCell.
  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  // Fase 8Q: edición de la ficha completa del vehículo (MMA, peso útil,
  // etiqueta ambiental, radio de acción, equipamiento) y del conductor
  // (datos personales + horario laboral habitual) -- hasta ahora ninguno de
  // los dos se podía editar una vez creado, salvo matrícula/tipo (vehículo)
  // o activo/inactivo (conductor).
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => (await api.get("/vehicles")).data as { items: VehicleRow[]; total: number },
    // Fase 8j: también hace falta en "drivers" -- la columna "Vehículo" de
    // Conductores necesita la lista de matrículas ya dadas de alta por
    // transportista para poder asignarlas desde ahí.
    enabled: tab === "vehicles" || tab === "drivers",
  });

  const driversQuery = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => (await api.get("/vehicles/drivers")).data as { items: DriverRow[]; total: number },
  });

  // QR de conductor + jornada: turnos abiertos ahora, solo se consulta en la
  // pestaña de Conductores (donde se muestran).
  const activeShiftsQuery = useQuery({
    queryKey: ["active-shifts"],
    queryFn: async () => (await api.get("/vehicles/drivers/shifts/active")).data as { items: ActiveShiftRow[] },
    enabled: tab === "drivers",
    refetchInterval: tab === "drivers" ? 30000 : false,
  });
  const activeShiftByDriverId = new Map(activeShiftsQuery.data?.items.map((s) => [s.driver.id, s]) ?? []);

  const qrTokenQuery = useQuery({
    queryKey: ["vehicle-qr-token", qrVehicleId],
    queryFn: async () => (await api.get(`/vehicles/${qrVehicleId}/qr-token`)).data as { token: string | null },
    enabled: !!qrVehicleId,
  });

  const issueQrMutation = useMutation({
    mutationFn: async (vehicleId: string) => (await api.post(`/vehicles/${vehicleId}/qr-token`)).data as { token: string },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vehicle-qr-token", qrVehicleId] }),
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo generar el QR"),
  });

  // Objetivo 2: capacidad por volumen y dimensiones de cada tipo de vehículo.
  // Fase 8j: también hace falta en "drivers" para poder dar de alta una
  // matrícula nueva directamente desde la fila del conductor.
  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeRow[]; total: number },
    enabled: tab === "types" || tab === "drivers",
  });

  const updateVehicleTypeMutation = useMutation({
    mutationFn: async (payload: { id: string; maxPallets?: number; maxVolumeM3?: number; lengthM?: number; widthM?: number; heightM?: number }) => {
      const { id, ...rest } = payload;
      return (await api.patch(`/vehicles/types/${id}`, rest)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicle-types"] });
    },
    onError: (err: any) => {
      showError(err?.response?.data?.message ?? "No se pudo guardar el cambio");
      queryClient.invalidateQueries({ queryKey: ["vehicle-types"] });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ vehicleId, driverId }: { vehicleId: string; driverId: string }) =>
      (await api.post(`/vehicles/${vehicleId}/assign-driver`, { driverId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      showSuccess("Conductor asignado correctamente");
      setAssigningVehicleId(null);
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo asignar el conductor"),
  });

  // Fase 8j: mismo endpoint que assignMutation (POST /vehicles/:id/assign-driver),
  // pero disparado desde la fila del CONDUCTOR en vez de la del vehículo --
  // es la asignación inversa, para la nueva columna "Vehículo" de Conductores.
  const assignVehicleToDriverMutation = useMutation({
    mutationFn: async ({ vehicleId, driverId }: { vehicleId: string; driverId: string }) =>
      (await api.post(`/vehicles/${vehicleId}/assign-driver`, { driverId })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      showSuccess("Vehículo asignado correctamente");
      setAssigningDriverId(null);
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo asignar el vehículo"),
  });

  // Da de alta una matrícula nueva para el transportista del conductor y se
  // la asigna en el mismo paso -- para cuando el transportista todavía no
  // tiene ninguna matrícula dada de alta.
  const createVehicleAndAssignMutation = useMutation({
    mutationFn: async ({
      carrierId,
      vehicleTypeId,
      plate,
      driverId,
    }: {
      carrierId: string;
      vehicleTypeId: string;
      plate: string;
      driverId: string;
    }) => {
      const vehicle = (await api.post("/vehicles", { carrierId, vehicleTypeId, plate })).data as { id: string };
      await api.post(`/vehicles/${vehicle.id}/assign-driver`, { driverId });
      return vehicle;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      showSuccess("Vehículo dado de alta y asignado correctamente");
      setAssigningDriverId(null);
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo dar de alta el vehículo"),
  });

  // Fase 8Q: edición de la ficha completa del vehículo -- hasta ahora solo se
  // podía fijar matrícula/tipo al crearlo, sin forma de completar el resto
  // de características (MMA, peso útil, etiqueta ambiental, radio de acción,
  // temperatura de trabajo, equipamiento) desde ningún sitio.
  const updateVehicleMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      workingTemperature?: string;
      mmaKg?: number | null;
      usefulWeightKg?: number | null;
      emissionsLabel?: string | null;
      actionRadiusKm?: number | null;
      hasAdr?: boolean;
      hasCrane?: boolean;
      hasLiftgate?: boolean;
    }) => {
      const { id, ...rest } = payload;
      return (await api.put(`/vehicles/${id}`, rest)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      showSuccess("Vehículo actualizado correctamente");
      setEditingVehicleId(null);
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo guardar el vehículo"),
  });

  // Fase 8Q: edición general del conductor (antes solo existía dar de alta o
  // activar/desactivar) -- datos personales + horario laboral habitual.
  const updateDriverMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      fullName?: string;
      taxId?: string;
      phone?: string;
      usualShiftStartTime?: string | null;
      usualShiftEndTime?: string | null;
    }) => {
      const { id, ...rest } = payload;
      return (await api.patch(`/vehicles/drivers/${id}`, rest)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      showSuccess("Conductor actualizado correctamente");
      setEditingDriverId(null);
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo guardar el conductor"),
  });

  // Fase 8j: "Desactivar/Reactivar" y "Eliminar" de verdad para conductores --
  // hasta ahora un conductor creado por error no se podía ni desactivar ni
  // quitar de la lista. Mismo patrón ya usado en Usuarios (UsersPage.tsx).
  const toggleDriverActiveMutation = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) =>
      (await api.patch(`/vehicles/drivers/${id}/active`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["drivers"] }),
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo actualizar el conductor"),
  });

  const deleteDriverMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/vehicles/drivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      showSuccess("Conductor eliminado");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo eliminar el conductor"),
  });

  function handleDeleteDriver(d: DriverRow) {
    if (window.confirm(`¿Eliminar definitivamente al conductor "${d.fullName}"? Esta acción no se puede deshacer.`)) {
      deleteDriverMutation.mutate(d.id);
    }
  }

  return (
    <div>
      {!embedded && (
        <>
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl font-semibold text-slate-900">Flota</h1>
            {tab === "drivers" && (
              <button
                onClick={() => setDriverModalOpen(true)}
                className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
              >
                + Nuevo conductor
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-4">Vehículos y conductores de la flota subcontratada.</p>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setInternalTab("vehicles")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "vehicles" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
            >
              Vehículos
            </button>
            <button
              onClick={() => setInternalTab("drivers")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "drivers" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
            >
              Conductores
            </button>
            <button
              onClick={() => setInternalTab("types")}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "types" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
            >
              Tipos de vehículo
            </button>
          </div>
        </>
      )}

      {embedded && tab === "drivers" && (
        <div className="flex justify-end mb-3">
          <button
            onClick={() => setDriverModalOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nuevo conductor
          </button>
        </div>
      )}

      {tab === "vehicles" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Matrícula</th>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-right px-4 py-3">Cap. peso (kg)</th>
                <th className="text-right px-4 py-3">Cap. palés</th>
                <th className="text-left px-4 py-3">Admite superar palés</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Conductor</th>
                <th className="text-left px-4 py-3">QR vehículo</th>
                <th className="text-left px-4 py-3">Ficha</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehiclesQuery.isLoading && (
                <tr>
                  <td colSpan={10} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {vehiclesQuery.data?.items.map((v) => (
                <tr key={v.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3 font-mono font-semibold text-xs">{v.plate}</td>
                  <td className="px-4 py-3">{v.carrier.legalName}</td>
                  <td className="px-4 py-3">{v.vehicleType.name}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(v.vehicleType.maxWeightKg).toLocaleString("es-ES")}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{v.vehicleType.maxPallets}</td>
                  <td className="px-4 py-3">{v.vehicleType.allowsExceedingPallets ? "Sí" : "No"}</td>
                  <td className="px-4 py-3">
                    <Chip color={v.active ? "teal" : "slate"}>{v.active ? "Activo" : "Baja"}</Chip>
                  </td>
                  <td className="px-4 py-3">
                    {assigningVehicleId === v.id ? (
                      <select
                        autoFocus
                        className="text-xs rounded-lg border border-slate-300 px-2 py-1"
                        onChange={(e) => {
                          if (e.target.value) assignMutation.mutate({ vehicleId: v.id, driverId: e.target.value });
                        }}
                        onBlur={() => setAssigningVehicleId(null)}
                      >
                        <option value="">Selecciona conductor…</option>
                        {driversQuery.data?.items
                          .filter((d) => d.carrier.legalName === v.carrier.legalName)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.fullName}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <button onClick={() => setAssigningVehicleId(v.id)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                        Asignar conductor
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setQrVehicleId(v.id)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                      Ver / generar QR
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setEditingVehicleId(v.id)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                      Editar ficha
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "drivers" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">NIF</th>
                <th className="text-left px-4 py-3">Teléfono</th>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Vehículo</th>
                <th className="text-left px-4 py-3">Estado</th>
                {/* Fase 8Q: horario laboral habitual del conductor -- ver
                    comentario en Driver.usualShiftStartTime/EndTime. */}
                <th className="text-left px-4 py-3">Horario habitual</th>
                <th className="text-left px-4 py-3">Jornada</th>
                <th className="text-left px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {driversQuery.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {!driversQuery.isLoading && driversQuery.data?.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">Sin conductores registrados.</td>
                </tr>
              )}
              {driversQuery.data?.items.map((d) => {
                const shift = activeShiftByDriverId.get(d.id);
                return (
                  <tr key={d.id} className="hover:bg-brand-50/60">
                    <td className="px-4 py-3 font-medium">{d.fullName}</td>
                    <td className="px-4 py-3 font-mono font-semibold text-xs">{d.taxId}</td>
                    <td className="px-4 py-3 text-slate-500">{d.phone ?? "—"}</td>
                    <td className="px-4 py-3">{d.carrier.legalName}</td>
                    <td className="px-4 py-3">
                      <DriverVehicleCell
                        driver={d}
                        vehicles={vehiclesQuery.data?.items ?? []}
                        vehicleTypes={vehicleTypesQuery.data?.items ?? []}
                        assigning={assigningDriverId === d.id}
                        onStartAssign={() => setAssigningDriverId(d.id)}
                        onCancelAssign={() => setAssigningDriverId(null)}
                        onAssignExisting={(vehicleId) => assignVehicleToDriverMutation.mutate({ vehicleId, driverId: d.id })}
                        onCreateAndAssign={(plate, vehicleTypeId) =>
                          createVehicleAndAssignMutation.mutate({ carrierId: d.carrierId, vehicleTypeId, plate, driverId: d.id })
                        }
                        onShowQr={() => setQrVehicleId(d.vehicle!.id)}
                        // Fase 8Q (fix): la pestaña "Vehículos" de esta misma
                        // página no se monta desde ningún sitio -- Raúl pidió
                        // quitarla en Fase 8 (ver comentario en
                        // CarrierFleetPage.tsx) -- así que la "Ficha" del
                        // vehículo (MMA, ADR, grúa, plataforma, etc.) tiene
                        // que abrirse desde aquí, igual que ya se hace con el
                        // QR, en vez de desde una pestaña que nunca se ve.
                        onEditVehicle={() => setEditingVehicleId(d.vehicle!.id)}
                        busy={assignVehicleToDriverMutation.isPending || createVehicleAndAssignMutation.isPending}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <Chip color={d.active ? "teal" : "slate"}>{d.active ? "Activo" : "Baja"}</Chip>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                      {d.usualShiftStartTime && d.usualShiftEndTime
                        ? `${d.usualShiftStartTime} – ${d.usualShiftEndTime}`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {shift ? (
                        <div className="flex flex-col gap-1">
                          <Chip color="teal">
                            {`En turno desde ${new Date(shift.startedAt).toLocaleTimeString("es-ES", {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}${shift.vehicle?.plate ? ` · ${shift.vehicle.plate}` : ""}`}
                          </Chip>
                          {shiftExceedsUsualHours(shift.startedAt, d.usualShiftStartTime, d.usualShiftEndTime) && (
                            <Chip color="amber">Jornada más larga de lo habitual</Chip>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">Sin jornada abierta</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button
                        onClick={() => setEditingDriverId(d.id)}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => toggleDriverActiveMutation.mutate({ id: d.id, active: !d.active })}
                        className="text-xs text-red-500 hover:text-red-600 font-medium mr-3"
                      >
                        {d.active ? "Desactivar" : "Reactivar"}
                      </button>
                      <button onClick={() => handleDeleteDriver(d)} className="text-xs text-red-700 hover:text-red-800 font-semibold">
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {tab === "types" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-right px-4 py-3">Cap. peso (kg)</th>
                <th className="text-left px-4 py-3">Cap. palés</th>
                <th className="text-left px-4 py-3">Volumen (m³)</th>
                <th className="text-left px-4 py-3">Largo (m)</th>
                <th className="text-left px-4 py-3">Ancho (m)</th>
                <th className="text-left px-4 py-3">Alto (m)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehicleTypesQuery.isLoading && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {vehicleTypesQuery.data?.items.map((vt) => (
                <VehicleTypeTableRow
                  key={vt.id}
                  vehicleType={vt}
                  onSave={(patch) => updateVehicleTypeMutation.mutate({ id: vt.id, ...patch })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewDriverModal open={driverModalOpen} onClose={() => setDriverModalOpen(false)} onSuccess={showSuccess} onError={showError} />

      {editingVehicleId && (
        <VehicleEditModal
          vehicle={vehiclesQuery.data?.items.find((v) => v.id === editingVehicleId) ?? null}
          saving={updateVehicleMutation.isPending}
          onClose={() => setEditingVehicleId(null)}
          onSave={(patch) => updateVehicleMutation.mutate({ id: editingVehicleId, ...patch })}
        />
      )}

      {editingDriverId && (
        <DriverEditModal
          driver={driversQuery.data?.items.find((d) => d.id === editingDriverId) ?? null}
          saving={updateDriverMutation.isPending}
          onClose={() => setEditingDriverId(null)}
          onSave={(patch) => updateDriverMutation.mutate({ id: editingDriverId, ...patch })}
        />
      )}

      {qrVehicleId && (
        <VehicleQrModal
          plate={vehiclesQuery.data?.items.find((v) => v.id === qrVehicleId)?.plate ?? ""}
          token={qrTokenQuery.data?.token ?? null}
          loading={qrTokenQuery.isLoading}
          generating={issueQrMutation.isPending}
          onGenerate={() => issueQrMutation.mutate(qrVehicleId)}
          onClose={() => setQrVehicleId(null)}
        />
      )}

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}

// Fase 8j: columna "Vehículo" de la pestaña Conductores -- petición de Raúl
// de gestionar matrícula + QR del conductor desde su propia fila, sin una
// pestaña "Vehículos" aparte. Tres estados: sin vehículo asignado (botón
// "Asignar vehículo"); con vehículo (matrícula + "QR" + "Cambiar"); en modo
// asignación (desplegable con las matrículas ya dadas de alta para ese
// transportista, o "+ Matrícula nueva" para dar de alta una en el momento).
function DriverVehicleCell({
  driver,
  vehicles,
  vehicleTypes,
  assigning,
  onStartAssign,
  onCancelAssign,
  onAssignExisting,
  onCreateAndAssign,
  onShowQr,
  onEditVehicle,
  busy,
}: {
  driver: DriverRow;
  vehicles: VehicleRow[];
  vehicleTypes: VehicleTypeRow[];
  assigning: boolean;
  onStartAssign: () => void;
  onCancelAssign: () => void;
  onAssignExisting: (vehicleId: string) => void;
  onCreateAndAssign: (plate: string, vehicleTypeId: string) => void;
  onShowQr: () => void;
  onEditVehicle: () => void;
  busy: boolean;
}) {
  const [creatingNew, setCreatingNew] = useState(false);
  const [newPlate, setNewPlate] = useState("");
  const [newVehicleTypeId, setNewVehicleTypeId] = useState("");

  const carrierVehicles = vehicles.filter((v) => v.carrier.legalName === driver.carrier.legalName);

  if (!assigning) {
    if (driver.vehicle) {
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-slate-700">{driver.vehicle.plate}</span>
          <button onClick={onEditVehicle} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
            Ficha
          </button>
          <button onClick={onShowQr} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
            QR
          </button>
          <button onClick={onStartAssign} className="text-xs text-slate-400 hover:text-slate-600">
            Cambiar
          </button>
        </div>
      );
    }
    return (
      <button onClick={onStartAssign} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
        Asignar vehículo
      </button>
    );
  }

  if (creatingNew) {
    return (
      <div className="flex flex-col gap-1.5 min-w-[220px]">
        <div className="flex gap-1.5">
          <input
            autoFocus
            placeholder="Matrícula"
            value={newPlate}
            onChange={(e) => setNewPlate(e.target.value)}
            className="w-24 text-xs rounded-lg border border-slate-300 px-2 py-1"
          />
          <select
            value={newVehicleTypeId}
            onChange={(e) => setNewVehicleTypeId(e.target.value)}
            className="flex-1 text-xs rounded-lg border border-slate-300 px-2 py-1"
          >
            <option value="">Tipo…</option>
            {vehicleTypes.map((vt) => (
              <option key={vt.id} value={vt.id}>
                {vt.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            disabled={!newPlate.trim() || !newVehicleTypeId || busy}
            onClick={() => onCreateAndAssign(newPlate.trim(), newVehicleTypeId)}
            className="text-xs font-medium text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-2 py-1 disabled:opacity-50"
          >
            Crear y asignar
          </button>
          <button
            onClick={() => {
              setCreatingNew(false);
              onCancelAssign();
            }}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <select
        autoFocus
        disabled={busy}
        className="text-xs rounded-lg border border-slate-300 px-2 py-1"
        defaultValue=""
        onChange={(e) => {
          if (e.target.value === "__new__") {
            // Ojo: NO se cancela en onBlur aquí a propósito -- elegir esta
            // opción dispara un blur del <select> justo antes de que React
            // pinte el formulario de alta rápida, y cancelar en ese momento
            // cerraría la fila de golpe sin dar tiempo a verlo. Por eso el
            // "Cancelar" es un botón aparte en vez de onBlur.
            setCreatingNew(true);
          } else if (e.target.value) {
            onAssignExisting(e.target.value);
          }
        }}
      >
        <option value="">Selecciona vehículo…</option>
        {carrierVehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.plate} — {v.vehicleType.name}
          </option>
        ))}
        <option value="__new__">+ Matrícula nueva…</option>
      </select>
      <button onClick={onCancelAssign} className="text-xs text-slate-400 hover:text-slate-600">
        Cancelar
      </button>
    </div>
  );
}

// QR de conductor + jornada: el token es lo que se codifica en el QR físico
// que se pega en la cabina del vehículo. La imagen se genera con un servicio
// gratuito sin API key (api.qrserver.com) -- misma filosofía que Leaflet/OSM
// para el mapa: sin coste ni credenciales que gestionar. Si el servicio no
// estuviera disponible, el token en texto sigue sirviendo (se puede teclear
// a mano en la App Conductor si hiciera falta).
function VehicleQrModal({
  plate,
  token,
  loading,
  generating,
  onGenerate,
  onClose,
}: {
  plate: string;
  token: string | null;
  loading: boolean;
  generating: boolean;
  onGenerate: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">QR del vehículo {plate}</h3>
        <p className="text-xs text-slate-500 mb-4">
          El conductor lo escanea desde la App al iniciar jornada para vincular este vehículo.
        </p>

        {loading && <p className="text-sm text-slate-400 py-8">Cargando…</p>}

        {!loading && token && (
          <>
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(token)}`}
              alt={`Código QR del vehículo ${plate}`}
              className="mx-auto rounded-lg border border-slate-200"
              width={220}
              height={220}
            />
            <p className="text-[10px] font-mono text-slate-400 mt-3 break-all">{token}</p>
          </>
        )}

        {!loading && !token && <p className="text-sm text-slate-400 py-6">Este vehículo todavía no tiene un QR generado.</p>}

        <div className="flex gap-2 mt-5">
          <button
            onClick={onGenerate}
            disabled={generating}
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

const editInputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

// Fase 8Q: "completar la BD de vehículos" (petición de Raúl) -- hasta ahora
// solo se podían fijar matrícula y tipo al dar de alta un vehículo, sin
// forma de editar el resto de su ficha. Formulario único con las
// características nuevas; matrícula/transportista/tipo se muestran como
// referencia (de solo lectura aquí) porque cambiarlos tiene implicaciones
// que no forman parte de este formulario (reasignación de transportista,
// etc.) y ya se gestionan desde otros flujos existentes.
function VehicleEditModal({
  vehicle,
  saving,
  onClose,
  onSave,
}: {
  vehicle: VehicleRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: {
    workingTemperature?: string;
    mmaKg?: number | null;
    usefulWeightKg?: number | null;
    emissionsLabel?: string | null;
    actionRadiusKm?: number | null;
    hasAdr?: boolean;
    hasCrane?: boolean;
    hasLiftgate?: boolean;
  }) => void;
}) {
  const [workingTemperature, setWorkingTemperature] = useState<string>(vehicle?.workingTemperature ?? "ambient");
  const [mmaKg, setMmaKg] = useState(vehicle?.mmaKg ?? "");
  const [usefulWeightKg, setUsefulWeightKg] = useState(vehicle?.usefulWeightKg ?? "");
  const [emissionsLabel, setEmissionsLabel] = useState<EmissionsLabel | "">(vehicle?.emissionsLabel ?? "");
  const [actionRadiusKm, setActionRadiusKm] = useState(vehicle?.actionRadiusKm ?? "");
  const [hasAdr, setHasAdr] = useState(vehicle?.hasAdr ?? false);
  const [hasCrane, setHasCrane] = useState(vehicle?.hasCrane ?? false);
  const [hasLiftgate, setHasLiftgate] = useState(vehicle?.hasLiftgate ?? false);

  if (!vehicle) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Ficha del vehículo {vehicle.plate}</h3>
        <p className="text-xs text-slate-500 mb-4">
          {vehicle.carrier.legalName} · {vehicle.vehicleType.name}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Temperatura de trabajo</label>
            <select className={editInputCls} value={workingTemperature} onChange={(e) => setWorkingTemperature(e.target.value)}>
              <option value="ambient">Ambiente</option>
              <option value="refrigerated">Refrigerado</option>
              <option value="frozen">Congelado</option>
              <option value="mixed">Mixto</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">MMA (kg)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={editInputCls}
                value={mmaKg}
                onChange={(e) => setMmaKg(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Peso útil (kg)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={editInputCls}
                value={usefulWeightKg}
                onChange={(e) => setUsefulWeightKg(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Etiqueta ambiental</label>
              <select
                className={editInputCls}
                value={emissionsLabel}
                onChange={(e) => setEmissionsLabel(e.target.value as EmissionsLabel | "")}
              >
                <option value="">Sin especificar</option>
                {emissionsLabelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Radio de acción (km)</label>
              <input
                type="number"
                min="0"
                step="1"
                className={editInputCls}
                value={actionRadiusKm}
                onChange={(e) => setActionRadiusKm(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Equipamiento especial</label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={hasAdr} onChange={(e) => setHasAdr(e.target.checked)} className="rounded border-slate-300" />
                ADR
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={hasCrane}
                  onChange={(e) => setHasCrane(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Grúa
              </label>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={hasLiftgate}
                  onChange={(e) => setHasLiftgate(e.target.checked)}
                  className="rounded border-slate-300"
                />
                Plataforma elevadora
              </label>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            disabled={saving}
            onClick={() =>
              onSave({
                workingTemperature,
                mmaKg: mmaKg === "" ? null : Number(mmaKg),
                usefulWeightKg: usefulWeightKg === "" ? null : Number(usefulWeightKg),
                emissionsLabel: emissionsLabel === "" ? null : emissionsLabel,
                actionRadiusKm: actionRadiusKm === "" ? null : Number(actionRadiusKm),
                hasAdr,
                hasCrane,
                hasLiftgate,
              })
            }
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Fase 8Q: edición general del conductor -- hasta ahora solo existía dar de
// alta o activar/desactivar (ver comentario en el nuevo endpoint PATCH
// /drivers/:id en vehicles.routes.ts). Incluye el horario laboral habitual,
// que el frontend usa para avisar de jornadas más largas de lo normal (ver
// shiftExceedsUsualHours).
function DriverEditModal({
  driver,
  saving,
  onClose,
  onSave,
}: {
  driver: DriverRow | null;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: {
    fullName?: string;
    taxId?: string;
    phone?: string;
    usualShiftStartTime?: string | null;
    usualShiftEndTime?: string | null;
  }) => void;
}) {
  const [fullName, setFullName] = useState(driver?.fullName ?? "");
  const [taxId, setTaxId] = useState(driver?.taxId ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [usualShiftStartTime, setUsualShiftStartTime] = useState(driver?.usualShiftStartTime ?? "");
  const [usualShiftEndTime, setUsualShiftEndTime] = useState(driver?.usualShiftEndTime ?? "");

  if (!driver) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Editar conductor</h3>
        <p className="text-xs text-slate-500 mb-4">{driver.carrier.legalName}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nombre completo</label>
            <input className={editInputCls} value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">NIF</label>
              <input className={editInputCls} value={taxId} onChange={(e) => setTaxId(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
              <input className={editInputCls} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Horario laboral habitual</label>
            <p className="text-[11px] text-slate-400 mb-1.5">
              Turno habitual de este conductor -- se usa solo para avisar si una jornada real se alarga más de lo
              normal (posible exceso de tacógrafo). No limita ni bloquea ninguna ruta.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <input
                type="time"
                className={editInputCls}
                value={usualShiftStartTime}
                onChange={(e) => setUsualShiftStartTime(e.target.value)}
              />
              <input
                type="time"
                className={editInputCls}
                value={usualShiftEndTime}
                onChange={(e) => setUsualShiftEndTime(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            disabled={saving || !fullName.trim() || !taxId.trim()}
            onClick={() =>
              onSave({
                fullName: fullName.trim(),
                taxId: taxId.trim(),
                phone: phone.trim() || undefined,
                usualShiftStartTime: usualShiftStartTime || null,
                usualShiftEndTime: usualShiftEndTime || null,
              })
            }
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const typeCellCls = "w-24 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

// Igual patrón que la tabla de zonas de influencia: cada celda se guarda sola
// al perder el foco, sin modal aparte.
function VehicleTypeTableRow({
  vehicleType,
  onSave,
}: {
  vehicleType: VehicleTypeRow;
  onSave: (patch: { maxPallets?: number; maxVolumeM3?: number; lengthM?: number; widthM?: number; heightM?: number }) => void;
}) {
  const [maxPallets, setMaxPallets] = useState(String(vehicleType.maxPallets));
  const [maxVolumeM3, setMaxVolumeM3] = useState(vehicleType.maxVolumeM3 ?? "");
  const [lengthM, setLengthM] = useState(vehicleType.lengthM ?? "");
  const [widthM, setWidthM] = useState(vehicleType.widthM ?? "");
  const [heightM, setHeightM] = useState(vehicleType.heightM ?? "");

  useEffect(() => setMaxPallets(String(vehicleType.maxPallets)), [vehicleType.maxPallets]);
  useEffect(() => setMaxVolumeM3(vehicleType.maxVolumeM3 ?? ""), [vehicleType.maxVolumeM3]);
  useEffect(() => setLengthM(vehicleType.lengthM ?? ""), [vehicleType.lengthM]);
  useEffect(() => setWidthM(vehicleType.widthM ?? ""), [vehicleType.widthM]);
  useEffect(() => setHeightM(vehicleType.heightM ?? ""), [vehicleType.heightM]);

  return (
    <tr className="hover:bg-brand-50/60">
      <td className="px-4 py-3 font-medium text-slate-800">{vehicleType.name}</td>
      <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(vehicleType.maxWeightKg).toLocaleString("es-ES")}</td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="1"
          value={maxPallets}
          onChange={(e) => setMaxPallets(e.target.value)}
          onBlur={() =>
            maxPallets !== "" &&
            Number(maxPallets) !== vehicleType.maxPallets &&
            onSave({ maxPallets: Math.round(Number(maxPallets)) })
          }
          className={typeCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.1"
          value={maxVolumeM3}
          onChange={(e) => setMaxVolumeM3(e.target.value)}
          onBlur={() =>
            maxVolumeM3 !== "" &&
            Number(maxVolumeM3) !== Number(vehicleType.maxVolumeM3 ?? 0) &&
            onSave({ maxVolumeM3: Number(maxVolumeM3) })
          }
          className={typeCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={lengthM}
          onChange={(e) => setLengthM(e.target.value)}
          onBlur={() =>
            lengthM !== "" && Number(lengthM) !== Number(vehicleType.lengthM ?? 0) && onSave({ lengthM: Number(lengthM) })
          }
          className={typeCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={widthM}
          onChange={(e) => setWidthM(e.target.value)}
          onBlur={() =>
            widthM !== "" && Number(widthM) !== Number(vehicleType.widthM ?? 0) && onSave({ widthM: Number(widthM) })
          }
          className={typeCellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.01"
          value={heightM}
          onChange={(e) => setHeightM(e.target.value)}
          onBlur={() =>
            heightM !== "" && Number(heightM) !== Number(vehicleType.heightM ?? 0) && onSave({ heightM: Number(heightM) })
          }
          className={typeCellCls}
        />
      </td>
    </tr>
  );
}
