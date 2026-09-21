import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import KpiCard from "@/components/KpiCard";
import Panel from "@/components/Panel";
import SectionTitle from "@/components/SectionTitle";
import ClientDistanceMap, { ClientMapPoint, MapWarehouse, DistanceTierDef } from "@/pages/dashboard/ClientDistanceMap";

// Fase 16: "Inicio" pasa a ser SOLO el panel de indicadores acumulados +
// mapa interactivo de clientes que pidió Raúl -- sustituye por completo al
// panel de la Fase 8S (KPIs de hoy, mapa de envíos en tiempo real, volumen
// semanal, estados de entrega, coste por transportista 7 días, envíos
// recientes, alertas de flota). Petición explícita: "estos datos nuevos son
// los que sustituyen al panel de inicio que existía... solo la parte de
// indicadores acumulados". El resto de esa información operativa del día
// (envíos en curso, incidencias, flota) sigue disponible en Seguimiento y
// Planificación -- no se ha borrado nada del backend, solo esta pantalla ya
// no la muestra.
//
// Gráficos dibujados a mano en SVG, mismo criterio ya establecido en
// AnalyticsPage.tsx (sin librería nueva, paleta en orden fijo, barras con
// extremo redondeado, hueco de 2px, rejilla recesiva, etiqueta+valor siempre
// visibles).

const PALETTE = {
  brand: "#03418c", // azul corporativo BigMat -- serie principal
  good: "#178a70",
  warning: "#c9791f",
  critical: "#e31d1a", // rojo corporativo BigMat -- reservado para alerta/incidencia
  muted: "#94a3b8",
  gridline: "#e7eaf0",
};

interface MonthKg {
  month: string;
  kg: number;
}
interface WeekdayReparto {
  day: number;
  label: string;
  weightKg: number;
}
interface TopRoute {
  name: string;
  weightKg: number;
}
interface Accumulated {
  toneladas: { totalKg: number; totalTn: number; porMes: MonthKg[] };
  pedidos: { total: number };
  reparto: { porDiaSemana: WeekdayReparto[] };
  rutas: { operativas: number; topPorVolumen: TopRoute[] };
  kpi: {
    otdPct: number | null;
    otdEligible: number;
    otsPct: number | null;
    otsEligible: number;
    otifPct: number;
    stopsTotal: number;
    stopsCompleted: number;
  };
  finanzas: { costeAcumulado: number; margenAcumulado: number; marginUnknownLines: number };
}
interface ClientsMapResponse {
  warehouses: MapWarehouse[];
  distanceTiers: DistanceTierDef[];
  clients: ClientMapPoint[];
  skippedNoOrders: number;
  skippedNoCoordinates: number;
}

function formatEuros(n: number) {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
}

function apiErrorMessage(err: unknown): string {
  const anyErr = err as { response?: { data?: { message?: string } }; message?: string } | undefined;
  return anyErr?.response?.data?.message ?? anyErr?.message ?? "error desconocido";
}

