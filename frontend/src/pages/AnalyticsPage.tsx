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
  slot1: "#2a78d6", // azul -- serie principal (coste real / OTIF)
  slot2: "#eb6834", // naranja -- segunda serie (coste estimado)
  surface: "#fcfcfb",
  textPrimary: "#0b0b0b",
  textSecondary: "#52514e",
  muted: "#898781",
  gridline: "#e1e0d9",
  baseline: "#c3c2b7",
  good: "#0ca30c",
  warning: "#fab219",
  critical: "#d03b3b",
};

interface Bucket {
  period: string;
  routes: number;
  otifPct: number;
  incidents: number;
  costReal: number;
  costEstimated: number;
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
}

interface HistoryResponse {
  range: { from: string; to: string; groupBy: "day" | "week" | "month" };
  totals: {
    routes: number;
    otifPct: number;
    incidents: number;
    incidentRatePct: number;
    costReal: number;
    costEstimated: number;
    costDeviationPct: number | null;
    distanceKm: number;
  };
  buckets: Bucket[];
  byCarrier: CarrierRow[];
}

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

export default function AnalyticsPage() {
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
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Analítica</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Histórico de coste, OTIF, incidencias y ocupación de la flota por periodo.
      </p>

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
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KpiCard label="Rutas en el periodo" value={data.totals.routes} />
            <KpiCard label="OTIF del periodo" value={`${data.totals.otifPct}%`} tone={data.totals.otifPct >= 90 ? "success" : "warning"} />
            <KpiCard label="Incidencias" value={data.totals.incidents} tone={data.totals.incidents > 0 ? "danger" : "success"} />
            <KpiCard label="Coste real" value={formatEuros(data.totals.costReal)} />
            <KpiCard
              label="Desviación coste real vs. estimado"
              value={data.totals.costDeviationPct == null ? "—" : `${data.totals.costDeviationPct > 0 ? "+" : ""}${data.totals.costDeviationPct}%`}
              tone={data.totals.costDeviationPct == null ? "default" : data.totals.costDeviationPct > 10 ? "danger" : "success"}
            />
            <KpiCard label="Distancia planificada" value={`${data.totals.distanceKm.toLocaleString("es-ES")} km`} />
          </div>

          {data.buckets.length === 0 && (
            <p className="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-6 text-center">
              No hay rutas en este periodo con los filtros seleccionados.
            </p>
          )}

          {data.buckets.length > 0 && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              <ChartCard title="Coste real vs. estimado">
                <TimeSeriesLineChart
                  buckets={data.buckets}
                  groupBy={data.range.groupBy}
                  series={[
                    { key: "costReal", label: "Coste real", color: PALETTE.slot1 },
                    { key: "costEstimated", label: "Coste estimado", color: PALETTE.slot2 },
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

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Por transportista</h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Transportista</th>
                  <th className="text-left px-4 py-2">Rutas</th>
                  <th className="text-left px-4 py-2">Incidencias</th>
                  <th className="text-left px-4 py-2">Coste real</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byCarrier.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      Sin datos para este periodo.
                    </td>
                  </tr>
                )}
                {data.byCarrier.map((c) => (
                  <tr key={c.carrierId} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700">{c.legalName}</td>
                    <td className="px-4 py-2">{c.routes}</td>
                    <td className="px-4 py-2">{c.incidents}</td>
                    <td className="px-4 py-2">{formatEuros(c.costReal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        <button onClick={() => setAsTable((v) => !v)} className="text-xs text-brand-600 hover:text-brand-700 font-medium">
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
