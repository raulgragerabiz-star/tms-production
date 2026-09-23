import { cloneElement, isValidElement, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import KpiCard from "@/components/KpiCard";

// "Histórico y analítica" -- último paso del flujo pedido -> ... -> confirmación
// digital -> histórico y analítica que piden las instrucciones ampliadas del
// proyecto. Backend: GET /dashboard/history (agregación con Prisma normal,
// sin vista materializada ni SQL a medida -- ver comentario en
// dashboard.routes.ts sobre por qué no se adoptó el módulo de KPIs del delta
// v1.1 directamente).
//
// Gráficos dibujados a mano en SVG (sin librería nueva): dos series de coste
// caben en un único eje sin problema, y con el volumen de datos de este TMS
// (rutas por día, no eventos por segundo) no hace falta más. Paleta y
// especificación de marcas siguiendo la guía de dataviz del propio Claude
// (slots categóricos en orden fijo, líneas de 2px, extremos redondeados,
// separación de 2px entre barras, vista de tabla como alternativa accesible).

const PALETTE = {
  // 2026-09-09: paleta alineada con la nueva estética (panel de referencia
  // TMS Getafe) -- ámbar de marca como serie principal, azul como
  // secundaria, y los mismos semánticos teal/rojo que StatusBadge/KpiCard.
  slot1: "#c9791f", // ámbar -- serie principal (coste real / OTIF)
  slot2: "#5b8def", // azul -- segunda serie (coste estimado)
  // Fase 14: tercera serie categórica (beneficio real) -- mismo teal que ya
  // usa "good"/StatusBadge para valores positivos, en orden fijo detrás de
  // slot1/slot2 (nunca sustituye a ninguna de las dos).
  slot3: "#178a70",
  surface: "#ffffff",
  textPrimary: "#0f172a",
  textSecondary: "#64748b",
  muted: "#94a3b8",
  gridline: "#e7eaf0",
  baseline: "#cbd5e1",
  good: "#178a70",
  warning: "#c9791f",
  critical: "#c23b52",
};

interface Bucket {
  period: string;
  routes: number;
  otifPct: number;
  // Fase 8Y: null cuando no hay ninguna muestra elegible en ese periodo (ver
  // comentario en dashboard.routes.ts) -- no "0%".
  otdPct: number | null;
  otsPct: number | null;
  incidents: number;
  costReal: number;
  costEstimated: number;
  // Fase 14: beneficio real de BigMat en el periodo (ver dashboard.routes.ts)
  // -- `marginUnknownLines` avisa cuántas liquidaciones del bucket no tienen
  // beneficio calculable (no se cuenta como 0).
  marginReal: number;
  marginUnknownLines: number;
  weightOccupancyPct: number;
  palletOccupancyPct: number;
  distanceKm: number;
}

interface CarrierRow {
  carrierId: string;
  legalName: string;
  routes: number;
  incidents: number;
  costReal: number;
  marginReal: number;
  marginUnknownLines: number;
}

interface ZoneRow {
  zone: string;
  weightKg: number;
}

interface AbcRow {
  cls: "A" | "B" | "C" | "D";
  customerCount: number;
  weightKg: number;
}

interface CustomerComplianceRow {
  customerId: string;
  legalName: string;
  stopsTotal: number;
  stopsCompleted: number;
  otifPct: number;
}

// Fase 28: los dos conceptos nuevos de esta fase -- "Segmentación de
// pedidos" (categoría de la ruta según su peso, ver Maestros >
// Segmentación) y "Modelo de transporte" (a portes/dedicado, ver
// Configuración > Modelo de transporte). Contados por Nº de rutas del
// periodo/filtro elegido, igual que el resto de esta pantalla.
interface ServiceTypeRow {
  segment: string;
  label: string;
  routes: number;
}

interface TransportModelRow {
  model: string;
  label: string;
  routes: number;
}

interface HistoryResponse {
  range: { from: string; to: string; groupBy: "day" | "week" | "month" };
  totals: {
    routes: number;
    otifPct: number;
    // Fase 8Y: petición de Raúl -- "la analitica debe tener claramente
    // visible de forma principal otd ots y otif". Ver comentario completo
    // (definición de cada uno) en dashboard.routes.ts, junto a Bucket.
    // null = sin ninguna muestra elegible en el periodo/filtro (no "0%").
    otdPct: number | null;
    otdEligible: number;
    otsPct: number | null;
    otsEligible: number;
    incidents: number;
    incidentRatePct: number;
    costReal: number;
    costEstimated: number;
    costDeviationPct: number | null;
    // Fase 14: petición de Raúl -- "tiene que dar el parámetro de coste
    // beneficio por ruta" también en Analítica, no solo en Facturación. Ver
    // comentario completo en dashboard.routes.ts.
    marginReal: number;
    marginUnknownLines: number;
    distanceKm: number;
    avgStopsPerRoute: number;
    // Mejora (2026-09-14): null cuando no hay ninguna muestra en el periodo/
    // filtro (nunca 0 -- 0 horas daría a entender un dato real que no existe).
    warehouseDwellAvgHours: number | null;
    transitAvgHours: number | null;
  };
  buckets: Bucket[];
  byCarrier: CarrierRow[];
  topZones: ZoneRow[];
  customerAbc: AbcRow[];
  // Fase 28: ver comentario de ServiceTypeRow/TransportModelRow más arriba.
  serviceTypeBreakdown: ServiceTypeRow[];
  transportModelBreakdown: TransportModelRow[];
  customerCompliance: CustomerComplianceRow[];
}

// Colores fijos por clase ABC (mismo criterio del panel BI de referencia de
// Raúl: A teal, B azul, C ámbar, D gris -- D es "resto", no una categoría con
// peso propio, así que se apaga en gris en vez de sumarse a la paleta
// categórica de series).
const ABC_COLOR: Record<AbcRow["cls"], string> = {
  A: "#178a70",
  B: "#5b8def",
  C: "#c9791f",
  D: "#94a3b8",
};
const ABC_DESCRIPTION: Record<AbcRow["cls"], string> = {
  A: "top 70% peso",
  B: "70-90% peso",
  C: "90-98% peso",
  D: "resto",
};

// Fase 28: colores fijos por categoría para los dos donuts nuevos --
// mismo criterio de "orden fijo, nunca ciclado" que el resto de la
// paleta categórica de esta pantalla (slot1/slot2/slot3 ya usados arriba
// para coste/OTIF, aquí se reutilizan para no introducir tonos nuevos).
const SERVICE_TYPE_COLOR: Record<string, string> = {
  paqueteria: PALETTE.slot2,
  paleteria: PALETTE.slot1,
  paleteria_pesada: PALETTE.slot3,
  gran_volumen: PALETTE.critical,
};

const TRANSPORT_MODEL_COLOR: Record<string, string> = {
  dedicado: PALETTE.slot1,
  a_portes: PALETTE.slot2,
  sin_clasificar: PALETTE.muted,
};

interface WarehouseOption {
  id: string;
  name: string;
}
interface CarrierOption {
  id: string;
  legalName: string;
}

function toISODate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  { label: "Últimos 7 días", days: 7 },
  { label: "Últimos 30 días", days: 30 },
  { label: "Últimos 90 días", days: 90 },
  { label: "Este año", days: 365 },
];

