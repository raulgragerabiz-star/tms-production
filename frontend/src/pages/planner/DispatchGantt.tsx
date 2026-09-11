import { useMemo, useState } from "react";

// Fase 5b (Planificador estilo Bringg): línea de tiempo tipo Gantt de las
// rutas del día -- una fila por ruta (transportista/vehículo/conductor ya
// asignado, o "Sin asignar" si todavía no), cada parada como un marcador en
// su hora estimada de llegada (RouteStop.eta, calculada ahora por
// recalculateLoadPlan -- ver routing.service.ts). Dibujado a mano en
// HTML/CSS, sin librería de gráficos nueva, siguiendo el mismo criterio ya
// usado en los gráficos de Analítica: paleta categórica en orden fijo (una
// por ruta, la misma que ya pinta el mapa), marcadores de estado con los
// mismos colores que StatusBadge, leyenda siempre visible y tooltip por
// parada. La tabla de paradas junto a este Gantt (DispatchBoard) es su
// alternativa accesible -- mismos datos en forma de tabla.

export interface GanttStop {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  // Fase 8O: hora REAL de entrega (si ya se completó) -- antes esta línea de
  // tiempo solo movía un único punto, fijo en la hora de la ETA, al color
  // del estado actual: nunca mostraba si la entrega real fue antes/después
  // de lo previsto, ni en qué momento pasó de verdad. Ahora, cuando hay
  // hora real, se dibuja un segundo marcador en su posición real, unido al
  // planificado con una línea de puntos.
  deliveredAt: string | null;
  orderNumber: string;
  customerName: string;
  address: string;
  timeWindow: string | null;
}

export interface GanttRoute {
  id: string;
  label: string;
  color: string;
  stops: GanttStop[];
}

interface Props {
  routes: GanttRoute[];
  routeDateIso: string;
  selectedStopId?: string | null;
  onSelectStop?: (stopId: string) => void;
}

const STOP_STATUS_COLORS: Record<string, string> = {
  pending: "#94a3b8",
  arrived: "#f59e0b",
  completed: "#10b981",
  failed: "#ef4444",
  returned: "#f97316",
};

const STOP_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  arrived: "Llegada registrada",
  completed: "Entregado",
  failed: "Fallida",
  returned: "Retorno",
};

