import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import NewRouteModal from "@/pages/planner/NewRouteModal";
import RouteAssignmentModal from "@/pages/planner/RouteAssignmentModal";
import DragDropBoard, { ServiceType } from "@/pages/planner/DragDropBoard";
import DispatchBoard from "@/pages/planner/DispatchBoard";

// Los 4 segmentos reales de ServiceType — antes un toggle de solo 2 botones
// ("Paletería"/"Camión completo") que ya no cubría los valores válidos del enum.
const serviceTypeOptions: { value: ServiceType; label: string }[] = [
  { value: "paqueteria", label: "Paquetería" },
  { value: "paleteria", label: "Paletería" },
  { value: "paleteria_pesada", label: "Paletería pesada" },
  { value: "gran_volumen", label: "Gran volumen / Camión completo" },
];

interface RouteRow {
  id: string;
  routeDate: string;
  status: string;
  serviceType: string;
  warehouse: { name: string };
  carrier: { legalName: string } | null;
  vehicle: { plate: string } | null;
  stops: { id: string }[];
  loadPlan: { weightOccupancyPct: number; palletOccupancyPct: number } | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

export default function PlannerPage() {
  // Fase 5b (Planificador estilo Bringg): tercera pestaña "Despacho" (tabla +
  // mapa en vivo + Gantt), sumada a las 2 ya existentes -- "board"/"list" no
  // cambian de comportamiento.
  const [view, setView] = useState<"board" | "list" | "dispatch">("board");
  const [modalOpen, setModalOpen] = useState(false);
  const [presetOrderId, setPresetOrderId] = useState<string | undefined>();
  const [assigningRouteId, setAssigningRouteId] = useState<string | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();

  const [warehouseId, setWarehouseId] = useState("");
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [serviceType, setServiceType] = useState<ServiceType>("paleteria");
  const [isAutoPlanning, setIsAutoPlanning] = useState(false);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["routes"],
    queryFn: async () => (await api.get("/routes")).data as { items: RouteRow[]; total: number },
    enabled: view === "list",
  });

  function openNewRouteFromDrop(orderId: string) {
    setPresetOrderId(orderId);
    setModalOpen(true);
  }

  // Fase 6: planificación automática -- agrupa y secuencia geográficamente
  // (motor de optimización OpenRouteService/VROOM) los pedidos validados sin
  // ruta todavía del almacén/fecha/servicio elegidos. Crea rutas "draft"
  // igual que si se hubieran montado a mano; la asignación de transportista
  // sigue el flujo ya existente (Gestionar ruta / comparar coste).
  async function handleAutoPlan() {
    if (!warehouseId) {
      showError("Elige primero un almacén concreto para planificar automáticamente");
      return;
    }
    setIsAutoPlanning(true);
    try {
      const { data } = await api.post("/routes/auto-plan", { warehouseId, routeDate, serviceType });
      if (data.routesCreated === 0) {
        showError(data.message ?? "No se ha podido crear ninguna ruta con los pedidos pendientes de ese día");
      } else {
        const extra = data.ordersUnassigned > 0 ? ` (${data.ordersUnassigned} pedidos quedaron sin encajar)` : "";
        showSuccess(`${data.routesCreated} ruta(s) creada(s) automáticamente, ${data.ordersPlanned} pedidos planificados${extra}.`);
      }
    } catch (err: any) {
      showError(err?.response?.data?.message ?? "No se pudo completar la planificación automática");
    } finally {
      setIsAutoPlanning(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Planificador</h1>
          <p className="text-sm text-slate-500">
            Arrastra pedidos pendientes sobre una ruta en construcción o sobre "nueva ruta" en el mapa.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setView("board")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "board" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Tablero / Mapa
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "list" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Lista
            </button>
            <button
              onClick={() => setView("dispatch")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "dispatch" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Despacho
            </button>
          </div>
          <button
            onClick={() => {
              setPresetOrderId(undefined);
              setModalOpen(true);
            }}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nueva ruta
          </button>
        </div>
      </div>

      {view === "board" && (
        <>
          <div className="flex items-center gap-3 mb-4 bg-white border border-slate-200 rounded-xl p-3">
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            >
              <option value="">Todos los almacenes</option>
              {warehousesQuery.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            />
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as ServiceType)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            >
              {serviceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <DragDropBoard
            warehouseId={warehouseId}
            routeDate={routeDate}
            serviceType={serviceType}
            onCreateRouteRequest={openNewRouteFromDrop}
            onSuccess={showSuccess}
            onError={showError}
          />
        </>
      )}

      {view === "list" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Almacén</th>
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-right px-4 py-3">Paradas</th>
                <th className="text-right px-4 py-3">Ocupación (peso/palés)</th>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Estado</th>
                <th className="text-left px-4 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    Cargando…
                  </td>
                </tr>
              )}
              {!isLoading && data?.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                    No hay rutas creadas todavía.
                  </td>
                </tr>
              )}
              {data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{new Date(r.routeDate).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-3">{r.warehouse.name}</td>
                  <td className="px-4 py-3 capitalize">{r.serviceType.replace("_", " ")}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{r.stops.length}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">
                    {r.loadPlan
                      ? `${Math.round(r.loadPlan.weightOccupancyPct * 100)}% / ${Math.round(r.loadPlan.palletOccupancyPct * 100)}%`
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{r.carrier?.legalName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    {["in_progress", "closed", "rejected"].includes(r.status) ? (
                      <span className="text-slate-300 text-xs">—</span>
                    ) : (
                      <button
                        onClick={() => setAssigningRouteId(r.id)}
                        className="text-brand-600 hover:text-brand-700 text-xs font-medium"
                      >
                        Gestionar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "dispatch" && (
        <>
          <div className="flex items-center gap-3 mb-4 bg-white border border-slate-200 rounded-xl p-3">
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            >
              <option value="">Todos los almacenes</option>
              {warehousesQuery.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={routeDate}
              onChange={(e) => setRouteDate(e.target.value)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            />
            <select
              value={serviceType}
              onChange={(e) => setServiceType(e.target.value as ServiceType)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
            >
              {serviceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleAutoPlan}
              disabled={isAutoPlanning}
              className="ml-auto bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
              title="Agrupa y secuencia geográficamente (OpenRouteService) los pedidos validados sin ruta de este almacén/fecha/servicio"
            >
              {isAutoPlanning ? "Planificando…" : "Planificar automáticamente"}
            </button>
          </div>

          <DispatchBoard warehouseId={warehouseId} routeDate={routeDate} onManageRoute={setAssigningRouteId} />
        </>
      )}

      <NewRouteModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={(msg) => {
          showSuccess(msg);
          setModalOpen(false);
        }}
        onError={showError}
        presetOrderId={presetOrderId}
        presetWarehouseId={warehouseId || undefined}
        presetServiceType={serviceType}
      />
      <RouteAssignmentModal
        routeId={assigningRouteId}
        onClose={() => setAssigningRouteId(null)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
