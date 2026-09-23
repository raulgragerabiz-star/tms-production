import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";
import { endShift, getCurrentShift, startShift } from "@/api/driverApp";
import Chip, { ChipColor } from "@/components/Chip";
import bigmatWordmark from "@/assets/bigmat-wordmark.png";

// Mejor esfuerzo: si el navegador da permiso y ubicación en menos de 3s se
// adjunta al fichaje; si no, se ficha igualmente sin coordenadas -- la
// jornada nunca debe bloquearse por un permiso de localización pendiente o
// denegado.
function getCoordsBestEffort(): Promise<{ lat: number; lng: number } | undefined> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(undefined);
    const timer = setTimeout(() => resolve(undefined), 3000);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {
        clearTimeout(timer);
        resolve(undefined);
      },
      { timeout: 3000 }
    );
  });
}

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  order: {
    orderNumber: string;
    deliveryTimeWindowFrom: string | null;
    deliveryTimeWindowTo: string | null;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null };
    lines: { quantity: string; unit: string }[];
  };
  pod: { deliveredAt: string } | null;
}

interface ShipmentRow {
  id: string;
  status: string;
  vehicle: { plate: string };
  route: { warehouse: { name: string }; stops: StopRow[] };
}

// Fase 8Y: antes `shipment` (uno solo) -- ver comentario en
// driver-app.routes.ts GET /today-route sobre por qué un conductor puede
// tener más de un envío/ruta el mismo día.
interface TodayRouteResponse {
  shipments: ShipmentRow[];
}

const statusStyle: Record<string, ChipColor> = {
  pending: "slate",
  arrived: "amber",
  completed: "teal",
  failed: "red",
  returned: "slate",
};

const statusLabel: Record<string, string> = {
  pending: "Pendiente",
  arrived: "Llegada registrada",
  completed: "Entregado",
  failed: "Fallida",
  returned: "Retorno",
};

// Objetivo 3: checkpoints de envío completo (cargado / en reparto) que el
// conductor puede marcar él mismo desde aquí, además de los checkpoints por
// parada. "finished" no se ofrece como botón: se deja para cuando todas las
// paradas estén completadas/falladas/retornadas (lo valida igualmente el
// backend si se intentara).
const NEXT_SHIPMENT_STATUS: Record<string, { next: "loaded" | "in_transit"; label: string } | undefined> = {
  programmed: { next: "loaded", label: "He cargado el vehículo" },
  loaded: { next: "in_transit", label: "Salgo de reparto" },
};

