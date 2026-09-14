import { useState } from "react";
import AnalyticsPage from "@/pages/AnalyticsPage";
import AnomaliesPage from "@/pages/AnomaliesPage";
import DemandForecastPage from "@/pages/DemandForecastPage";

// Mejora (2026-09-14, Fase 8V): petición explícita de Raúl -- "agrupar los
// conceptos de analitica, alertas y prevision. son muchas pestañas para
// datos sin demasiada variabilidad". Mismo patrón ya usado para "Flota y
// Transportistas" (Fase 8): un único acceso de menú, con pestañas internas
// que reutilizan exactamente las pantallas que ya existían (mismas
// consultas/mutaciones, sin lógica nueva) en modo "embedded" -- solo se
// oculta el título propio de cada una, porque esta pantalla ya pone el suyo.
//
// "Alertas" y "Previsión" tenían antes su propio acceso de menú
// (/alertas, /prevision-demanda); esas rutas se retiraron de App.tsx al
// aplicar esta pieza -- cualquier enlace guardado a ellas cae en la ruta
// comodín de la app y redirige a Inicio, mismo comportamiento que ya tuvo la
// unificación de "Flota y Transportistas".
type Tab = "kpis" | "alertas" | "prevision";

const TABS: { id: Tab; label: string }[] = [
  { id: "kpis", label: "KPIs" },
  { id: "alertas", label: "Alertas" },
  { id: "prevision", label: "Previsión de demanda" },
];

export default function AnalyticsHubPage() {
  const [tab, setTab] = useState<Tab>("kpis");

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Analítica</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Histórico de coste, OTIF y tiempos de operación; alertas de anomalías detectadas automáticamente; y
        previsión de demanda por almacén y provincia.
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

      {tab === "kpis" && <AnalyticsPage embedded />}
      {tab === "alertas" && <AnomaliesPage embedded />}
      {tab === "prevision" && <DemandForecastPage embedded />}
    </div>
  );
}
