import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Chip from "@/components/Chip";
import { useToast } from "@/hooks/use-toast";
import NewDriverModal from "@/pages/masters/DriversModal";

interface VehicleRow {
  id: string;
  plate: string;
  trailerPlate: string | null;
  vehicleType: { name: string; maxWeightKg: string; maxPallets: number; allowsExceedingPallets: boolean };
  carrier: { legalName: string };
  active: boolean;
}

interface DriverRow {
  id: string;
  fullName: string;
  taxId: string;
  phone: string | null;
  active: boolean;
  carrier: { legalName: string };
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

export default function VehiclesPage({ embedded = false, activeTab }: Props) {
  const [internalTab, setInternalTab] = useState<"vehicles" | "drivers" | "types">("vehicles");
  const tab = embedded && activeTab ? activeTab : internalTab;
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
  const [qrVehicleId, setQrVehicleId] = useState<string | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => (await api.get("/vehicles")).data as { items: VehicleRow[]; total: number },
    enabled: tab === "vehicles",
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
  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeRow[]; total: number },
    enabled: tab === "types",
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
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehiclesQuery.isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
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
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Jornada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {driversQuery.isLoading && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {!driversQuery.isLoading && driversQuery.data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Sin conductores registrados.</td>
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
                      <Chip color={d.active ? "teal" : "slate"}>{d.active ? "Activo" : "Baja"}</Chip>
                    </td>
                    <td className="px-4 py-3">
                      {shift ? (
                        <Chip color="teal">
                          {`En turno desde ${new Date(shift.startedAt).toLocaleTimeString("es-ES", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}${shift.vehicle?.plate ? ` · ${shift.vehicle.plate}` : ""}`}
                        </Chip>
                      ) : (
                        <span className="text-xs text-slate-400">Sin jornada abierta</span>
                      )}
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
