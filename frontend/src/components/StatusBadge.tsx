const colorMap: Record<string, string> = {
  received: "bg-slate-100 text-slate-700",
  validated: "bg-blue-100 text-blue-700",
  planned: "bg-indigo-100 text-indigo-700",
  loading: "bg-amber-100 text-amber-700",
  dispatched: "bg-amber-100 text-amber-700",
  in_transit: "bg-blue-100 text-blue-700",
  delivered: "bg-emerald-100 text-emerald-700",
  // Estados de envío (Shipment.status) que todavía no tenían color propio --
  // Fase 8S (rediseño de Inicio), tabla de "Envíos recientes".
  programmed: "bg-slate-100 text-slate-700",
  loaded: "bg-amber-100 text-amber-700",
  finished: "bg-emerald-100 text-emerald-700",
  incident: "bg-red-100 text-red-700",
  cancelled: "bg-slate-200 text-slate-500",
  draft: "bg-slate-100 text-slate-700",
  optimized: "bg-indigo-100 text-indigo-700",
  assigned: "bg-blue-100 text-blue-700",
  confirmed: "bg-emerald-100 text-emerald-700",
  in_progress: "bg-blue-100 text-blue-700",
  closed: "bg-slate-200 text-slate-500",
  rejected: "bg-red-100 text-red-700",
  // Estados de parada individual (RouteStop.status), distintos de los
  // estados de pedido/ruta de arriba -- añadidos para la lista detallada de
  // paradas del Planificador.
  pending: "bg-slate-100 text-slate-700",
  arrived: "bg-amber-100 text-amber-700",
  completed: "bg-emerald-100 text-emerald-700",
  failed: "bg-red-100 text-red-700",
  returned: "bg-orange-100 text-orange-700",
  // Estados de incidencia (Incident.status) -- para la ficha única del
  // pedido (instrucciones del proyecto ampliadas).
  open: "bg-red-100 text-red-700",
  resolved: "bg-emerald-100 text-emerald-700",
  escalated: "bg-orange-100 text-orange-700",
};

// 2026-09-09: retoque visual (mismo color por estado de siempre, solo
// cambia la forma) para acercarse a los "chips" del panel de referencia que
// aportó Raúl -- mayúsculas, fuente monoespaciada y esquina poco redondeada
// en vez de píldora completa, en línea con el resto del rediseño.
export default function StatusBadge({ status }: { status: string }) {
  const cls = colorMap[status] ?? "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded font-mono text-[0.68rem] font-bold uppercase tracking-wide whitespace-nowrap ${cls}`}>
      {status}
    </span>
  );
}
