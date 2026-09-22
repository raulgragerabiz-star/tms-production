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

// Fase 19: "resumen acumulado por ruta" + "criterio de asignación por
// distancia" + "dispersión geográfica" -- petición explícita de Raúl a
// partir de un informe de referencia propio, para dar más contexto en esta
// misma pestaña además de la tabla de percentiles de arriba (ver comentario
// largo en fleet-sizing.service.ts / fleet-sizing-distance.service.ts).
interface RouteAccumulatedRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  kgTotales: number;
  pedidos: number;
  clientes: number;
  viajes: number;
  kgPorViaje: number;
  frecuencia: string;
}

interface DistanceTierSummaryRow {
  tier: string;
  label: string;
  clientes: number;
  vehiculoSugerido: string;
  frecuenciaSugerida: string;
}

interface RouteDispersionRow {
  deliveryZoneId: string;
  deliveryZoneName: string;
  minKm: number;
  mediaKm: number;
  maxKm: number;
  dispersionKm: number;
  clientes: number;
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
  resumenAcumulado: RouteAccumulatedRow[];
  criterioDistancia: DistanceTierSummaryRow[];
  dispersionGeografica: RouteDispersionRow[];
}

// Colores por franja de distancia: rampa SECUENCIAL de un solo tono (el azul
// de marca de BigMat, brand-300..700 de claro a oscuro), no colores
// categóricos -- las franjas son un orden (más cerca -> más lejos), no
// identidades sin relación entre sí, así que les corresponde una rampa de
// magnitud (criterio del skill de dataviz), y de paso reutiliza el color
// corporativo ya definido en tailwind.config en vez de introducir uno nuevo
// que hubiera que validar aparte. Solo se usa como acento de borde; el
// nombre de la franja y el nº de clientes siempre van en texto.
const TIER_ACCENT: Record<string, string> = {
  metropolitana: "border-t-brand-300",
  regional_cercana: "border-t-brand-400",
  regional_extendida: "border-t-brand-500",
  larga_distancia: "border-t-brand-600",
  internacional: "border-t-brand-700",
};

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

  const { rutas, flota, resumenAcumulado, criterioDistancia, dispersionGeografica } = query.data;
  const maxKgTotales = Math.max(1, ...resumenAcumulado.map((r) => r.kgTotales));

  // Fase 19: antes, sin histórico de rutas, esta pestaña no mostraba nada en
  // absoluto. Ahora los tres bloques nuevos (resumen acumulado, criterio de
  // distancia, dispersión geográfica) no dependen de que haya rutas
  // planificadas todavía -- el de distancia, en concreto, solo depende de
  // que los clientes tengan dirección geolocalizada (Fase 16) -- así que se
  // muestran igualmente aunque la tabla de percentiles todavía no tenga
  // datos.
  return (
    <div>
      {rutas.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-xl mb-8">
          Todavía no hay histórico de rutas suficiente para calcular vehículo recomendado por circuito. En cuanto haya
          rutas reales con paradas y peso asignados, aparecerán aquí.
        </p>
      ) : (
        <>
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
        </>
      )}

      {/* Fase 19: resumen acumulado por ruta -- kg totales, pedidos, clientes,
          viajes y frecuencia semanal por circuito, con barra de magnitud de
          kg totales. Petición explícita de Raúl a partir de un informe de
          referencia propio; crecerá hacia esas cifras a medida que se
          acumule más histórico real (ver comentario en fleet-sizing.service.ts). */}
      <div className="mt-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400 mb-1">Resumen acumulado por ruta</p>
        <p className="text-xs text-slate-500 mb-3">
          Kg totales, pedidos, clientes distintos, viajes y frecuencia semanal habitual de cada circuito -- todo el
          histórico real acumulado.
        </p>
        {resumenAcumulado.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
            Todavía no hay pedidos con circuito resuelto en el histórico.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Ruta</th>
                  <th className="text-left px-3 py-2 w-1/3">Kg totales</th>
                  <th className="text-right px-3 py-2">Pedidos</th>
                  <th className="text-right px-3 py-2">Clientes</th>
                  <th className="text-right px-3 py-2">Viajes</th>
                  <th className="text-right px-3 py-2">Kg/viaje</th>
                  <th className="text-left px-3 py-2">Frecuencia</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {resumenAcumulado.map((r) => (
                  <tr key={r.deliveryZoneId} className="hover:bg-brand-50/60">
                    <td className="px-3 py-2 font-semibold text-brand-700 whitespace-nowrap">{r.deliveryZoneName}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand-500"
                            style={{ width: `${Math.max(2, Math.round((r.kgTotales / maxKgTotales) * 100))}%` }}
                          />
                        </div>
                        <span className="font-mono text-xs text-slate-600 whitespace-nowrap">{formatKg(r.kgTotales)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.pedidos.toLocaleString("es-ES")}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.clientes}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.viajes}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{formatKg(r.kgPorViaje)}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.frecuencia}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Fase 19: criterio de asignación ruta/cliente por distancia real --
          mismas franjas que el mapa de clientes de Inicio (Fase 16), aquí
          agregadas en nº de clientes por franja con el vehículo/frecuencia
          típica de cada una. */}
      <div className="mt-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400 mb-1">
          Criterio de asignación ruta/cliente por distancia real
        </p>
        <p className="text-xs text-slate-500 mb-3">
          Zonificación concéntrica desde el almacén de referencia de cada cliente. El vehículo y la frecuencia se
          ajustan al perímetro real, no al nombre histórico de la ruta.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {criterioDistancia.map((t) => (
            <div key={t.tier} className={`bg-white rounded-xl border border-slate-200 border-t-4 ${TIER_ACCENT[t.tier] ?? ""} p-3`}>
              <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
              <p className="font-mono text-2xl font-bold mt-1 text-slate-900">{t.clientes} clientes</p>
              <p className="text-xs text-slate-500 mt-1">
                {t.vehiculoSugerido} · {t.frecuenciaSugerida}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Fase 19: dispersión geográfica -- un circuito con clientes muy
          dispersos en distancia (mezcla cercanos y lejanos) es candidato a
          dividirse en dos, igual que en el informe de referencia de Raúl. */}
      <div className="mt-8">
        <p className="text-[0.7rem] font-bold uppercase tracking-wider text-slate-400 mb-1">
          Dispersión geográfica de las rutas actuales
        </p>
        <p className="text-xs text-slate-500 mb-3">
          Cuanto mayor la desviación (columna "Dispersión"), más mezclada está la ruta entre clientes cercanos y
          lejanos -- candidata a dividirse en dos perímetros.
        </p>
        {dispersionGeografica.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-xl">
            Todavía no hay suficientes clientes geolocalizados y con circuito asignado para calcular esto.
          </p>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] font-semibold uppercase tracking-wide">
                <tr>
                  <th className="text-left px-3 py-2">Ruta actual</th>
                  <th className="text-right px-3 py-2">Mín. km</th>
                  <th className="text-right px-3 py-2">Media km</th>
                  <th className="text-right px-3 py-2">Máx. km</th>
                  <th className="text-right px-3 py-2">Dispersión (σ)</th>
                  <th className="text-right px-3 py-2">Clientes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dispersionGeografica.map((r) => (
                  <tr key={r.deliveryZoneId} className="hover:bg-brand-50/60">
                    <td className="px-3 py-2 font-semibold text-brand-700 whitespace-nowrap">{r.deliveryZoneName}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.minKm}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.mediaKm}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.maxKm}</td>
                    <td
                      className={`px-3 py-2 text-right font-mono font-semibold ${
                        r.dispersionKm >= 80 ? "text-rose-600" : r.dispersionKm >= 40 ? "text-amber-600" : "text-slate-500"
                      }`}
                    >
                      {r.dispersionKm}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{r.clientes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
