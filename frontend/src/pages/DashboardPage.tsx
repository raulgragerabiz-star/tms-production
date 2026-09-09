import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import KpiCard from "@/components/KpiCard";
import Panel from "@/components/Panel";
import SectionTitle from "@/components/SectionTitle";

interface Summary {
  pendingOrders: number;
  routesInPreparation: number;
  inTransitShipments: number;
  deliveredToday: number;
  totalStopsToday: number;
  otifPct: number;
  openIncidents: number;
  costToday: number;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery<Summary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary")).data,
    refetchInterval: 30000,
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Inicio</h1>
      <p className="text-sm text-slate-500 mb-6">Resumen operativo del día</p>

      <SectionTitle>Indicadores globales</SectionTitle>

      {isLoading || !data ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Pedidos pendientes" value={data.pendingOrders} sub="por planificar" />
          <KpiCard label="Rutas en preparación" value={data.routesInPreparation} sub="sin confirmar todavía" />
          <KpiCard label="Envíos en tránsito" value={data.inTransitShipments} tone="accent" sub="circulando ahora mismo" />
          <KpiCard
            label="Entregas hoy"
            value={`${data.deliveredToday}/${data.totalStopsToday}`}
            tone="success"
            sub="paradas completadas / totales"
          />
          <KpiCard
            label="OTIF del día"
            value={`${data.otifPct}%`}
            tone={data.otifPct >= 90 ? "success" : "warning"}
            sub="a tiempo y completo"
          />
          <KpiCard
            label="Incidencias abiertas"
            value={data.openIncidents}
            tone={data.openIncidents > 0 ? "danger" : "success"}
            sub="pendientes de resolver"
          />
          <KpiCard label="Coste transporte hoy" value={`${data.costToday.toFixed(2)} €`} sub="liquidado + estimado" />
        </div>
      )}

      <SectionTitle>Actividad</SectionTitle>

      <div className="grid md:grid-cols-3 gap-3">
        <Panel title="Hoy">
          <p className="text-xs text-slate-500">
            Pedidos pendientes de planificar y rutas todavía sin transportista asignado antes del corte de
            expedición. Ve a <span className="font-medium text-slate-700">Pedidos</span> o al{" "}
            <span className="font-medium text-slate-700">Planificador</span> para actuar.
          </p>
        </Panel>
        <Panel title="En curso">
          <p className="text-xs text-slate-500">
            <span className="font-mono font-bold text-slate-700">{data ? data.inTransitShipments : "…"}</span> envíos
            en tránsito ahora mismo. El seguimiento GPS en vivo se habilita al integrar telemática (Versión 1 del
            roadmap).
          </p>
        </Panel>
        <Panel title="Atención">
          <p className="text-xs text-slate-500">
            <span className="font-mono font-bold text-slate-700">{data ? data.openIncidents : "…"}</span> incidencias
            abiertas. Revisa el detalle en Facturación/Planificador según el módulo afectado.
          </p>
        </Panel>
      </div>
    </div>
  );
}