function formatHour(ms: number): string {
  return new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

export default function DispatchGantt({ routes, routeDateIso, selectedStopId, onSelectStop }: Props) {
  const [hoverStopId, setHoverStopId] = useState<string | null>(null);

  const allEtaMs = useMemo(
    () =>
      routes.flatMap((r) => [
        ...r.stops.filter((s) => s.eta).map((s) => new Date(s.eta as string).getTime()),
        // Fase 8O: si una entrega real quedó fuera del rango que marcaban
        // las ETA (p.ej. se retrasó más de lo previsto), el eje horario
        // también tiene que estirarse para poder verla.
        ...r.stops.filter((s) => s.deliveredAt).map((s) => new Date(s.deliveredAt as string).getTime()),
      ]),
    [routes]
  );

  const { startMs, endMs, hours } = useMemo(() => {
    let start: Date;
    let end: Date;
    if (allEtaMs.length === 0) {
      start = new Date(`${routeDateIso}T08:00:00`);
      end = new Date(`${routeDateIso}T18:00:00`);
    } else {
      start = new Date(Math.min(...allEtaMs) - 30 * 60000);
      start.setMinutes(0, 0, 0);
      end = new Date(Math.max(...allEtaMs) + 30 * 60000);
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 1);
    }
    const hourMarks: number[] = [];
    for (let t = start.getTime(); t <= end.getTime(); t += 3600000) hourMarks.push(t);
    return { startMs: start.getTime(), endMs: end.getTime(), hours: hourMarks };
  }, [allEtaMs, routeDateIso]);

  const totalMs = Math.max(1, endMs - startMs);
  const pct = (ms: number) => Math.min(100, Math.max(0, ((ms - startMs) / totalMs) * 100));

  const today = new Date().toISOString().slice(0, 10);
  const nowMs = Date.now();
  const showNowLine = routeDateIso === today && nowMs >= startMs && nowMs <= endMs;

  if (routes.length === 0) {
    return <p className="text-sm text-slate-400 text-center py-10">No hay rutas este día para dibujar la línea de tiempo.</p>;
  }

  const anyEta = allEtaMs.length > 0;

  return (
    <div>
      {!anyEta && (
        <p className="text-xs text-amber-600 mb-2">
          Ninguna parada tiene todavía hora estimada calculada (falta la ubicación del almacén o de algún punto de
          entrega) -- se muestra una franja horaria por defecto (08:00-18:00).
        </p>
      )}

      <div className="overflow-x-auto">
        <div style={{ minWidth: 720 }}>
          {/* Eje de horas -- misma estructura fila-etiqueta + pista que las filas de
              abajo, para que las marcas de hora queden alineadas con los tramos */}
          <div className="flex mb-1">
            <div className="w-44 shrink-0" />
            <div className="relative flex-1 h-5">
              {hours.map((h) => (
                <span
                  key={h}
                  className="absolute text-[10px] font-mono text-slate-400 -translate-x-1/2"
                  style={{ left: `${pct(h)}%` }}
                >
                  {formatHour(h)}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            {routes.map((route) => {
              const etaStops = route.stops.filter((s) => s.eta);
              const trackStartPct = etaStops.length > 0 ? pct(new Date(etaStops[0].eta as string).getTime()) : 0;
              const trackEndPct =
                etaStops.length > 0 ? pct(new Date(etaStops[etaStops.length - 1].eta as string).getTime()) : 0;

              return (
                <div key={route.id} className="flex items-center h-9">
                  <div className="w-44 pr-2 shrink-0 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: route.color }} />
                    <span className="text-xs font-mono font-medium text-slate-700 truncate">{route.label}</span>
                  </div>
                  <div className="relative flex-1 h-full bg-slate-50 rounded-md border border-slate-100">
                    {showNowLine && (
                      <div
                        className="absolute top-0 bottom-0 w-px bg-red-400 z-10"
                        style={{ left: `${pct(nowMs)}%` }}
                      />
                    )}
                    {etaStops.length >= 2 && (
                      <div
                        className="absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                        style={{
                          left: `${trackStartPct}%`,
                          width: `${Math.max(0, trackEndPct - trackStartPct)}%`,
                          backgroundColor: route.color,
                          opacity: 0.35,
                        }}
                      />
                    )}
                    {/* Fase 8O: si hay hora real de entrega y difiere de la
                        ETA, se une planificado -> real con una línea de
                        puntos, para que el hueco (adelanto o retraso) se
                        vea de un vistazo. */}
                    {route.stops.map((stop) => {
                      if (!stop.eta || !stop.deliveredAt) return null;
                      const left1 = pct(new Date(stop.eta).getTime());
                      const left2 = pct(new Date(stop.deliveredAt).getTime());
                      if (Math.abs(left2 - left1) < 0.5) return null;
                      const from = Math.min(left1, left2);
                      const to = Math.max(left1, left2);
                      return (
                        <div
                          key={`link-${stop.id}`}
                          className="absolute top-1/2 h-0 -translate-y-1/2 border-t border-dotted border-slate-400"
                          style={{ left: `${from}%`, width: `${to - from}%` }}
                        />
                      );
                    })}

                    {route.stops.map((stop) => {
                      const left = stop.eta ? pct(new Date(stop.eta).getTime()) : null;
                      if (left === null) return null;
                      const isSelected = selectedStopId === stop.id;
                      return (
                        <button
                          key={stop.id}
                          type="button"
                          onClick={() => onSelectStop?.(stop.id)}
                          onMouseEnter={() => setHoverStopId(stop.id)}
                          onMouseLeave={() => setHoverStopId((id) => (id === stop.id ? null : id))}
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow"
                          style={{
                            left: `${left}%`,
                            width: isSelected ? 14 : 10,
                            height: isSelected ? 14 : 10,
                            backgroundColor: STOP_STATUS_COLORS[stop.status] ?? "#94a3b8",
                            outline: isSelected ? `2px solid ${route.color}` : "none",
                          }}
                          aria-label={`Parada ${stop.sequence}, ${stop.customerName}, planificada ${STOP_STATUS_LABELS[stop.status] ?? stop.status}`}
                        />
                      );
                    })}

                    {/* Marcador de la hora REAL de entrega -- distinto del
                        de arriba (planificado en la ETA): relleno blanco y
                        aro verde, para no confundirlo con el punto de
                        estado. Solo se dibuja si de verdad se conoce (hay
                        justificante de entrega). */}
                    {route.stops.map((stop) => {
                      if (!stop.deliveredAt) return null;
                      const left = pct(new Date(stop.deliveredAt).getTime());
                      const isSelected = selectedStopId === stop.id;
                      return (
                        <button
                          key={`actual-${stop.id}`}
                          type="button"
                          onClick={() => onSelectStop?.(stop.id)}
                          onMouseEnter={() => setHoverStopId(stop.id)}
                          onMouseLeave={() => setHoverStopId((id) => (id === stop.id ? null : id))}
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
                          style={{
                            left: `${left}%`,
                            width: isSelected ? 12 : 9,
                            height: isSelected ? 12 : 9,
                            border: `2px solid ${STOP_STATUS_COLORS.completed}`,
                          }}
                          aria-label={`Parada ${stop.sequence}, ${stop.customerName}, entregada de verdad a las ${formatHour(new Date(stop.deliveredAt).getTime())}`}
                        />
                      );
                    })}

                    {route.stops.map((stop) => {
                      if (hoverStopId !== stop.id || !stop.eta) return null;
                      const left = pct(new Date(stop.eta).getTime());
                      return (
                        <div
                          key={`tt-${stop.id}`}
                          className="absolute bottom-full mb-1.5 -translate-x-1/2 z-20 bg-slate-900 text-white text-[11px] rounded-lg px-2.5 py-1.5 shadow-lg whitespace-nowrap pointer-events-none"
                          style={{ left: `${left}%` }}
                        >
                          <p className="font-mono font-semibold">
                            {stop.deliveredAt ? "ETA " : ""}
                            {formatHour(new Date(stop.eta).getTime())} · {stop.orderNumber}
                          </p>
                          {stop.deliveredAt && (
                            <p className="font-mono text-emerald-300">
                              Real {formatHour(new Date(stop.deliveredAt).getTime())}
                            </p>
                          )}
                          <p>{stop.customerName}</p>
                          <p className="text-slate-300">{stop.address}</p>
                          <p className="text-slate-300">{STOP_STATUS_LABELS[stop.status] ?? stop.status}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Leyenda -- siempre visible, identidad de estado nunca solo por color */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-slate-100">
        {Object.entries(STOP_STATUS_LABELS).map(([status, label]) => (
          <span key={status} className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: STOP_STATUS_COLORS[status] }} />
            {label}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          <span className="w-2.5 h-2.5 rounded-full inline-block bg-white" style={{ border: `2px solid ${STOP_STATUS_COLORS.completed}` }} />
          Hora real de entrega
        </span>
        {showNowLine && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="w-2.5 h-px bg-red-400 inline-block" />
            Hora actual
          </span>
        )}
      </div>
    </div>
  );
}
