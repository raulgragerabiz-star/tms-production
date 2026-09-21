import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import Panel from "@/components/Panel";
import Chip from "@/components/Chip";

// Fase 17: "Zonas / Vehículos" -- segunda sección de "Flota y Transportistas"
// (petición explícita de Raúl, sustituye a la pestaña "Conductores" que se
// quitó por ser "una variable diaria que no da estabilidad como para generar
// un listado estándar"). Segmenta por circuito el histórico acumulado real
// (Route + RouteStop + Order, sin filtro de fecha, mismo criterio que
// /dashboard/accumulated) y calcula qué tipo de vehículo es el adecuado para
// cada uno según la carga habitual -- ver fleet-sizing.service.ts para el
// porqué exacto de cada cálculo (percentiles, criterio de "el más pequeño
// que cubra el P85", umbral de "día activo" para la flota compartida).
//
// Aporta al motor de tarifas/planificación via GET /fleet-sizing solo de
// forma informativa -- los costes reales que alimentan Planificación (el
// comparador de transportistas) y el gasto vs. ingreso de Inicio siguen
// viniendo de las tarifas configuradas en "Rutas / Transportistas"
// (DeliveryZoneRateVehicleType, ver rate-resolution.service.ts); esta
// pestaña ayuda a decidir qué tipo de vehículo negociar en cada circuito,
// no sustituye esa tarifa.

interface FleetSizingRouteRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  salidas: number;
  medianaKg: number;
  p85Kg: number;
  maximoKg: number;
  vehiculoRecomendado: { id: string; name: string; maxWeightKg: number } | null;
  vehiculosNecesarios: number;
  utilizacionPct: number | null;
  pctSalidasExceden: number;
}

interface FleetSizingResult {
  rutas: FleetSizingRouteRow[];
  flota: {
    dedicada: number;
    porDiaSemana: { day: number; label: string; vehiculos: number }[];
    compartidaMax: number;
    diaMayorConcurrenciaLabel: string | null;
    reduccionPct: number | null;
  };
}

function formatKg(kg: number) {
  return kg.toLocaleString("es-ES");
}

function apiErrorMessage(err: unknown): string {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string } | undefined;
  return anyErr?.response?.data?.message ?? anyErr?.message ?? "error desconocido";
}

export default function FleetSizingTab() {
  const query = useQuery<FleetSizingResult>({
    queryKey: ["fleet-sizing"],
    queryFn: async () => (await api.get("/fleet-sizing")).data,
    refetchInterval: 300000,
  });

  if (query.isError) {
    return <p className="text-sm text-red-600">No se ha podido cargar la analítica de flota ({apiErrorMessage(query.error)}).</p>;
  }
  if (query.isLoading || !query.data) {
    return <p className="text-sm text-slate-400">Cargando…</p>;
  }

  const { rutas, flota } = query.data;

  if (rutas.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-6 text-center">
        Todavía no hay histórico de rutas suficiente para calcular vehículo recomendado por circuito. En cuanto haya
        rutas reales con paradas y peso asignados, aparecerán aquí.
      </p>
    );
  }

  return (
    <div>
      <p className="text-xs text-slate-500 mb-3">
        Carga acumulada por circuito (todo el histórico real de salidas) y el tipo de vehículo más pequeño que cubre
        el 85% de esas salidas (P85) sin sobredimensionar la flota.
      </p>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2">Ruta</th>
              <th className="text-right px-3 py-2">Salidas</th>
              <th className="text-right px-3 py-2">Mediana (kg)</th>
              <th className="text-right px-3 py-2">P85 (kg)</th>
              <th className="text-right px-3 py-2">Máximo (kg)</th>
              <th className="text-left px-3 py-2">Vehículo recomendado</th>
              <th className="text-right px-3 py-2">Nº</th>
              <th className="text-right px-3 py-2">Utilización</th>
              <th className="text-right px-3 py-2">% salidas exceden</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rutas.map((r) => (
              <tr key={r.deliveryZoneId} className="hover:bg-brand-50/60">
                <td className="px-3 py-2 font-semibold text-brand-700 whitespace-nowrap">{r.deliveryZoneName}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{r.salidas}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{formatKg(r.medianaKg)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{formatKg(r.p85Kg)}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{formatKg(r.maximoKg)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.vehiculoRecomendado ? <Chip color="purple">{r.vehiculoRecomendado.name}</Chip> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{r.vehiculosNecesarios}</td>
                <td className="px-3 py-2 text-right font-mono text-slate-600">{r.utilizacionPct != null ? `${r.utilizacionPct}%` : "—"}</td>
                <td
                  className={`px-3 py-2 text-right font-mono font-semibold ${
                    r.pctSalidasExceden >= 10 ? "text-amber-600" : r.pctSalidasExceden > 0 ? "text-slate-500" : "text-slate-400"
                  }`}
                >
                  {r.pctSalidasExceden}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400 mb-3">
        Del "flota por ruta" al "flota compartida" real
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Panel description="suma directa de vehículos recomendados por ruta">
          <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">Flota dedicada (1 por ruta)</p>
          <p className="font-mono text-2xl font-bold mt-1.5 text-slate-900">{flota.dedicada} vehículos</p>
        </Panel>
        <Panel description="máximo de vehículos que coinciden el mismo día">
          <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">Flota compartida (según calendario)</p>
          <p className="font-mono text-2xl font-bold mt-1.5 text-brand-600">{flota.compartidaMax} vehículos</p>
        </Panel>
        <Panel description="reasignando vehículos entre rutas que no comparten día">
          <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">Reducción de flota posible</p>
          <p className="font-mono text-2xl font-bold mt-1.5 text-teal-600">
            {flota.reduccionPct != null ? `-${flota.reduccionPct}%` : "—"}
          </p>
        </Panel>
      </div>

      <p className="text-xs text-slate-500 mb-3">
        Como las rutas no salen todos los días con la misma frecuencia, un mismo vehículo puede cubrir más de una
        ruta a la semana. La flota necesaria no es la suma de necesidades por ruta, sino el{" "}
        <strong>máximo simultáneo</strong> en el día de mayor carga.
      </p>

      <div className="grid grid-cols-7 gap-2">
        {flota.porDiaSemana.map((d) => {
          const isPeak = flota.compartidaMax > 0 && d.vehiculos === flota.compartidaMax && d.label === flota.diaMayorConcurrenciaLabel;
          return (
            <div
              key={d.day}
              className={`rounded-xl border p-3 text-center ${isPeak ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-white"}`}
            >
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">{d.label.slice(0, 3).toUpperCase()}</p>
              <p className={`font-mono text-xl font-bold mt-1 ${isPeak ? "text-amber-600" : "text-slate-800"}`}>{d.vehiculos}</p>
              <p className="text-[0.65rem] text-slate-400">vehículos</p>
            </div>
          );
        })}
      </div>
      {flota.diaMayorConcurrenciaLabel && (
        <p className="text-xs text-slate-400 mt-2">
          <span className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1.5 align-middle" />
          Día de mayor concurrencia — dimensiona la flota compartida
        </p>
      )}
    </div>
  );
}
