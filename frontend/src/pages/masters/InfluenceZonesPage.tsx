import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";

interface WarehouseOption {
  id: string;
  name: string;
}

interface VehicleTypeOption {
  id: string;
  name: string;
}

interface ZoneRow {
  id: string;
  kmMin: string;
  kmMax: string;
  vehicleTypeId: string;
  weeklyShipments: string | null;
  vehicleType: { id: string; name: string };
}

const cellCls = "w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm";

// Fase 8: "embedded" -- se usa desde "Flota y Transportistas" (pestaña
// "Tipos de vehículo y zonas"), donde se agrupó junto a los tipos de
// vehículo para reducir el panel izquierdo (antes era un acceso de menú
// aparte, "Zonas de influencia"). Con `embedded` solo se oculta el título
// propio; el resto de la pantalla (selector de almacén, tabla de franjas)
// funciona exactamente igual. Sin el prop (por si algo la sigue montando
// suelta) el comportamiento no cambia en nada.
export default function InfluenceZonesPage({ embedded = false }: { embedded?: boolean }) {
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();
  const [warehouseId, setWarehouseId] = useState<string>("");

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });

  // Objetivo 2: las franjas se definen por almacén -- la distancia se mide
  // desde ese almacén concreto, así que cada uno tiene su propia tabla.
  useEffect(() => {
    if (!warehouseId && warehousesQuery.data?.items.length) {
      setWarehouseId(warehousesQuery.data.items[0].id);
    }
  }, [warehouseId, warehousesQuery.data]);

  const vehicleTypesQuery = useQuery({
    queryKey: ["vehicle-types"],
    queryFn: async () => (await api.get("/vehicles/types")).data as { items: VehicleTypeOption[] },
  });

  const zonesQuery = useQuery({
    queryKey: ["influence-zones", warehouseId],
    queryFn: async () => (await api.get(`/zones/warehouses/${warehouseId}`)).data as { items: ZoneRow[] },
    enabled: !!warehouseId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const firstVehicleTypeId = vehicleTypesQuery.data?.items[0]?.id;
      if (!firstVehicleTypeId) throw new Error("no_vehicle_types");
      return (
        await api.post(`/zones/warehouses/${warehouseId}`, {
          kmMin: 0,
          kmMax: 1,
          vehicleTypeId: firstVehicleTypeId,
        })
      ).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["influence-zones", warehouseId] });
    },
    onError: () => showError("No se pudo añadir la franja"),
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { id: string; kmMin?: number; kmMax?: number; vehicleTypeId?: string; weeklyShipments?: number | null }) => {
      const { id, ...rest } = payload;
      return (await api.patch(`/zones/${id}`, rest)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["influence-zones", warehouseId] });
    },
    onError: (err: any) => {
      showError(err?.response?.data?.message ?? "No se pudo guardar el cambio");
      queryClient.invalidateQueries({ queryKey: ["influence-zones", warehouseId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/zones/${id}`);
    },
    onSuccess: () => {
      showSuccess("Franja eliminada");
      queryClient.invalidateQueries({ queryKey: ["influence-zones", warehouseId] });
    },
  });

  const zones = zonesQuery.data?.items ?? [];
  const vehicleTypes = vehicleTypesQuery.data?.items ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div>
          {!embedded && <h1 className="text-xl font-semibold text-slate-900">Zonas de influencia</h1>}
          <p className="text-sm text-slate-500">
            Franjas de km desde cada almacén y el vehículo que se les asigna.
          </p>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={!warehouseId || vehicleTypes.length === 0 || createMutation.isPending}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50"
        >
          + Añadir franja
        </button>
      </div>

      <div className="mb-4 mt-4">
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2"
        >
          {warehousesQuery.data?.items.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Km mín.</th>
              <th className="text-left px-4 py-3">Km máx.</th>
              <th className="text-left px-4 py-3">Vehículo asignado</th>
              <th className="text-left px-4 py-3">Envíos/semana</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {zonesQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {!zonesQuery.isLoading && zones.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Este almacén todavía no tiene franjas definidas.
                </td>
              </tr>
            )}
            {zones.map((zone) => (
              <ZoneTableRow
                key={zone.id}
                zone={zone}
                vehicleTypes={vehicleTypes}
                onSave={(patch) => updateMutation.mutate({ id: zone.id, ...patch })}
                onDelete={() => deleteMutation.mutate(zone.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}

// Fila editable en línea: cada celda es un input controlado que guarda al
// perder el foco (onBlur), en vez de un modal aparte -- así se puede corregir
// una tabla de varias franjas de un tirón, como en cualquier hoja de cálculo.
function ZoneTableRow({
  zone,
  vehicleTypes,
  onSave,
  onDelete,
}: {
  zone: ZoneRow;
  vehicleTypes: VehicleTypeOption[];
  onSave: (patch: { kmMin?: number; kmMax?: number; vehicleTypeId?: string; weeklyShipments?: number | null }) => void;
  onDelete: () => void;
}) {
  const [kmMin, setKmMin] = useState(zone.kmMin);
  const [kmMax, setKmMax] = useState(zone.kmMax);
  const [weeklyShipments, setWeeklyShipments] = useState(zone.weeklyShipments ?? "");

  useEffect(() => setKmMin(zone.kmMin), [zone.kmMin]);
  useEffect(() => setKmMax(zone.kmMax), [zone.kmMax]);
  useEffect(() => setWeeklyShipments(zone.weeklyShipments ?? ""), [zone.weeklyShipments]);

  return (
    <tr className="hover:bg-brand-50/60">
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.1"
          value={kmMin}
          onChange={(e) => setKmMin(e.target.value)}
          onBlur={() => Number(kmMin) !== Number(zone.kmMin) && onSave({ kmMin: Number(kmMin) })}
          className={cellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.1"
          value={kmMax}
          onChange={(e) => setKmMax(e.target.value)}
          onBlur={() => Number(kmMax) !== Number(zone.kmMax) && onSave({ kmMax: Number(kmMax) })}
          className={cellCls}
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={zone.vehicleTypeId}
          onChange={(e) => onSave({ vehicleTypeId: e.target.value })}
          className={cellCls}
        >
          {vehicleTypes.map((vt) => (
            <option key={vt.id} value={vt.id}>
              {vt.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="0.1"
          value={weeklyShipments}
          onChange={(e) => setWeeklyShipments(e.target.value)}
          onBlur={() =>
            Number(weeklyShipments || 0) !== Number(zone.weeklyShipments ?? 0) &&
            onSave({ weeklyShipments: weeklyShipments === "" ? null : Number(weeklyShipments) })
          }
          className={cellCls}
        />
      </td>
      <td className="px-4 py-2 text-right">
        <button onClick={onDelete} className="text-slate-400 hover:text-red-500 text-sm">
          ✕
        </button>
      </td>
    </tr>
  );
}
