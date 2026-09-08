import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
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

export default function VehiclesPage() {
  const [tab, setTab] = useState<"vehicles" | "drivers" | "types">("vehicles");
  const [driverModalOpen, setDriverModalOpen] = useState(false);
  const [assigningVehicleId, setAssigningVehicleId] = useState<string | null>(null);
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

  // Objetivo 2: capacidad por volumen y dimensiones de cada tipo de vehículo.
  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeRow[]; total: number },
    enabled: tab === "types",
  });

  const updateVehicleTypeMutation = useMutation({
    mutationFn: async (payload: { id: string; maxVolumeM3?: number; lengthM?: number; widthM?: number; heightM?: number }) => {
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
          onClick={() => setTab("vehicles")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "vehicles" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
        >
          Vehículos
        </button>
        <button
          onClick={() => setTab("drivers")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "drivers" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
        >
          Conductores
        </button>
        <button
          onClick={() => setTab("types")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === "types" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
        >
          Tipos de vehículo
        </button>
      </div>

      {tab === "vehicles" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Matrícula</th>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Cap. peso (kg)</th>
                <th className="text-left px-4 py-3">Cap. palés</th>
                <th className="text-left px-4 py-3">Admite superar palés</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Conductor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {vehiclesQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {vehiclesQuery.data?.items.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{v.plate}</td>
                  <td className="px-4 py-3">{v.carrier.legalName}</td>
                  <td className="px-4 py-3">{v.vehicleType.name}</td>
                  <td className="px-4 py-3">{Number(v.vehicleType.maxWeightKg).toLocaleString("es-ES")}</td>
                  <td className="px-4 py-3">{v.vehicleType.maxPallets}</td>
                  <td className="px-4 py-3">{v.vehicleType.allowsExceedingPallets ? "Sí" : "No"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${v.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                      {v.active ? "Activo" : "Baja"}
                    </span>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "drivers" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">NIF</th>
                <th className="text-left px-4 py-3">Teléfono</th>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {driversQuery.isLoading && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
                </tr>
              )}
              {!driversQuery.isLoading && driversQuery.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin conductores registrados.</td>
                </tr>
              )}
              {driversQuery.data?.items.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{d.fullName}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.taxId}</td>
                  <td className="px-4 py-3 text-slate-500">{d.phone ?? "—"}</td>
                  <td className="px-4 py-3">{d.carrier.legalName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                      {d.active ? "Activo" : "Baja"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "types" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Cap. peso (kg)</th>
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
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
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
  onSave: (patch: { maxVolumeM3?: number; lengthM?: number; widthM?: number; heightM?: number }) => void;
}) {
  const [maxVolumeM3, setMaxVolumeM3] = useState(vehicleType.maxVolumeM3 ?? "");
  const [lengthM, setLengthM] = useState(vehicleType.lengthM ?? "");
  const [widthM, setWidthM] = useState(vehicleType.widthM ?? "");
  const [heightM, setHeightM] = useState(vehicleType.heightM ?? "");

  useEffect(() => setMaxVolumeM3(vehicleType.maxVolumeM3 ?? ""), [vehicleType.maxVolumeM3]);
  useEffect(() => setLengthM(vehicleType.lengthM ?? ""), [vehicleType.lengthM]);
  useEffect(() => setWidthM(vehicleType.widthM ?? ""), [vehicleType.widthM]);
  useEffect(() => setHeightM(vehicleType.heightM ?? ""), [vehicleType.heightM]);

  return (
    <tr>
      <td className="px-4 py-3 font-medium text-slate-800">{vehicleType.name}</td>
      <td className="px-4 py-3 text-slate-500">{Number(vehicleType.maxWeightKg).toLocaleString("es-ES")}</td>
      <td className="px-4 py-3 text-slate-500">{vehicleType.maxPallets}</td>
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
