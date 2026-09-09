import { useState } from "react";
import CarriersPage from "@/pages/masters/CarriersPage";
import RatesPage from "@/pages/RatesPage";
import VehiclesPage from "@/pages/masters/VehiclesPage";

// 2026-09-09: petición explícita de Raúl -- "para ahorrar tiempos y evitar
// tanta segmentación, deberíamos compactar todo lo relacionado con
// transportista y flotas [en] un solo acceso en el menú lateral + pestañas
// con cada uno de los campos (empresa, tarifas, vehículos, conductores,
// tipo de vehículo)". Antes esto eran 3 accesos de menú distintos
// (Maestros > Transportistas, Maestros > Flota -- que a su vez tenía sus
// propias 3 sub-pestañas -- y el "Tarifas" de nivel superior). Ahora es un
// único acceso ("Flota y Transportistas") con las 5 pestañas que pidió, en
// el orden que las nombró.
//
// Cada pestaña reutiliza la pantalla ya existente (misma lógica, mismas
// consultas, mismos modales) en modo "embedded": solo se oculta el título
// propio de cada una (esta pantalla ya pone uno) y, en el caso de
// Vehículos/Conductores/Tipo de vehículo, la sub-barra de pestañas propia
// de VehiclesPage se sustituye por esta barra única -- el contenido y el
// comportamiento de cada tabla no cambian en nada.
type Tab = "empresa" | "tarifas" | "vehiculos" | "conductores" | "tipos";

const TABS: { id: Tab; label: string }[] = [
  { id: "empresa", label: "Empresa" },
  { id: "tarifas", label: "Tarifas" },
  { id: "vehiculos", label: "Vehículos" },
  { id: "conductores", label: "Conductores" },
  { id: "tipos", label: "Tipo de vehículo" },
];

export default function CarrierFleetPage() {
  const [tab, setTab] = useState<Tab>("empresa");

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Flota y Transportistas</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Todo lo relacionado con los transportistas subcontratados en un solo sitio: su ficha, las
        tarifas que tienen contratadas, sus vehículos, sus conductores y los tipos de vehículo
        disponibles.
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

      {tab === "empresa" && <CarriersPage embedded />}
      {tab === "tarifas" && <RatesPage embedded />}
      {(tab === "vehiculos" || tab === "conductores" || tab === "tipos") && (
        <VehiclesPage
          embedded
          activeTab={tab === "vehiculos" ? "vehicles" : tab === "conductores" ? "drivers" : "types"}
        />
      )}
    </div>
  );
}