export default function DashboardPage() {
  // Fase 16: indicadores acumulados (todo el histórico, sin ventana de
  // fecha) + mapa de clientes. Refetch cada 5 min -- de sobra para datos que,
  // por definición, cambian poco a poco.
  const accumulatedQuery = useQuery<Accumulated>({
    queryKey: ["dashboard-accumulated"],
    queryFn: async () => (await api.get("/dashboard/accumulated")).data,
    refetchInterval: 300000,
  });
  const clientsMapQuery = useQuery<ClientsMapResponse>({
    queryKey: ["dashboard-clients-map"],
    queryFn: async () => (await api.get("/dashboard/clients-map")).data,
    refetchInterval: 300000,
  });
  const accumulated = accumulatedQuery.data;
  const clientsMap = clientsMapQuery.data;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Inicio</h1>
      <p className="text-sm text-slate-500 mb-6">Indicadores acumulados del sistema, histórico completo</p>

      <SectionTitle>Indicadores acumulados</SectionTitle>
      <p className="text-xs text-slate-400 -mt-2 mb-3">Todo el histórico registrado en el sistema, sin ventana de fecha</p>
      {accumulatedQuery.isError ? (
        <p className="text-sm text-red-600">No se han podido cargar los indicadores acumulados ({apiErrorMessage(accumulatedQuery.error)}).</p>
      ) : accumulatedQuery.isLoading || !accumulated ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <KpiCard label="Toneladas movidas" value={`${accumulated.toneladas.totalTn.toLocaleString("es-ES")} Tn`} sub="acumulado total" />
            <KpiCard label="Pedidos registrados" value={accumulated.pedidos.total.toLocaleString("es-ES")} sub="acumulado total" />
            <KpiCard label="Rutas operativas" value={accumulated.rutas.operativas} sub="circuitos de reparto activos" />
            <KpiCard
              label="OTD"
              value={accumulated.kpi.otdPct != null ? `${accumulated.kpi.otdPct}%` : "s/d"}
              tone={accumulated.kpi.otdPct == null ? "default" : accumulated.kpi.otdPct >= 90 ? "success" : "warning"}
              sub="entrega a tiempo"
            />
            <KpiCard
              label="OTS"
              value={accumulated.kpi.otsPct != null ? `${accumulated.kpi.otsPct}%` : "s/d"}
              tone={accumulated.kpi.otsPct == null ? "default" : accumulated.kpi.otsPct >= 90 ? "success" : "warning"}
              sub="salida a tiempo"
            />
            <KpiCard
              label="OTIF"
              value={`${accumulated.kpi.otifPct}%`}
              tone={accumulated.kpi.otifPct >= 90 ? "success" : "warning"}
              sub={`${accumulated.kpi.stopsCompleted}/${accumulated.kpi.stopsTotal} paradas`}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <ChartCard title="Toneladas movidas por mes" subtitle="Kg acumulados, histórico completo">
              <MonthlyKgChart points={accumulated.toneladas.porMes} />
            </ChartCard>
            <ChartCard title="Reparto acumulado por día de la semana" subtitle="Kg movidos, histórico completo">
              <WeekdayRepartoChart rows={accumulated.reparto.porDiaSemana} />
            </ChartCard>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <ChartCard title="Top rutas por volumen" subtitle="Circuito de reparto, kg acumulados">
              <TopRoutesChart rows={accumulated.rutas.topPorVolumen} />
            </ChartCard>
            <ChartCard title="Coste acumulado vs. beneficio acumulado" subtitle="Liquidaciones históricas (Fase 14)">
              <CostVsMarginChart costeAcumulado={accumulated.finanzas.costeAcumulado} margenAcumulado={accumulated.finanzas.margenAcumulado} />
              {accumulated.finanzas.marginUnknownLines > 0 && (
                <p className="text-xs text-slate-400 mt-2">
                  {accumulated.finanzas.marginUnknownLines} línea(s) de liquidación sin beneficio calculable, no incluidas.
                </p>
              )}
            </ChartCard>
          </div>
        </>
      )}

      <SectionTitle>Mapa de clientes por distancia</SectionTitle>
      {clientsMapQuery.isError ? (
        <p className="text-sm text-red-600">No se ha podido cargar el mapa de clientes ({apiErrorMessage(clientsMapQuery.error)}).</p>
      ) : clientsMapQuery.isLoading || !clientsMap ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : clientsMap.warehouses.length === 0 ? (
        <p className="text-sm text-slate-400">
          Ningún almacén tiene coordenadas configuradas todavía, así que no se puede calcular el radio de distancia.
        </p>
      ) : (
        <Panel description={`${clientsMap.clients.length} cliente(s) geolocalizados sobre el total`}>
          <ClientDistanceMap warehouses={clientsMap.warehouses} clients={clientsMap.clients} distanceTiers={clientsMap.distanceTiers} />
          {(clientsMap.skippedNoCoordinates > 0 || clientsMap.skippedNoOrders > 0) && (
            <p className="text-xs text-slate-400 mt-3">
              {clientsMap.skippedNoCoordinates > 0 && `${clientsMap.skippedNoCoordinates} cliente(s) sin dirección geolocalizada. `}
              {clientsMap.skippedNoOrders > 0 && `${clientsMap.skippedNoOrders} cliente(s) sin pedidos registrados todavía.`}
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      {subtitle && <p className="text-xs text-slate-400 mb-3">{subtitle}</p>}
      <div className={subtitle ? "" : "mt-3"}>{children}</div>
    </div>
  );
}

// "kg por mes" -- barras verticales, extremo superior redondeado, hueco de
// 2px, rejilla recesiva -- misma anatomía que el resto de gráficos de barra
// de la app (AnalyticsPage.tsx).
function formatMonthLabel(monthKey: string) {
  return new Date(`${monthKey}-15`).toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", "");
}
function formatKg(kg: number) {
  return kg >= 1000 ? `${(kg / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} Tn` : `${kg.toLocaleString("es-ES")} kg`;
}

function MonthlyKgChart({ points }: { points: MonthKg[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 420;
  const height = 200;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  if (points.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin movimientos registrados todavía.</p>;
  }

  const max = Math.max(1, ...points.map((p) => p.kg));
  const gap = 4;
  const slot = plotW / points.length;
  const barWidth = Math.max(4, Math.min(28, slot - gap));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseLeave={() => setHoverIdx(null)}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={width - padR} y1={padT + plotH * (1 - f)} y2={padT + plotH * (1 - f)} stroke={PALETTE.gridline} strokeWidth={1} />
        ))}
        {points.map((p, i) => {
          const barH = (p.kg / max) * plotH;
          const cx = padL + i * slot + (slot - barWidth) / 2;
          const cy = padT + plotH - barH;
          return (
            <g key={p.month}>
              <rect
                x={cx}
                y={cy}
                width={barWidth}
                height={Math.max(1, barH)}
                rx={4}
                fill={PALETTE.brand}
                opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}
                onMouseEnter={() => setHoverIdx(i)}
              />
              {(i % Math.ceil(points.length / 8) === 0 || i === points.length - 1) && (
                <text x={cx + barWidth / 2} y={height - 6} fontSize={9} fill={PALETTE.muted} textAnchor="middle">
                  {formatMonthLabel(p.month)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hoverIdx != null && (
        <div
          className="absolute top-0 bg-white border border-slate-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs pointer-events-none"
          style={{ left: `${((padL + hoverIdx * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="font-medium text-slate-700">{formatMonthLabel(points[hoverIdx].month)}</p>
          <p className="text-slate-500">{formatKg(points[hoverIdx].kg)}</p>
        </div>
      )}
    </div>
  );
}

// "reparto acumulado por día de la semana" -- 7 barras fijas (L-D), barras
// horizontales con etiqueta+valor siempre visibles (nunca solo color).
function WeekdayRepartoChart({ rows }: { rows: WeekdayReparto[] }) {
  const max = Math.max(1, ...rows.map((r) => r.weightKg));
  const total = rows.reduce((acc, r) => acc + r.weightKg, 0);

  if (total === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin movimientos registrados todavía.</p>;
  }

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.day} className="flex items-center gap-3">
          <span className="w-20 shrink-0 text-xs font-medium text-slate-600">{r.label}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
            <div className="h-full rounded-r" style={{ width: `${(r.weightKg / max) * 100}%`, backgroundColor: PALETTE.brand }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs font-mono font-semibold text-slate-700">{formatKg(r.weightKg)}</span>
        </div>
      ))}
    </div>
  );
}

// "top rutas por volumen" -- ranking por magnitud (no identidad de
// categorías distintas), así que un único tono en vez de una paleta
// categórica -- mismo criterio que la guía de dataviz para rankings de una
// sola métrica.
function TopRoutesChart({ rows }: { rows: TopRoute[] }) {
  const max = Math.max(1, ...rows.map((r) => r.weightKg));

  if (rows.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Todavía no hay circuitos con movimientos registrados.</p>;
  }

  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-3">
          <span className="w-24 shrink-0 text-xs font-medium text-slate-600 truncate" title={r.name}>
            {r.name}
          </span>
          <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
            <div className="h-full rounded-r" style={{ width: `${(r.weightKg / max) * 100}%`, backgroundColor: PALETTE.brand }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs font-mono font-semibold text-slate-700">{formatKg(r.weightKg)}</span>
        </div>
      ))}
    </div>
  );
}

// "coste acumulado vs. beneficio acumulado" -- comparación de 2 categorías
// con significado semántico propio (coste = azul de marca, beneficio =
// verde "success"), no una paleta categórica de N series.
function CostVsMarginChart({ costeAcumulado, margenAcumulado }: { costeAcumulado: number; margenAcumulado: number }) {
  const max = Math.max(1, costeAcumulado, margenAcumulado);

  if (costeAcumulado === 0 && margenAcumulado === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin liquidaciones registradas todavía.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs font-medium text-slate-600">Coste</span>
        <div className="flex-1 h-5 bg-slate-100 rounded-sm overflow-hidden">
          <div className="h-full rounded-r" style={{ width: `${(costeAcumulado / max) * 100}%`, backgroundColor: PALETTE.brand }} />
        </div>
        <span className="w-24 shrink-0 text-right text-sm font-mono font-semibold text-slate-700">{formatEuros(costeAcumulado)}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-xs font-medium text-slate-600">Beneficio</span>
        <div className="flex-1 h-5 bg-slate-100 rounded-sm overflow-hidden">
          <div className="h-full rounded-r" style={{ width: `${(margenAcumulado / max) * 100}%`, backgroundColor: PALETTE.good }} />
        </div>
        <span className="w-24 shrink-0 text-right text-sm font-mono font-semibold text-slate-700">{formatEuros(margenAcumulado)}</span>
      </div>
    </div>
  );
}
