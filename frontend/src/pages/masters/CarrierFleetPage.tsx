import { useState } from "react";
import TransportistasTab from "@/pages/masters/TransportistasTab";
import VehiclesPage from "@/pages/masters/VehiclesPage";
import InfluenceZonesPage from "@/pages/masters/InfluenceZonesPage";
import FleetSizingTab from "@/pages/masters/FleetSizingTab";

// Fase 8: petición explícita de Raúl -- reducir esto de 5 pestañas
// (Empresa/Tarifas/Vehículos/Conductores/Tipo de vehículo) a menos,
// agrupando conceptos para "reducir el panel izquierdo". A partir de la
// plantilla real que aportó (circuitos de reparto, transportistas
// colaboradores y sus tarifas), se sustituyen "Empresa" + "Tarifas" +
// "Vehículos" por una única tabla ("Transportistas": una fila por circuito↔
// transportista, con checkboxes de tipo de vehículo y columnas por
// tipología de tarifa en vez de las de analítica) y se fusiona "Tipo de
// vehículo" con "Zonas de influencia" (que antes era un acceso de menú
// aparte) en una sola sub-pestaña.
//
// Fase 17: petición explícita de Raúl -- "necesito eliminar la pestaña
// conductores. es un variable diario que no da estabilidad como para
// generar un listado estandar". Se quita "Conductores" (VehiclesPage en
// modo embedded con activeTab="drivers" deja de montarse aquí -- el código
// de esa pestaña sigue intacto en VehiclesPage.tsx por si hiciera falta en
// el futuro, mismo criterio que ya se aplicó con "vehicles" en 2026-09-10).
// El panel pasa a tener DOS secciones, tal y como pidió Raúl:
//   - "Rutas / Transportistas": la tabla de circuito↔transportista de
//     siempre (TransportistasTab), solo renombrada -- ya mostraba
//     exactamente esto (cada ruta, el transportista que la cubre, el tipo
//     de vehículo que aporta y su tarifa acordada).
//   - "Zonas / Vehículos" (nueva, FleetSizingTab.tsx): analítica acumulada
//     por circuito -- salidas, mediana/P85/máximo en kg y vehículo
//     recomendado según esa carga, más el resumen de flota dedicada vs.
//     compartida por día de la semana.
type Tab = "rutas-transportistas" | "zonas-vehiculos" | "tipos-zonas";

const TABS: { id: Tab; label: string }[] = [
  { id: "rutas-transportistas", label: "Rutas / Transportistas" },
  { id: "zonas-vehiculos", label: "Zonas / Vehículos" },
  { id: "tipos-zonas", label: "Tipo de vehículo y zonas" },
];

export default function CarrierFleetPage() {
  const [tab, setTab] = useState<Tab>("rutas-transportistas");

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Flota y Transportistas</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Los circuitos de reparto y los transportistas que colaboran en cada uno, con su tarifa y el tipo de vehículo
        que aportan; la analítica acumulada de carga y vehículo recomendado por circuito; y los tipos de vehículo y
        zonas de influencia que usa el planificador automático.
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
      {tab === "zonas-vehiculos" && <FleetSizingTab />}
      {tab === "tipos-zonas" && (
        <div className="space-y-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Tipos de vehículo</p>
            <VehiclesPage embedded activeTab="types" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
              Zonas de influencia (franjas de km del auto-planificador)
            </p>
            <InfluenceZonesPage embedded />
          </div>
        </div>
      )}
    </div>
  );
}