function formatPeriodLabel(period: string, groupBy: "day" | "week" | "month") {
  const d = new Date(period);
  if (groupBy === "month") return d.toLocaleDateString("es-ES", { month: "short", year: "numeric" });
  if (groupBy === "week") return `sem. ${d.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`;
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

function formatEuros(n: number) {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
}

function formatKg(kg: number) {
  if (kg >= 1000) return `${(kg / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} t`;
  return `${kg.toLocaleString("es-ES")} kg`;
}

// Mejora (2026-09-14): tiempos medios en horas -- se muestran en días cuando
// pasan de 48h (más legible que "76,3 h" para tiempos de almacén largos).
function formatHours(hours: number | null): string {
  if (hours == null) return "—";
  if (hours >= 48) return `${(hours / 24).toLocaleString("es-ES", { maximumFractionDigits: 1 })} d`;
  return `${hours.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;
}

interface Props {
  // Mejora (2026-09-14): consolidación de Analítica/Alertas/Previsión en un
  // solo acceso de menú (petición de Raúl: "son muchas pestañas para datos
  // sin demasiada variabilidad") -- mismo patrón "embedded" ya usado en
  // VehiclesPage/InfluenceZonesPage: oculta el título y la descripción
  // propios cuando esta pantalla se monta como pestaña de AnalyticsHubPage.
  embedded?: boolean;
}

export default function AnalyticsPage({ embedded }: Props = {}) {
  const [presetDays, setPresetDays] = useState(30);
  const [warehouseId, setWarehouseId] = useState("");
  const [carrierId, setCarrierId] = useState("");

  const { from, to } = useMemo(() => {
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - presetDays);
    return { from: toISODate(fromDate), to: toISODate(toDate) };
  }, [presetDays]);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
  });
  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-history", from, to, warehouseId, carrierId],
    queryFn: async () =>
      (
        await api.get("/dashboard/history", {
          params: { from, to, warehouseId: warehouseId || undefined, carrierId: carrierId || undefined },
        })
      ).data as HistoryResponse,
  });

  return (
    <div>
      {!embedded && (
        <>
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-xl font-semibold text-slate-900">Analítica</h1>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Histórico de coste, OTIF, incidencias y ocupación de la flota por periodo.
          </p>
        </>
      )}

      {/* Filtros: presets de fecha en una fila, dimensiones en combobox -- igual
          patrón que el resto del Backoffice (Planificador, Seguimiento). */}
      <div className="flex flex-wrap items-center gap-2 mb-5 bg-white border border-slate-200 rounded-xl p-3">
        <div className="flex bg-slate-100 rounded-lg p-1">
          {PRESETS.map((p) => (
            <button
              key={p.days}
              onClick={() => setPresetDays(p.days)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                presetDays === p.days ? "bg-white shadow-sm text-slate-800" : "text-slate-500"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
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
        <select
          value={carrierId}
          onChange={(e) => setCarrierId(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-1.5"
        >
          <option value="">Todos los transportistas</option>
          {carriersQuery.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legalName}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {data && (
        <>
          {/* Fase 8Y: petición explícita de Raúl -- "la analitica debe tener
              claramente visible de forma principal otd ots y otif". Fila
              propia, primero de todo y más grande que el resto de KPIs, en
              vez de mezclado en la rejilla general de abajo (donde antes
              solo estaba OTIF). Ver definición de cada métrica en
              dashboard.routes.ts (comentario junto a Bucket). */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="bg-white rounded-xl border-2 border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">OTD — Entrega a tiempo</p>
              <p className={`font-mono text-4xl font-bold mt-2 ${data.totals.otdPct == null ? "text-slate-300" : data.totals.otdPct >= 90 ? "text-teal-600" : "text-amber-600"}`}>
                {data.totals.otdPct == null ? "—" : `${data.totals.otdPct}%`}
              </p>
              <p className="text-xs text-slate-500 mt-1.5">
                {data.totals.otdEligible > 0
                  ? `Sobre ${data.totals.otdEligible} parada(s) con ETA planificada y albarán firmado`
                  : "Sin paradas con ETA planificada y entrega ya registrada en este periodo"}
              </p>
            </div>
            <div className="bg-white rounded-xl border-2 border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">OTS — Salida a tiempo</p>
              <p className={`font-mono text-4xl font-bold mt-2 ${data.totals.otsPct == null ? "text-slate-300" : data.totals.otsPct >= 90 ? "text-teal-600" : "text-amber-600"}`}>
                {data.totals.otsPct == null ? "—" : `${data.totals.otsPct}%`}
              </p>
              <p className="text-xs text-slate-500 mt-1.5">
                {data.totals.otsEligible > 0
                  ? `Sobre ${data.totals.otsEligible} envío(s) ya salidos a reparto. Aproximación: mide si salió el mismo día planificado, no la hora exacta (el sistema no guarda una hora de salida planificada)`
                  : "Sin envíos que hayan salido a reparto todavía en este periodo"}
              </p>
            </div>
            <div className="bg-white rounded-xl border-2 border-slate-200 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">OTIF del periodo</p>
              <p className={`font-mono text-4xl font-bold mt-2 ${data.totals.otifPct >= 90 ? "text-teal-600" : "text-amber-600"}`}>{data.totals.otifPct}%</p>
              <p className="text-xs text-slate-500 mt-1.5">Paradas completadas sobre el total de paradas del periodo</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Rutas en el periodo" value={data.totals.routes} />
            <KpiCard label="Incidencias" value={data.totals.incidents} tone={data.totals.incidents > 0 ? "danger" : "success"} />
            <KpiCard label="Coste real" value={formatEuros(data.totals.costReal)} />
            <KpiCard
              label="Desviación coste real vs. estimado"
              value={data.totals.costDeviationPct == null ? "—" : `${data.totals.costDeviationPct > 0 ? "+" : ""}${data.totals.costDeviationPct}%`}
              tone={data.totals.costDeviationPct == null ? "default" : data.totals.costDeviationPct > 10 ? "danger" : "success"}
            />
            <KpiCard
              label="Beneficio real (empresa)"
              value={formatEuros(data.totals.marginReal)}
              tone="success"
              sub={
                data.totals.marginUnknownLines > 0
                  ? `${data.totals.marginUnknownLines} liquidación(es) del periodo sin beneficio calculable (tarifa sin cobro a cliente configurado)`
                  : "Descarga × paradas + Ingreso €/TN Socios × toneladas, tarifa por circuito+vehículo"
              }
            />
            <KpiCard label="Distancia planificada" value={`${data.totals.distanceKm.toLocaleString("es-ES")} km`} />
            <KpiCard label="Pedidos por ruta (media)" value={data.totals.avgStopsPerRoute} />
            <KpiCard
              label="Pedido → salida (almacén, aprox.)"
              value={formatHours(data.totals.warehouseDwellAvgHours)}
              sub="Desde el alta del pedido hasta la salida real del envío -- no hay un evento de recepción de mercancía en almacén todavía, es una aproximación"
            />
            <KpiCard
              label="Salida → entrega al cliente"
              value={formatHours(data.totals.transitAvgHours)}
              sub="Solo paradas con justificante de entrega ya firmado"
            />
          </div>

          {data.buckets.length === 0 && (
            <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
              No hay rutas en este periodo con los filtros seleccionados.
            </p>
          )}

          {data.buckets.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard title="Coste, estimado y beneficio">
                <TimeSeriesLineChart
                  buckets={data.buckets}
                  groupBy={data.range.groupBy}
                  series={[
                    { key: "costReal", label: "Coste real", color: PALETTE.slot1 },
                    { key: "costEstimated", label: "Coste estimado", color: PALETTE.slot2 },
                    { key: "marginReal", label: "Beneficio real", color: PALETTE.slot3 },
                  ]}
                  valueFormatter={formatEuros}
                />
              </ChartCard>
              <ChartCard title="OTIF por periodo">
                <PeriodBarChart
                  buckets={data.buckets}
                  groupBy={data.range.groupBy}
                  valueKey="otifPct"
                  color={PALETTE.slot1}
                  valueFormatter={(v) => `${v}%`}
                  maxValue={100}
                />
              </ChartCard>
            </div>
          )}

          {data.topZones.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard title="Top zonas por volumen" subtitle="Kilos totales del periodo, por provincia de destino">
                <RankingBarChart items={data.topZones.map((z) => ({ label: z.zone, value: z.weightKg }))} color={PALETTE.slot1} valueFormatter={formatKg} />
              </ChartCard>
              <ChartCard title="Segmentación ABC de clientes" subtitle="Clasificación por peso acumulado (Pareto)">
                <AbcDonutChart rows={data.customerAbc} />
              </ChartCard>
            </div>
          )}

          {data.totals.routes > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard title="Segmentación de pedidos" subtitle="Nº de rutas del periodo por categoría de peso -- Maestros > Segmentación">
                <CategoryDonutChart
                  unitLabel="rutas"
                  rows={data.serviceTypeBreakdown.map((r) => ({
                    key: r.segment,
                    label: r.label,
                    value: r.routes,
                    color: SERVICE_TYPE_COLOR[r.segment] ?? PALETTE.muted,
                  }))}
                />
              </ChartCard>
              <ChartCard title="Modelo de transporte" subtitle="A portes / dedicado -- Configuración > Modelo de transporte">
                <CategoryDonutChart
                  unitLabel="rutas"
                  rows={data.transportModelBreakdown.map((r) => ({
                    key: r.model,
                    label: r.label,
                    value: r.routes,
                    color: TRANSPORT_MODEL_COLOR[r.model] ?? PALETTE.muted,
                  }))}
                />
              </ChartCard>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">Por transportista</h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-2">Transportista</th>
                    <th className="text-right px-4 py-2">Rutas</th>
                    <th className="text-right px-4 py-2">Incidencias</th>
                    <th className="text-right px-4 py-2">Coste real</th>
                    <th className="text-right px-4 py-2">Beneficio real</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.byCarrier.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                        Sin datos para este periodo.
                      </td>
                    </tr>
                  )}
                  {data.byCarrier.map((c) => (
                    <tr key={c.carrierId} className="hover:bg-brand-50/60">
                      <td className="px-4 py-2 font-medium text-slate-700">{c.legalName}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-600">{c.routes}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-600">{c.incidents}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-600">{formatEuros(c.costReal)}</td>
                      <td className="px-4 py-2 text-right font-mono text-emerald-600">
                        {formatEuros(c.marginReal)}
                        {c.marginUnknownLines > 0 && <span className="text-slate-400 text-xs ml-1">({c.marginUnknownLines} sin calcular)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <h2 className="text-sm font-semibold text-slate-700">Cumplimiento de entrega por cliente</h2>
                <p className="text-xs text-slate-400">Peor cumplimiento primero -- hasta 15 clientes con paradas en el periodo</p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-2">Cliente</th>
                    <th className="text-right px-4 py-2">Paradas</th>
                    <th className="text-right px-4 py-2">OTIF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.customerCompliance.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-slate-400">
                        Sin datos para este periodo.
                      </td>
                    </tr>
                  )}
                  {data.customerCompliance.map((c) => (
                    <tr key={c.customerId} className="hover:bg-brand-50/60">
                      <td className="px-4 py-2 font-medium text-slate-700">{c.legalName}</td>
                      <td className="px-4 py-2 text-right font-mono text-slate-600">
                        {c.stopsCompleted}/{c.stopsTotal}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <span className={`font-mono font-semibold ${c.otifPct >= 90 ? "text-teal-600" : c.otifPct >= 70 ? "text-amber-600" : "text-red-600"}`}>
                          {c.otifPct}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
        </div>
        <button onClick={() => setAsTable((v) => !v)} className="text-xs text-brand-600 hover:text-brand-700 font-medium shrink-0">
          {asTable ? "Ver gráfico" : "Ver como tabla"}
        </button>
      </div>
      {/* El toggle de tabla lo implementa cada gráfico (necesita sus propios
          datos/columnas); aquí solo se guarda el estado y se inyecta como prop
          en el único hijo (el gráfico) mediante cloneElement -- la forma
          correcta de React de añadir una prop a un elemento ya creado, en vez
          del spread manual sobre el elemento que se usó en un primer borrador
          y que no clona nada realmente. */}
      {isValidElement(children) ? cloneElement(children as React.ReactElement<{ asTable?: boolean }>, { asTable }) : children}
    </div>
  );
}

interface SeriesDef {
  key: keyof Bucket;
  label: string;
  color: string;
}

// Gráfico de líneas de hasta 2 series (coste real vs. estimado) -- eje único,
// líneas de 2px con extremo redondeado, marcador final de 8px con anillo de
// superficie, leyenda (2 series -> siempre visible), tooltip por proximidad al
// mover el ratón, y vista de tabla como alternativa accesible.
function TimeSeriesLineChart({
  buckets,
  groupBy,
  series,
  valueFormatter,
  asTable,
}: {
  buckets: Bucket[];
  groupBy: "day" | "week" | "month";
  series: SeriesDef[];
  valueFormatter: (v: number) => string;
  asTable?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 560;
  const height = 220;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;

  const allValues = buckets.flatMap((b) => series.map((s) => Number(b[s.key])));
  const maxValue = Math.max(1, ...allValues);
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  function x(i: number) {
    return buckets.length > 1 ? padL + (i / (buckets.length - 1)) * plotW : padL + plotW / 2;
  }
  function y(v: number) {
    return padT + plotH - (v / maxValue) * plotH;
  }

  if (asTable) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1 pr-3">Periodo</th>
              {series.map((s) => (
                <th key={s.key as string} className="text-left py-1 pr-3">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {buckets.map((b) => (
              <tr key={b.period}>
                <td className="py-1 pr-3">{formatPeriodLabel(b.period, groupBy)}</td>
                {series.map((s) => (
                  <td key={s.key as string} className="py-1 pr-3">
                    {valueFormatter(Number(b[s.key]))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width;
          const idx = buckets.length > 1 ? Math.round(((relX - padL) / plotW) * (buckets.length - 1)) : 0;
          setHoverIdx(Math.min(buckets.length - 1, Math.max(0, idx)));
        }}
      >
        {/* Gridlines horizontales, hairline, recesivas */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={width - padR}
            y1={padT + plotH * (1 - f)}
            y2={padT + plotH * (1 - f)}
            stroke={PALETTE.gridline}
            strokeWidth={1}
          />
        ))}

        {series.map((s) => {
          const points = buckets.map((b, i) => `${x(i)},${y(Number(b[s.key]))}`).join(" ");
          const lastIdx = buckets.length - 1;
          return (
            <g key={s.key as string}>
              <polyline points={points} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* Marcador final con anillo de superficie */}
              <circle cx={x(lastIdx)} cy={y(Number(buckets[lastIdx][s.key]))} r={5} fill={s.color} stroke={PALETTE.surface} strokeWidth={2} />
            </g>
          );
        })}

        {hoverIdx != null && (
          <line x1={x(hoverIdx)} x2={x(hoverIdx)} y1={padT} y2={padT + plotH} stroke={PALETTE.baseline} strokeWidth={1} />
        )}

        {/* Eje X: solo primera, última y la del hover (evita amontonar etiquetas) */}
        <text x={x(0)} y={height - 8} fontSize={10} fill={PALETTE.muted} textAnchor="start">
          {formatPeriodLabel(buckets[0].period, groupBy)}
        </text>
        <text x={x(buckets.length - 1)} y={height - 8} fontSize={10} fill={PALETTE.muted} textAnchor="end">
          {formatPeriodLabel(buckets[buckets.length - 1].period, groupBy)}
        </text>
      </svg>

      {hovered && (
        <div
          className="absolute top-0 bg-white border border-slate-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs pointer-events-none"
          style={{ left: `${(x(hoverIdx!) / width) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="font-medium text-slate-700 mb-0.5">{formatPeriodLabel(hovered.period, groupBy)}</p>
          {series.map((s) => (
            <p key={s.key as string} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: s.color }} />
              <span className="text-slate-500">{s.label}:</span>
              <span className="font-medium text-slate-700">{valueFormatter(Number(hovered[s.key]))}</span>
            </p>
          ))}
        </div>
      )}

      {/* Leyenda -- siempre presente con 2+ series */}
      <div className="flex items-center gap-4 mt-2">
        {series.map((s) => (
          <div key={s.key as string} className="flex items-center gap-1.5 text-xs text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  );
}

// Gráfico de barras de una sola serie (OTIF% por periodo) -- barras <=24px,
// esquina superior redondeada 4px, base cuadrada, hueco de 2px entre barras,
// sin leyenda (el título ya dice qué se representa), tooltip por barra.
function PeriodBarChart({
  buckets,
  groupBy,
  valueKey,
  color,
  valueFormatter,
  maxValue,
  asTable,
}: {
  buckets: Bucket[];
  groupBy: "day" | "week" | "month";
  valueKey: keyof Bucket;
  color: string;
  valueFormatter: (v: number) => string;
  maxValue?: number;
  asTable?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 560;
  const height = 220;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = buckets.map((b) => Number(b[valueKey]));
  const max = maxValue ?? Math.max(1, ...values);

  const gap = 2;
  const slot = plotW / buckets.length;
  const barWidth = Math.max(2, Math.min(24, slot - gap));

  if (asTable) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1 pr-3">Periodo</th>
              <th className="text-left py-1 pr-3">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {buckets.map((b) => (
              <tr key={b.period}>
                <td className="py-1 pr-3">{formatPeriodLabel(b.period, groupBy)}</td>
                <td className="py-1 pr-3">{valueFormatter(Number(b[valueKey]))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseLeave={() => setHoverIdx(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={padL}
            x2={width - padR}
            y1={padT + plotH * (1 - f)}
            y2={padT + plotH * (1 - f)}
            stroke={PALETTE.gridline}
            strokeWidth={1}
          />
        ))}

        {buckets.map((b, i) => {
          const v = Number(b[valueKey]);
          const barH = (v / max) * plotH;
          const cx = padL + i * slot + (slot - barWidth) / 2;
          const cy = padT + plotH - barH;
          return (
            <rect
              key={b.period}
              x={cx}
              y={cy}
              width={barWidth}
              height={Math.max(1, barH)}
              rx={4}
              fill={color}
              opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
              onMouseEnter={() => setHoverIdx(i)}
            />
          );
        })}

        <text x={padL} y={height - 8} fontSize={10} fill={PALETTE.muted} textAnchor="start">
          {formatPeriodLabel(buckets[0].period, groupBy)}
        </text>
        <text x={width - padR} y={height - 8} fontSize={10} fill={PALETTE.muted} textAnchor="end">
          {formatPeriodLabel(buckets[buckets.length - 1].period, groupBy)}
        </text>
      </svg>

      {hovered && hoverIdx != null && (
        <div
          className="absolute top-0 bg-white border border-slate-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs pointer-events-none"
          style={{ left: `${((padL + hoverIdx * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="font-medium text-slate-700">{formatPeriodLabel(hovered.period, groupBy)}</p>
          <p className="text-slate-500">{valueFormatter(Number(hovered[valueKey]))}</p>
        </div>
      )}
    </div>
  );
}

// Ranking horizontal de barras ("Top zonas por volumen"): serie única, sin
// necesidad de leyenda (el título ya dice qué mide) -- etiqueta de categoría a
// la izquierda, barra con extremo redondeado de 4px, valor en mono al final.
// Con 10 elementos como mucho, etiquetar cada barra directamente es más claro
// que exigir pasar el ratón por encima de cada una.
function RankingBarChart({
  items,
  color,
  valueFormatter,
  asTable,
}: {
  items: { label: string; value: number }[];
  color: string;
  valueFormatter: (v: number) => string;
  asTable?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));

  if (asTable) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1 pr-3">Zona</th>
              <th className="text-left py-1 pr-3">Peso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((i) => (
              <tr key={i.label}>
                <td className="py-1 pr-3">{i.label}</td>
                <td className="py-1 pr-3 font-mono">{valueFormatter(i.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (items.length === 0) {
    return <p className="text-sm text-slate-400 py-6 text-center">Sin datos para este periodo.</p>;
  }

  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs text-slate-600 truncate" title={i.label}>
            {i.label}
          </span>
          <div className="flex-1 h-3 bg-slate-100 rounded-sm overflow-hidden">
            <div className="h-full rounded-r" style={{ width: `${(i.value / max) * 100}%`, backgroundColor: color }} />
          </div>
          <span className="w-20 shrink-0 text-right text-xs font-mono text-slate-600">{valueFormatter(i.value)}</span>
        </div>
      ))}
    </div>
  );
}

// Dona de segmentación ABC de clientes: cada arco es el nº de clientes de esa
// clase (no el peso, que por construcción del propio corte de Pareto rondaría
// siempre 70/20/8/2 y no aportaría información) -- así se ve de un vistazo la
// concentración real (p.ej. pocos clientes A cargan la mayoría del peso).
// Leyenda siempre visible con el recuento de cada clase (nunca solo color),
// hueco de 2px de superficie entre arcos.
function AbcDonutChart({ rows, asTable }: { rows: AbcRow[]; asTable?: boolean }) {
  const total = rows.reduce((acc, r) => acc + r.customerCount, 0);

  if (asTable) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1 pr-3">Clase</th>
              <th className="text-left py-1 pr-3">Clientes</th>
              <th className="text-left py-1 pr-3">Peso</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.cls}>
                <td className="py-1 pr-3 font-mono font-bold">{r.cls}</td>
                <td className="py-1 pr-3">{r.customerCount}</td>
                <td className="py-1 pr-3">{formatKg(r.weightKg)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapPx = 2;
  let offsetAcc = 0;

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total === 0 ? (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={PALETTE.gridline} strokeWidth={strokeWidth} />
          ) : (
            rows
              .filter((r) => r.customerCount > 0)
              .map((r) => {
                const frac = r.customerCount / total;
                const dash = frac * circumference;
                const el = (
                  <circle
                    key={r.cls}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={ABC_COLOR[r.cls]}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${Math.max(0, dash - gapPx)} ${circumference - dash + gapPx}`}
                    strokeDashoffset={-offsetAcc}
                  />
                );
                offsetAcc += dash;
                return el;
              })
          )}
        </g>
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize={20} fontWeight={700} fill={PALETTE.textPrimary} fontFamily="monospace">
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={10} fill={PALETTE.muted}>
          clientes
        </text>
      </svg>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.cls} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: ABC_COLOR[r.cls] }} />
            <span className="font-mono font-bold text-slate-700">{r.cls}</span>
            <span className="text-slate-500">{ABC_DESCRIPTION[r.cls]}</span>
            <span className="ml-4 font-mono text-slate-600">{r.customerCount}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DonutRow {
  key: string;
  label: string;
  value: number;
  color: string;
}

// Fase 28: misma dona que AbcDonutChart (arcos con hueco de 2px, leyenda
// siempre visible con el recuento -- nunca solo color) pero generalizada
// sobre filas genéricas {key,label,value,color}, para no duplicar el SVG
// una tercera vez con "Segmentación de pedidos" y "Modelo de transporte".
function CategoryDonutChart({ rows, unitLabel, asTable }: { rows: DonutRow[]; unitLabel: string; asTable?: boolean }) {
  const total = rows.reduce((acc, r) => acc + r.value, 0);

  if (asTable) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr>
              <th className="text-left py-1 pr-3">Categoría</th>
              <th className="text-left py-1 pr-3">{unitLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-1 pr-3 font-medium text-slate-700">{r.label}</td>
                <td className="py-1 pr-3">{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapPx = 2;
  let offsetAcc = 0;

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {total === 0 ? (
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={PALETTE.gridline} strokeWidth={strokeWidth} />
          ) : (
            rows
              .filter((r) => r.value > 0)
              .map((r) => {
                const frac = r.value / total;
                const dash = frac * circumference;
                const el = (
                  <circle
                    key={r.key}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={r.color}
                    strokeWidth={strokeWidth}
                    strokeDasharray={`${Math.max(0, dash - gapPx)} ${circumference - dash + gapPx}`}
                    strokeDashoffset={-offsetAcc}
                  />
                );
                offsetAcc += dash;
                return el;
              })
          )}
        </g>
        <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize={20} fontWeight={700} fill={PALETTE.textPrimary} fontFamily="monospace">
          {total}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={10} fill={PALETTE.muted}>
          {unitLabel}
        </text>
      </svg>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: r.color }} />
            <span className="text-slate-700">{r.label}</span>
            <span className="ml-auto font-mono text-slate-600">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