export default function TodayRoutePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Fase 25 ("usuarios app" sub-fase 3): ya no hay ninguna cuenta de
  // conductor real -- `session` es la identidad de trazabilidad rellenada al
  // escanear el QR de ruta (ver auth-store.ts / LoginPage.tsx).
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);

  // Fase 8k: selector de fecha -- petición de Raúl para poder consultar
  // rutas de otros días (pruebas con fecha pasada, o revisar el histórico),
  // no solo la de hoy. Por defecto sigue siendo hoy, así que nada cambia si
  // no se toca. Solo se refresca en vivo (refetchInterval) cuando se está
  // viendo el día de hoy -- no tiene sentido sondear cada 30s una fecha
  // pasada que ya no va a cambiar.
  // Fix: al volver de una ficha de parada (o del escáner) que estaba viendo
  // una fecha distinta a hoy, se perdía la fecha seleccionada y esta lista
  // volvía a "hoy" -- forzando a reelegir la fecha cada vez. Ahora, si se
  // llega aquí con ?date= en la URL (ver StopDetailPage.tsx /
  // ScanStopCodePage.tsx), se respeta como fecha inicial.
  const [searchParams] = useSearchParams();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState(searchParams.get("date") ?? todayIso);
  const isToday = selectedDate === todayIso;

  const { data, isLoading } = useQuery({
    queryKey: ["today-route", selectedDate],
    queryFn: async () => (await api.get("/driver-app/today-route", { params: { date: selectedDate } })).data as TodayRouteResponse,
    refetchInterval: isToday ? 30000 : false,
  });

  // QR de conductor + jornada: estado de turno independiente de la ruta del
  // día (el conductor puede fichar aunque su ruta aún no tenga vehículo).
  const shiftQuery = useQuery({ queryKey: ["current-shift"], queryFn: getCurrentShift, refetchInterval: 30000 });

  const startShiftMutation = useMutation({
    mutationFn: async () => startShift(await getCoordsBestEffort()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["current-shift"] }),
  });

  const endShiftMutation = useMutation({
    mutationFn: async () => endShift(await getCoordsBestEffort()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["current-shift"] }),
  });

  // Fase 8Y: ahora recibe el id del envío -- puede haber más de una tarjeta
  // (una por envío/ruta del día), cada una con su propio botón de estado.
  const shipmentStatusMutation = useMutation({
    mutationFn: async ({ shipmentId, status }: { shipmentId: string; status: "loaded" | "in_transit" }) =>
      (await api.post(`/driver-app/shipments/${shipmentId}/status`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-route"] }),
  });

  function handleLogout() {
    logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Fase 8L: cabecera en color corporativo, mismo tratamiento que
          StopDetailPage.tsx, para que la app tenga una identidad visual
          consistente en vez de header blanco aquí y azul en la parada. */}
      <header className="bg-brand-600 text-white px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="bg-white rounded-lg px-1.5 py-1 shrink-0">
              <img src={bigmatWordmark} alt="BigMat" className="h-5 block" />
            </span>
            <div>
              <h1 className="text-lg font-bold">{isToday ? "Ruta de hoy" : "Ruta del día"}</h1>
              <p className="text-xs text-brand-100">
                {session?.driverName}
                {session?.vehiclePlate ? ` · ${session.vehiclePlate}` : ""}
              </p>
            </div>
          </div>
          <button onClick={handleLogout} className="text-sm text-brand-100 font-medium">
            Salir
          </button>
        </div>
        {/* Fase 8k: selector de fecha -- ver comentario más arriba. */}
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-base text-slate-800"
        />
      </header>

      {/* QR de conductor + jornada: fichaje de turno, separado del estado del
          envío -- un conductor puede iniciar jornada aunque su ruta de hoy
          todavía no tenga vehículo asignado. */}
      <div className="px-4 pt-4 max-w-lg mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200 p-3 flex items-center justify-between">
          <div>
            {shiftQuery.data?.shift ? (
              <>
                <p className="text-sm font-semibold text-teal-700">
                  Jornada iniciada ·{" "}
                  {new Date(shiftQuery.data.shift.startedAt).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <p className="text-xs text-slate-400 font-mono">
                  {shiftQuery.data.shift.vehicle?.plate ? `Vehículo ${shiftQuery.data.shift.vehicle.plate}` : "Vehículo pendiente de vincular"}
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Jornada no iniciada</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {shiftQuery.data?.shift ? (
              <button
                onClick={() => endShiftMutation.mutate()}
                disabled={endShiftMutation.isPending}
                className="text-xs font-semibold text-white bg-slate-700 rounded-lg px-3 py-2 disabled:opacity-50"
              >
                Finalizar jornada
              </button>
            ) : (
              <button
                onClick={() => startShiftMutation.mutate()}
                disabled={startShiftMutation.isPending}
                className="text-xs font-semibold text-white bg-brand-600 rounded-lg px-3 py-2 disabled:opacity-50"
              >
                Iniciar jornada
              </button>
            )}
          </div>
        </div>
      </div>

      <main className="px-4 pt-4 max-w-lg mx-auto">
        {isLoading && <p className="text-sm text-slate-400 text-center mt-10">Cargando ruta…</p>}

        {!isLoading && (!data?.shipments || data.shipments.length === 0) && (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center mt-6">
            <p className="text-slate-500">
              {isToday
                ? "No tienes ninguna ruta asignada para hoy."
                : `No tienes ninguna ruta para el ${new Date(`${selectedDate}T00:00:00`).toLocaleDateString("es-ES")}.`}
            </p>
          </div>
        )}

        {/* Fase 8Y: fix -- antes se asumía un único envío/ruta por conductor y
            día ("shipment" en singular); un conductor puede tener varios
            (p.ej. dos rutas cortas seguidas), así que ahora se pinta una
            tarjeta + lista de paradas por cada envío en "shipments". */}
        {data?.shipments && data.shipments.length > 0 && (
          <div className="space-y-6">
            {data.shipments.map((shipment, idx) => (
              <div key={shipment.id}>
                {data.shipments.length > 1 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Ruta {idx + 1} de {data.shipments.length}</p>
                )}
                <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4">
                  <p className="text-sm text-slate-500">{shipment.route.warehouse.name}</p>
                  <p className="text-lg font-semibold text-slate-900 font-mono">Vehículo {shipment.vehicle.plate}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">
                    {shipment.route.stops.length} paradas ·{" "}
                    {shipment.route.stops.filter((s) => s.status === "completed").length} completadas
                  </p>
                  {/* Fase 8M -- fix: antes este botón exigía "isToday" (fecha
                      seleccionada === fecha real del dispositivo), pensado para
                      no tocar el estado de una ruta histórica. Pero eso también
                      ocultaba el botón con rutas de HOY cuyos datos de prueba
                      llevan otra fecha (ver comentario de today-route más abajo
                      en el backend), dejando sin forma de marcar "cargado" /
                      "salgo de reparto". El único guardarraíl que hace falta de
                      verdad es no dejar avanzar el estado de una ruta con fecha
                      futura; una ruta ya finalizada tampoco muestra botón,
                      porque su estado ya no está en NEXT_SHIPMENT_STATUS. */}
                  {selectedDate <= todayIso && NEXT_SHIPMENT_STATUS[shipment.status] && (
                    <button
                      onClick={() => shipmentStatusMutation.mutate({ shipmentId: shipment.id, status: NEXT_SHIPMENT_STATUS[shipment.status]!.next })}
                      disabled={shipmentStatusMutation.isPending}
                      className="w-full mt-3 bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-sm font-semibold shadow disabled:opacity-50"
                    >
                      {NEXT_SHIPMENT_STATUS[shipment.status]!.label}
                    </button>
                  )}
                </div>

                <div className="space-y-3">
                  {shipment.route.stops.map((stop) => (
                    <button
                      key={stop.id}
                      onClick={() => navigate(`/paradas/${stop.id}?date=${selectedDate}`)}
                      className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 active:scale-[0.99] transition shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-mono font-bold text-slate-800">#{stop.sequence} — {stop.order.orderNumber}</span>
                        <Chip color={statusStyle[stop.status] ?? "slate"}>{statusLabel[stop.status]}</Chip>
                      </div>
                      <p className="text-base font-medium text-slate-700">{stop.order.customer.legalName}</p>
                      <p className="text-sm text-slate-500">
                        {stop.order.deliveryPoint.address}
                        {stop.order.deliveryPoint.city ? `, ${stop.order.deliveryPoint.city}` : ""}
                      </p>
                      {(stop.order.deliveryTimeWindowFrom || stop.order.deliveryTimeWindowTo) && (
                        <p className="text-xs text-amber-600 mt-1">
                          Ventana: {stop.order.deliveryTimeWindowFrom ?? "—"} - {stop.order.deliveryTimeWindowTo ?? "—"}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
