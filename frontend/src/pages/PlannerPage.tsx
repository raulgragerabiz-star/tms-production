import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import NewRouteModal from "@/pages/planner/NewRouteModal";
import RouteAssignmentModal from "@/pages/planner/RouteAssignmentModal";
import { ServiceType } from "@/pages/planner/DragDropBoard";
import PlanificacionTab from "@/pages/planner/PlanificacionTab";
import RutasTab from "@/pages/planner/RutasTab";
import DispatchBoard from "@/pages/planner/DispatchBoard";

// Fase 7b: reestructuración pedida por Raúl -- el Planificador tenía
// "Tablero / Mapa" (arrastrar y soltar a mano), "Lista" (tabla de rutas ya
// creadas) y "Despacho" (Fase 5b/7a: tabla + panel + mapa + línea de tiempo
// del día en marcha). Se sustituyen las dos primeras por un flujo estilo
// Bringg en dos pasos:
//   Planificación -- lista de pedidos pendientes con casillas: eliges cuáles
//   entran en esta pasada y le das a "Planificar automáticamente"
//   (POST /routes/auto-plan, el mismo motor de la Fase 6/OpenRouteService de
//   siempre, ahora con selección explícita en vez de "los N de más prioridad").
//   Rutas -- el resultado: qué rutas salieron, con qué transportista/vehículo
//   (si ya lo tienen) y qué pedidos lleva cada una.
// Despacho no cambia de función -- sigue siendo el seguimiento en vivo del
// día ya en marcha (mapa, panel de conductor, línea de tiempo) -- solo se
// beneficia del arreglo de maquetación (altura completa, sin hueco vacío) ya
// hecho en Fase 7a. El botón "+ Nueva ruta" (alta manual de una ruta) se
// mantiene tal cual, disponible en cualquier pestaña.
const serviceTypeOptions: { value: ServiceType; label: string }[] = [
  { value: "paqueteria", label: "Paquetería" },
  { value: "paleteria", label: "Paletería" },
  { value: "paleteria_pesada", label: "Paletería pesada" },
  { value: "gran_volumen", label: "Gran volumen / Camión completo" },
];

interface WarehouseOption {
  id: string;
  name: string;
}

type View = "planificacion" | "rutas" | "despacho";

export default function PlannerPage() {
  const [view, setView] = useState<View>("planificacion");
  const [modalOpen, setModalOpen] = useState(false);
  const [presetOrderId, setPresetOrderId] = useState<string | undefined>();
  const [assigningRouteId, setAssigningRouteId] = useState<string | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();

  const [warehouseId, setWarehouseId] = useState("");
  const [routeDate, setRouteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [serviceType, setServiceType] = useState<ServiceType>("paleteria");

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });

  function openNewRoute() {
    setPresetOrderId(undefined);
    setModalOpen(true);
  }

  // Al terminar de planificar (con o sin éxito), se avisa con el toast de
  // siempre y, si se creó al menos una ruta, se salta directamente a "Rutas"
  // para ver el resultado -- igual que en Bringg, seleccionar + planificar
  // te lleva derecho al plano de rutas montado.
  function handlePlanned(summary: string, ok: boolean) {
    if (ok) {
      showSuccess(summary);
      setView("rutas");
    } else {
      showError(summary);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Planificador</h1>
          <p className="text-sm text-slate-500">
            Selecciona pedidos y planifica automáticamente, revisa el resultado en Rutas, y sigue la ejecución del
            día en Despacho.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => setView("planificacion")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "planificacion" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Planificación
            </button>
            <button
              onClick={() => setView("rutas")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "rutas" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Rutas
            </button>
            <button
              onClick={() => setView("despacho")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${view === "despacho" ? "bg-white shadow-sm text-slate-800" : "text-slate-500"}`}
            >
              Despacho
            </button>
          </div>
          <button
            onClick={openNewRoute}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nueva ruta
          </button>
        </div>
      </div>

      {/* Filtros compartidos por las tres pestañas -- antes cada una tenía
          su propia barra duplicada. */}
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

      {view === "planificacion" && (
        <PlanificacionTab warehouseId={warehouseId} routeDate={routeDate} serviceType={serviceType} onPlanned={handlePlanned} />
      )}

      {view === "rutas" && <RutasTab warehouseId={warehouseId} routeDate={routeDate} onManageRoute={setAssigningRouteId} />}

      {view === "despacho" && <DispatchBoard warehouseId={warehouseId} routeDate={routeDate} onManageRoute={setAssigningRouteId} />}

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
