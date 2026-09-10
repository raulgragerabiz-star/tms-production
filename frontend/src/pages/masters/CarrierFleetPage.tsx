import { useState } from "react";
import TransportistasTab from "@/pages/masters/TransportistasTab";
import VehiclesPage from "@/pages/masters/VehiclesPage";
import InfluenceZonesPage from "@/pages/masters/InfluenceZonesPage";

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
// "Conductores" no cambia -- sigue siendo la misma pantalla de siempre
// (VehiclesPage en modo embedded), solo que ahora es la segunda pestaña en
// vez de la cuarta.
type Tab = "transportistas" | "conductores" | "tipos-zonas";

const TABS: { id: Tab; label: string }[] = [
  { id: "transportistas", label: "Transportistas" },
  { id: "conductores", label: "Conductores" },
  { id: "tipos-zonas", label: "Tipo de vehículo y zonas" },
];

export default function CarrierFleetPage() {
  const [tab, setTab] = useState<Tab>("transportistas");

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Flota y Transportistas</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Los circuitos de reparto y los transportistas que colaboran en cada uno, con su tarifa y el
        tipo de vehículo que aportan; sus conductores; y los tipos de vehículo y zonas de influencia
        que usa el planificador automático.
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

      {tab === "transportistas" && <TransportistasTab />}
      {tab === "conductores" && <VehiclesPage embedded activeTab="drivers" />}
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
