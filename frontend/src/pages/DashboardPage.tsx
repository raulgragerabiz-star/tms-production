import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import KpiCard from "@/components/KpiCard";

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

      {isLoading || !data ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <KpiCard label="Pedidos pendientes" value={data.pendingOrders} />
          <KpiCard label="Rutas en preparación" value={data.routesInPreparation} />
          <KpiCard label="Envíos en tránsito" value={data.inTransitShipments} tone="default" />
          <KpiCard label="Entregas hoy" value={`${data.deliveredToday}/${data.totalStopsToday}`} tone="success" />
          <KpiCard label="OTIF del día" value={`${data.otifPct}%`} tone={data.otifPct >= 90 ? "success" : "warning"} />
          <KpiCard label="Incidencias abiertas" value={data.openIncidents} tone={data.openIncidents > 0 ? "danger" : "success"} />
          <KpiCard label="Coste transporte hoy" value={`${data.costToday.toFixed(2)} €`} />
        </div>
      )}

      <div className="grid md:grid-cols-3 gap-4">
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-sm text-slate-700 mb-2">Hoy</h2>
          <p className="text-xs text-slate-500">
            Pedidos pendientes de planificar y rutas todavía sin transportista asignado antes del corte de
            expedición. Ve a <span className="font-medium">Pedidos</span> o al <span className="font-medium">Planificador</span> para actuar.
          </p>
        </section>
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-sm text-slate-700 mb-2">En curso</h2>
          <p className="text-xs text-slate-500">
            {data ? data.inTransitShipments : "…"} envíos en tránsito ahora mismo. El seguimiento GPS en vivo se
            habilita al integrar telemática (Versión 1 del roadmap).
          </p>
        </section>
        <section className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="font-semibold text-sm text-slate-700 mb-2">Atención</h2>
          <p className="text-xs text-slate-500">
            {data ? data.openIncidents : "…"} incidencias abiertas. Revisa el detalle en Facturación/Planificador
            según el módulo afectado.
          </p>
        </section>
      </div>
    </div>
  );
}
