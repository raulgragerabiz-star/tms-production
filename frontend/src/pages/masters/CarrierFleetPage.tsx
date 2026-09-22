import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import TransportistasTab from "@/pages/masters/TransportistasTab";
import VehiclesPage from "@/pages/masters/VehiclesPage";
import InfluenceZonesPage from "@/pages/masters/InfluenceZonesPage";
import FleetSizingTab from "@/pages/masters/FleetSizingTab";

interface WarehouseOption {
  id: string;
  name: string;
}

// Fase 8: petición explícita de Raúl -- reducir esto de 5 pestañas
// (Empresa/Tarifas/Vehículos/Conductores/Tipo de vehículo) a menos,
// agrupando conceptos para "reducir el panel izquierdo". A partir de la
// plantilla real que aportó (circuitos de reparto, transportistas
// colaboradores y sus tarifas), se sustituyen "Empresa" + "Tarifas" +
// "Vehículos" por una única tabla ("Transportistas") y se fusiona "Tipo de
// vehículo" con "Zonas de influencia" en una sola sub-pestaña.
//
// Fase 17: se quita "Conductores" (variable diaria, sin estabilidad para un
// listado estándar -- petición explícita de Raúl). El código de esa pestaña
// sigue intacto en VehiclesPage.tsx por si hiciera falta en el futuro. Se
// añade la analítica de flota (FleetSizingTab.tsx) como pestaña propia
// "Zonas / Vehículos".
//
// Fase 18: petición explícita de Raúl -- "las pestañas tipo de vehiculo y
// zonas y zonas / vehiculos deberian ser la misma con las caracteristicas
// indicadas anteriormente". Se fusionan en una sola pestaña "Zonas /
// Vehículos", que reúne los tipos de vehículo, las zonas de influencia (las
// franjas de km del auto-planificador) y la analítica acumulada de carga y
// vehículo recomendado por circuito -- sin quitar nada de lo que ya había en
// ninguna de las dos. El panel queda así en DOS secciones:
//   - "Rutas / Transportistas" (TransportistasTab, Fase 18: ahora agrupada
//     por circuito -- ver comentario de cabecera de ese fichero).
//   - "Zonas / Vehículos": tipos de vehículo + zonas de influencia +
//     analítica de flota, todo junto.
//
// Fase 22: petición explícita de Raúl -- "esa parte [analítica de flota /
// criterio de asignación] es con datos de almacen getafe, al cambiar de
// almacén en las zonas de influencia, los datos de getafe se mantienen a la
// vista". El selector de centro de origen se sube aquí, a la pestaña
// "Zonas / Vehículos" entera, y gobierna a la vez a InfluenceZonesPage
// (antes tenía su propio selector interno, ahora controlado desde aquí) y a
// FleetSizingTab (antes no filtraba por almacén en absoluto) -- un único
// desplegable en vez de dos que no se sincronizaban.
type Tab = "rutas-transportistas" | "zonas-vehiculos";

const TABS: { id: Tab; label: string }[] = [
  { id: "rutas-transportistas", label: "Rutas / Transportistas" },
  { id: "zonas-vehiculos", label: "Zonas / Vehículos" },
];

export default function CarrierFleetPage() {
  const [tab, setTab] = useState<Tab>("rutas-transportistas");
  const [warehouseId, setWarehouseId] = useState<string>("");

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });
  const warehouses = warehousesQuery.data?.items ?? [];

  // Mismo criterio que ya tenía InfluenceZonesPage.tsx antes de esta fase:
  // empezar en el primer almacén en cuanto se conoce la lista, en vez de
  // dejar la pantalla sin ningún centro seleccionado.
  useEffect(() => {
    if (!warehouseId && warehouses.length > 0) {
      setWarehouseId(warehouses[0].id);
    }
  }, [warehouseId, warehouses]);

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Flota y Transportistas</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Los circuitos de reparto y los transportistas que colaboran en cada uno, con su tarifa y el tipo de vehículo
        que aportan; y los tipos de vehículo, zonas de influencia y analítica de carga que usa el planificador
        automático.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === t.id ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "rutas-transportistas" && <TransportistasTab />}
      {tab === "zonas-vehiculos" && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Tipos de vehículo</p>
            <VehiclesPage embedded activeTab="types" />
          </div>

          {/* Fase 22: selector de centro de origen compartido -- gobierna a
              la vez las zonas de influencia y la analítica de flota de aquí
              abajo, en vez de que cada una tuviera el suyo por separado. */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">Centro de origen</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="rounded-lg border border-slate-300 text-sm px-3 py-2 min-w-[240px]"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Zonas de influencia (franjas de km del auto-planificador)
            </p>
            <InfluenceZonesPage embedded warehouseId={warehouseId} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Analítica de flota por circuito
            </p>
            <FleetSizingTab warehouseId={warehouseId} />
          </div>
        </div>
      )}
    </div>
  );
}
