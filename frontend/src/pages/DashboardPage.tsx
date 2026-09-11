import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import KpiCard from "@/components/KpiCard";
import Panel from "@/components/Panel";
import SectionTitle from "@/components/SectionTitle";
import StatusBadge from "@/components/StatusBadge";
import PlannerMap, { MapPoint, ROUTE_COLORS, WAREHOUSE_COLOR } from "@/pages/planner/PlannerMap";

// Fase 8S: rediseño de "Inicio" como panel general de operaciones (petición
// de Raúl: "según accedes a la aplicación, [que] aparezca un resumen global
// del estado actualizado del sistema... datos, visibilidad, gráficos y demás
// componentes", con los colores corporativos de la web). Backend: un único
// endpoint nuevo GET /dashboard/home (ver dashboard.routes.ts) que combina lo
// que antes vivía repartido en /summary + /history + /incidents -- evita 4
// llamadas sueltas para pintar una sola pantalla de un vistazo.
//
// Gráficos dibujados a mano en SVG, mismo criterio ya establecido en
// AnalyticsPage.tsx (sin librería nueva, paleta categórica en orden fijo,
// barras con extremo redondeado, leyenda siempre visible con 2+ series,
// vista de tabla como alternativa accesible). El mapa reutiliza el mismo
// PlannerMap/Leaflet que Planificador y Seguimiento -- ninguna pantalla usa
// ya Google Maps, así que aquí tampoco hace falta introducirlo.

const PALETTE = {
  brand: "#03418c", // azul corporativo BigMat -- serie principal
  good: "#178a70",
  warning: "#c9791f",
  critical: "#e31d1a", // rojo corporativo BigMat -- reservado para alerta/incidencia
  surface: "#ffffff",
  textPrimary: "#0f172a",
  muted: "#94a3b8",
  gridline: "#e7eaf0",
};

interface Kpis {
  activeShipments: number;
  delayedShipments: number;
  pendingOrders: number;
  costToday: number;
  fleetEfficiencyPct: number;
}
interface WeeklyVolumePoint {
  date: string;
  shipments: number;
}
interface DeliveryStatusRow {
  key: string;
  label: string;
  count: number;
}
interface RecentShipmentRow {
  id: string;
  status: string;
  route: string;
  carrierName: string;
  vehiclePlate: string;
  routeDate: string;
  eta: string | null;
}
interface FleetUtilization {
  vehiclesTotal: number;
  vehiclesInUse: number;
  vehiclesAvailable: number;
  driversTotal: number;
  driversOnShift: number;
  driversAvailable: number;
}
interface CarrierCostRow {
  carrierId: string;
  legalName: string;
  costReal: number;
}
interface CriticalAlert {
  id: string;
  severity: "urgent" | "warning";
  title: string;
  subtitle: string;
}
interface HomeSummary {
  kpis: Kpis;
  weeklyVolume: WeeklyVolumePoint[];
  deliveryStatus: DeliveryStatusRow[];
  recentShipments: RecentShipmentRow[];
  fleetUtilization: FleetUtilization;
  costByCarrier: CarrierCostRow[];
  criticalAlerts: CriticalAlert[];
}

interface LiveShipment {
  id: string;
  status: string;
  route: { warehouse: { name: string; lat: number | null; lng: number | null } };
  vehicle: { plate: string } | null;
  driver: { fullName: string } | null;
  lastPosition: { lat: number; lng: number; occurredAt: string } | null;
}

const GETAFE_CENTER = { lat: 40.3058, lng: -3.7327 };

const DELIVERY_STATUS_COLOR: Record<string, string> = {
  en_transito: PALETTE.brand,
  entregado: PALETTE.good,
  retrasado: PALETTE.warning,
  problemas: PALETTE.critical,
};

function formatEuros(n: number) {
  return `${n.toLocaleString("es-ES", { maximumFractionDigits: 0 })} €`;
}

function formatDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "");
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return "hace unos segundos";
  if (minutes < 60) return `hace ${minutes} min`;
  return `hace ${Math.round(minutes / 60)} h`;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery<HomeSummary>({
    queryKey: ["dashboard-home"],
    queryFn: async () => (await api.get("/dashboard/home")).data,
    refetchInterval: 30000,
  });

  const liveQuery = useQuery({
    queryKey: ["shipments"],
    queryFn: async () => (await api.get("/shipments")).data as { items: LiveShipment[]; total: number },
    refetchInterval: 30000,
  });

  const activeShipments = useMemo(
    () => (liveQuery.data?.items ?? []).filter((s) => s.status === "loaded" || s.status === "in_transit"),
    [liveQuery.data]
  );

  const mapPoints: MapPoint[] = useMemo(() => {
    const withPosition = activeShipments.filter((s) => s.lastPosition != null);
    if (withPosition.length > 0) {
      return withPosition.map((s, idx) => ({
        id: s.id,
        lat: s.lastPosition!.lat,
        lng: s.lastPosition!.lng,
        label: `${s.vehicle?.plate ?? "Vehículo"} — ${s.driver?.fullName ?? "sin conductor"} (${timeAgo(s.lastPosition!.occurredAt)})`,
        color: ROUTE_COLORS[idx % ROUTE_COLORS.length],
      }));
    }
    // Sin ningún ping GPS todavía: se pinta al menos el almacén de origen de
    // cada envío activo, para que el mapa nunca se vea vacío de entrada
    // (mismo criterio de respaldo ya usado en Seguimiento).
    const warehouses = new Map<string, MapPoint>();
    for (const s of activeShipments) {
      const w = s.route.warehouse;
      if (w.lat == null || w.lng == null) continue;
      warehouses.set(w.name, { id: w.name, lat: w.lat, lng: w.lng, label: w.name, color: WAREHOUSE_COLOR });
    }
    return [...warehouses.values()];
  }, [activeShipments]);

  const mapCenter = mapPoints[0] ? { lat: mapPoints[0].lat, lng: mapPoints[0].lng } : GETAFE_CENTER;

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Inicio</h1>
      <p className="text-sm text-slate-500 mb-6">Resumen operativo del sistema, en tiempo real</p>

      <SectionTitle>Indicadores globales</SectionTitle>
      {isLoading || !data ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label="Envíos activos" value={data.kpis.activeShipments} tone="accent" sub="cargados o en tránsito" />
          <KpiCard
            label="Envíos retrasados"
            value={data.kpis.delayedShipments}
            tone={data.kpis.delayedShipments > 0 ? "danger" : "success"}
            sub="con ETA superada"
          />
          <KpiCard label="Pedidos pendientes" value={data.kpis.pendingOrders} sub="por planificar" />
          <KpiCard label="Coste transporte hoy" value={formatEuros(data.kpis.costToday)} sub="liquidado + estimado" />
          <KpiCard
            label="Eficiencia de flota"
            value={`${data.kpis.fleetEfficiencyPct}%`}
            tone={data.kpis.fleetEfficiencyPct >= 90 ? "success" : "warning"}
            sub="OTIF de hoy"
          />
        </div>
      )}

      <SectionTitle>Visibilidad operativa</SectionTitle>
      <div className="grid grid-cols-12 gap-4">
        <Panel
          title="Mapa de envíos en tiempo real"
          description={`${activeShipments.length} envío(s) en curso ahora mismo`}
          className="col-span-12 lg:col-span-7"
        >
          <PlannerMap center={mapCenter} points={mapPoints} height={320} />
        </Panel>
        <ChartCard title="Volumen de envíos semanal" subtitle="Últimos 7 días" className="col-span-12 lg:col-span-5">
          {data && <WeeklyVolumeChart points={data.weeklyVolume} />}
        </ChartCard>
      </div>

      <SectionTitle>Actividad</SectionTitle>
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Estados de entrega" subtitle="Paradas de las rutas de hoy">
          {data && <DeliveryStatusChart rows={data.deliveryStatus} />}
        </ChartCard>
        <ChartCard title="Coste por transportista" subtitle="Últimos 7 días">
          {data && <CarrierCostDonut rows={data.costByCarrier} />}
        </ChartCard>
      </div>

      <SectionTitle>Resumen de envíos recientes</SectionTitle>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Estado</th>
              <th className="text-left px-4 py-2">Ruta</th>
              <th className="text-left px-4 py-2">Transportista</th>
              <th className="text-left px-4 py-2">Vehículo</th>
              <th className="text-left px-4 py-2">Fecha</th>
              <th className="text-left px-4 py-2">ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!data || data.recentShipments.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  {isLoading ? "Cargando…" : "Todavía no hay envíos registrados."}
                </td>
              </tr>
            ) : (
              data.recentShipments.map((s) => (
                <tr key={s.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-2">
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-700">{s.route}</td>
                  <td className="px-4 py-2 text-slate-600">{s.carrierName}</td>
                  <td className="px-4 py-2 font-mono text-slate-600">{s.vehiclePlate}</td>
                  <td className="px-4 py-2 text-slate-600">{new Date(s.routeDate).toLocaleDateString("es-ES")}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {s.eta ? new Date(s.eta).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <SectionTitle>Flota y alertas</SectionTitle>
      <div className="grid md:grid-cols-2 gap-4">
        <Panel title="Alertas críticas" description="Incidencias abiertas y avisos de mantenimiento">
          {!data || data.criticalAlerts.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Sin alertas activas ahora mismo.</p>
          ) : (
            <ul className="space-y-2">
              {data.criticalAlerts.map((a) => (
                <li key={a.id} className="flex items-start gap-2.5">
                  <span
                    className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.severity === "urgent" ? "bg-red-600" : "bg-amber-500"}`}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{a.title}</p>
                    <p className="text-xs text-slate-500">{a.subtitle}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Utilización de flota" description="Vehículos y conductores disponibles ahora mismo">
          {data && <FleetUtilizationBars fleet={data.fleetUtilization} />}
        </Panel>
      </div>
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

// Barras verticales de una sola serie -- volumen de envíos por día de la
// última semana. Mismo mark spec que PeriodBarChart de Analítica (extremo
// superior redondeado, hueco de 2px, base cuadrada).
function WeeklyVolumeChart({ points }: { points: WeeklyVolumePoint[] }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const width = 420;
  const height = 200;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const max = Math.max(1, ...points.map((p) => p.shipments));
  const gap = 4;
  const slot = plotW / points.length;
  const barWidth = Math.max(6, Math.min(36, slot - gap));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseLeave={() => setHoverIdx(null)}>
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={padL} x2={width - padR} y1={padT + plotH * (1 - f)} y2={padT + plotH * (1 - f)} stroke={PALETTE.gridline} strokeWidth={1} />
        ))}
        {points.map((p, i) => {
          const barH = (p.shipments / max) * plotH;
          const cx = padL + i * slot + (slot - barWidth) / 2;
          const cy = padT + plotH - barH;
          return (
            <g key={p.date}>
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
              <text x={cx + barWidth / 2} y={height - 6} fontSize={10} fill={PALETTE.muted} textAnchor="middle">
                {formatDayLabel(p.date)}
              </text>
            </g>
          );
        })}
      </svg>
      {hoverIdx != null && (
        <div
          className="absolute top-0 bg-white border border-slate-200 rounded-lg shadow-md px-2.5 py-1.5 text-xs pointer-events-none"
          style={{ left: `${((padL + hoverIdx * slot + slot / 2) / width) * 100}%`, transform: "translateX(-50%)" }}
        >
          <p className="font-medium text-slate-700">{new Date(points[hoverIdx].date).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</p>
          <p className="text-slate-500">{points[hoverIdx].shipments} envío(s)</p>
        </div>
      )}
    </div>
  );
}

// Barras horizontales de estado de entrega -- 4 categorías fijas con color
// semántico (nunca cíclico): azul de marca = en curso, verde = entregado,
// ámbar = retrasado, rojo corporativo = con incidencia. Etiqueta + valor
// siempre visibles (nunca solo color), como pide la guía de accesibilidad.
function DeliveryStatusChart({ rows }: { rows: DeliveryStatusRow[] }) {
  const total = rows.reduce((acc, r) => acc + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));

  if (total === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">No hay rutas programadas para hoy.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="w-28 shrink-0 text-xs font-medium text-slate-600">{r.label}</span>
          <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
            <div
              className="h-full rounded-r transition-all"
              style={{ width: `${(r.count / max) * 100}%`, backgroundColor: DELIVERY_STATUS_COLOR[r.key] ?? PALETTE.muted }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-sm font-mono font-semibold text-slate-700">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

// Dona de coste por transportista -- paleta categórica en orden fijo
// (ROUTE_COLORS, la misma que ya usan Planificador/Seguimiento para
// distinguir rutas), leyenda siempre visible con el importe de cada uno.
function CarrierCostDonut({ rows }: { rows: CarrierCostRow[] }) {
  const total = rows.reduce((acc, r) => acc + r.costReal, 0);

  if (rows.length === 0 || total === 0) {
    return <p className="text-sm text-slate-400 text-center py-6">Sin liquidaciones en los últimos 7 días.</p>;
  }

  const size = 150;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const gapPx = 2;
  let offsetAcc = 0;

  return (
    <div className="flex items-center gap-6 flex-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {rows.map((r, idx) => {
            const frac = r.costReal / total;
            const dash = frac * circumference;
            const el = (
              <circle
                key={r.carrierId}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={ROUTE_COLORS[idx % ROUTE_COLORS.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={`${Math.max(0, dash - gapPx)} ${circumference - dash + gapPx}`}
                strokeDashoffset={-offsetAcc}
              />
            );
            offsetAcc += dash;
            return el;
          })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" fontSize={13} fontWeight={700} fill={PALETTE.textPrimary} fontFamily="monospace">
          {formatEuros(total)}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize={9} fill={PALETTE.muted}>
          7 días
        </text>
      </svg>
      <div className="space-y-1.5 min-w-0">
        {rows.map((r, idx) => (
          <div key={r.carrierId} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ backgroundColor: ROUTE_COLORS[idx % ROUTE_COLORS.length] }} />
            <span className="text-slate-600 truncate max-w-[9rem]" title={r.legalName}>
              {r.legalName}
            </span>
            <span className="ml-auto font-mono text-slate-700">{formatEuros(r.costReal)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Ocupación de flota y conductores -- dos barras de progreso simples (más
// legible que dos donas pequeñas para solo 2 categorías cada una: en uso vs.
// disponible), con las cifras absolutas siempre visibles junto a la barra.
function FleetUtilizationBars({ fleet }: { fleet: FleetUtilization }) {
  const vehiclePct = fleet.vehiclesTotal > 0 ? Math.round((fleet.vehiclesInUse / fleet.vehiclesTotal) * 100) : 0;
  const driverPct = fleet.driversTotal > 0 ? Math.round((fleet.driversOnShift / fleet.driversTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vehículos</span>
          <span className="text-sm font-mono font-bold text-slate-800">{vehiclePct}% en uso</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-sm overflow-hidden">
          <div className="h-full rounded-r bg-brand-600" style={{ width: `${vehiclePct}%` }} />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {fleet.vehiclesInUse} en uso · {fleet.vehiclesAvailable} disponibles · {fleet.vehiclesTotal} en total
        </p>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Conductores</span>
          <span className="text-sm font-mono font-bold text-slate-800">{driverPct}% de servicio</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-sm overflow-hidden">
          <div className="h-full rounded-r" style={{ width: `${driverPct}%`, backgroundColor: PALETTE.good }} />
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {fleet.driversOnShift} de servicio · {fleet.driversAvailable} disponibles · {fleet.driversTotal} en total
        </p>
      </div>
    </div>
  );
}
