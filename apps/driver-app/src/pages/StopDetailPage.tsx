import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { saveStopNotes } from "@/api/driverApp";
import SignaturePad from "@/components/SignaturePad";
import PhotoCapture from "@/components/PhotoCapture";
import StopMap from "@/components/StopMap";
import Chip, { ChipColor } from "@/components/Chip";
import bigmatLogo from "@/assets/bigmat-logo.png";

// Fase 8L: rediseño completo de la ficha de parada según la especificación
// de Raúl (cabecera fija corporativa con nº de pedido, mapa "sticky" del
// destino, tarjeta principal con estado + botón de navegación GPS, tarjetas
// secundarias de ventana/ETA/contacto (llamada + WhatsApp) y notas, barra de
// acciones inferior con los 5 iconos (Foto/Notas/Firma/Formularios/Escáner)
// con indicador verde/rojo de completado, CTA final grande, y tipografía
// más grande pensada para leerse al sol. Sustituye a la versión anterior
// (lista de tarjetas sin mapa, sin chip de estado, sin GPS, sin WhatsApp, y
// solo 3 de los 5 iconos).
//
// "Formularios" reutiliza tal cual el formulario de incidencia/retorno que
// ya existía (antes con el icono "Incidencia") -- no es un motor de
// formularios configurables nuevo, solo el nombre que pide la
// especificación para ese mismo formulario. "Escáner de códigos" sí es
// nuevo de verdad: abre la cámara (ScanStopCodePage.tsx, mismo motor que el
// QR de vehículo) y registra el código contra esta parada
// (RouteStop.scannedCodes). Ninguno de los dos es decorativo.

interface StopRow {
  id: string;
  sequence: number;
  status: string;
  eta: string | null;
  driverNotes: string | null;
  scannedCodes: { code: string; scannedAt: string }[] | null;
  order: {
    orderNumber: string;
    notes: string | null;
    deliveryTimeWindowFrom: string | null;
    deliveryTimeWindowTo: string | null;
    customer: { legalName: string };
    deliveryPoint: { address: string; city: string | null; lat: number | null; lng: number | null; contactPhone: string | null };
    lines: { quantity: string; unit: string; product: { description: string } }[];
  };
  pod: { deliveredAt: string; receivedByName: string | null; signatureUrl: string | null; photoUrls: string[] | null } | null;
  incidents: { id: string; status: string }[];
}

interface TodayRouteResponse {
  shipment: {
    id: string;
    route: { stops: StopRow[] };
  } | null;
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

// Mismo criterio que ya usa el Backoffice (DispatchBoard.tsx) para el botón
// de WhatsApp: wa.me necesita el número completo con prefijo de país, sin
// "+" ni ceros iniciales; si el teléfono guardado es un número español
// "corto" (9 dígitos) se antepone 34.
function toWhatsAppDigits(phone: string): string {
  const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
  return digits.length === 9 ? `34${digits}` : digits;
}

function gpsUrl(lat: number | null, lng: number | null, address: string, city: string | null): string {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${address}${city ? `, ${city}` : ""}`)}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

function CompletionDot({ done }: { done: boolean }) {
  return (
    <span
      className={`absolute top-0 right-0 w-3 h-3 rounded-full border-2 border-white ${done ? "bg-emerald-500" : "bg-red-400"}`}
      aria-hidden
    />
  );
}

export default function StopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [receivedByName, setReceivedByName] = useState("");
  const [signatureUrl, setSignatureUrl] = useState<string | null>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [showIncidentForm, setShowIncidentForm] = useState(false);
  const [failureReason, setFailureReason] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [formVisited, setFormVisited] = useState(false);

  // La barra inferior fija de acciones no mueve estos bloques de sitio --
  // siguen siendo el mismo contenido en la página, solo que se puede saltar
  // a ellos desde la barra con un scroll suave.
  const photoSectionRef = useRef<HTMLDivElement>(null);
  const signatureSectionRef = useRef<HTMLDivElement>(null);
  const notesSectionRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["today-route"],
    queryFn: async () => (await api.get("/driver-app/today-route")).data as TodayRouteResponse,
  });

  const stop = data?.shipment?.route.stops.find((s) => s.id === id);

  useEffect(() => {
    if (!stop) return;
    setNotesDraft(stop.driverNotes ?? "");
    setNotesSaved(!!stop.driverNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop?.id]);

  const arriveMutation = useMutation({
    mutationFn: async () => (await api.post(`/driver-app/stops/${id}/arrive`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["today-route"] }),
  });

  const completeMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/driver-app/stops/${id}/complete`, {
          receivedByName: receivedByName || "Firma en dispositivo",
          signatureUrl: signatureUrl ?? undefined,
          photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      navigate("/");
    },
  });

  const failMutation = useMutation({
    mutationFn: async () => (await api.post(`/driver-app/stops/${id}/complete`, { failed: true, failureReason })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      navigate("/");
    },
  });

  const returnMutation = useMutation({
    mutationFn: async () => (await api.post(`/driver-app/stops/${id}/complete`, { returned: true, failureReason })).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      navigate("/");
    },
  });

  const notesMutation = useMutation({
    mutationFn: async () => saveStopNotes(id!, notesDraft),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["today-route"] });
      setNotesSaved(true);
    },
  });

  if (isLoading) return <p className="text-base text-slate-400 text-center mt-10">Cargando…</p>;
  if (!stop) return <p className="text-base text-slate-400 text-center mt-10">Parada no encontrada.</p>;

  const dp = stop.order.deliveryPoint;
  const editableStage = (stop.status === "pending" || stop.status === "arrived") && !showIncidentForm;
  const windowText =
    stop.order.deliveryTimeWindowFrom || stop.order.deliveryTimeWindowTo
      ? `${stop.order.deliveryTimeWindowFrom ?? "—"} - ${stop.order.deliveryTimeWindowTo ?? "—"}`
      : "Sin ventana";

  return (
    <div className="min-h-screen bg-slate-100">
      {/* 1. Cabecera fija corporativa: retroceso + nº de pedido real + isotipo. */}
      <header className="bg-brand-600 text-white px-4 py-3 flex items-center justify-between gap-3 sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate("/")} className="text-white text-2xl leading-none shrink-0" aria-label="Volver">
            ←
          </button>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-brand-100 font-semibold">Parada {stop.sequence}</p>
            <h1 className="text-lg font-bold font-mono truncate">#{stop.order.orderNumber}</h1>
          </div>
        </div>
        <span className="bg-white rounded-lg px-1.5 py-1 shrink-0">
          <img src={bigmatLogo} alt="BigMat" className="h-6 block" />
        </span>
      </header>

      <main className={`max-w-lg mx-auto px-4 pt-4 space-y-4 ${editableStage ? "pb-56" : "pb-6"}`}>
        {/* 2 + 3. Mapa sticky del destino + tarjeta principal (estado, dirección, GPS). */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="h-40 bg-slate-100">
            {dp.lat != null && dp.lng != null ? (
              <StopMap lat={dp.lat} lng={dp.lng} />
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-slate-400 px-4 text-center">
                Sin coordenadas guardadas para mostrar el mapa
              </div>
            )}
          </div>
          <div className="p-5">
            <Chip color={statusStyle[stop.status] ?? "slate"}>{statusLabel[stop.status] ?? stop.status}</Chip>
            <p className="text-xl font-bold text-slate-900 leading-snug mt-2">{dp.address}</p>
            {dp.city && <p className="text-base text-slate-500">{dp.city}</p>}
            <p className="text-base font-semibold text-slate-700 mt-2">{stop.order.customer.legalName}</p>
            <a
              href={gpsUrl(dp.lat, dp.lng, dp.address, dp.city)}
              target="_blank"
              rel="noreferrer"
              className="mt-4 w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3.5 text-base font-semibold"
            >
              🧭 Cómo llegar
            </a>
          </div>
        </div>

        {/* 4. Tarjetas secundarias: ventana horaria + ETA. */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ventana horaria</p>
            <p className="text-base font-bold text-slate-800 mt-1">{windowText}</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">ETA</p>
            <p className="text-base font-bold text-slate-800 mt-1">{formatTime(stop.eta)}</p>
          </div>
        </div>

        {/* Contacto: llamada de un toque + WhatsApp. */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Contacto</p>
          {dp.contactPhone ? (
            <div className="flex gap-2">
              <a
                href={`tel:${dp.contactPhone}`}
                className="flex-1 text-center bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-3 text-base font-semibold"
              >
                📞 Llamar
              </a>
              <a
                href={`https://wa.me/${toWhatsAppDigits(dp.contactPhone)}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 text-center bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-3 text-base font-semibold"
              >
                💬 WhatsApp
              </a>
            </div>
          ) : (
            <p className="text-base text-slate-400">Sin teléfono de contacto</p>
          )}
        </div>

        {stop.order.notes && (
          <div className="bg-amber-50 rounded-2xl p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700 mb-1">Observaciones del pedido</p>
            <p className="text-base text-amber-800">{stop.order.notes}</p>
          </div>
        )}

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-2">Contenido del pedido</p>
          <ul className="space-y-1.5">
            {stop.order.lines.map((l, idx) => (
              <li key={idx} className="text-base text-slate-600">
                {l.quantity} {l.unit} — {l.product.description}
              </li>
            ))}
          </ul>
        </div>

        {/* Notas del conductor -- editables, se guardan aparte de las
            observaciones fijas del pedido. */}
        <div ref={notesSectionRef} className="bg-white rounded-2xl border border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Notas del conductor</p>
          <textarea
            value={notesDraft}
            onChange={(e) => {
              setNotesDraft(e.target.value);
              setNotesSaved(false);
            }}
            rows={3}
            placeholder="Añade una nota sobre esta entrega…"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
          />
          <button
            type="button"
            onClick={() => notesMutation.mutate()}
            disabled={notesMutation.isPending || (notesSaved && notesDraft === (stop.driverNotes ?? ""))}
            className="mt-2 text-sm font-semibold text-brand-600 disabled:opacity-40"
          >
            {notesMutation.isPending ? "Guardando…" : notesSaved ? "Nota guardada ✓" : "Guardar nota"}
          </button>
        </div>

        {stop.scannedCodes && stop.scannedCodes.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">Códigos escaneados</p>
            <ul className="space-y-1">
              {stop.scannedCodes.map((c, idx) => (
                <li key={idx} className="text-sm font-mono text-slate-600">
                  {c.code} · {formatTime(c.scannedAt)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {stop.status === "pending" && (
          <button
            onClick={() => arriveMutation.mutate()}
            disabled={arriveMutation.isPending}
            className="w-full bg-amber-500 hover:bg-amber-600 text-white rounded-2xl py-4 text-base font-semibold shadow"
          >
            He llegado
          </button>
        )}

        {editableStage && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <input
              value={receivedByName}
              onChange={(e) => setReceivedByName(e.target.value)}
              placeholder="Nombre de quien recibe (opcional)"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
            />
            <div ref={signatureSectionRef}>
              <SignaturePad onChange={setSignatureUrl} />
            </div>
            <div ref={photoSectionRef}>
              <PhotoCapture onChange={setPhotoUrls} />
            </div>
          </div>
        )}

        {showIncidentForm && (
          <div className="space-y-3 bg-white rounded-2xl border border-red-200 p-4">
            <textarea
              value={failureReason}
              onChange={(e) => setFailureReason(e.target.value)}
              placeholder="Motivo (incidencia o retorno a almacén)…"
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
              rows={3}
            />
            <button
              onClick={() => failMutation.mutate()}
              disabled={!failureReason.trim() || failMutation.isPending}
              className="w-full bg-red-600 hover:bg-red-700 text-white rounded-2xl py-3 text-sm font-semibold disabled:opacity-50"
            >
              Confirmar incidencia (entrega fallida)
            </button>
            <button
              onClick={() => returnMutation.mutate()}
              disabled={!failureReason.trim() || returnMutation.isPending}
              className="w-full bg-white border border-slate-400 text-slate-700 rounded-2xl py-3 text-sm font-semibold disabled:opacity-50"
            >
              ↩︎ Confirmar retorno a almacén
            </button>
            <button onClick={() => setShowIncidentForm(false)} className="w-full text-sm text-slate-500">
              Cancelar
            </button>
          </div>
        )}

        {stop.status === "completed" && stop.pod && (
          <div className="bg-teal-50 rounded-2xl p-4">
            <p className="text-teal-700 font-semibold text-base text-center">Entrega confirmada</p>
            <p className="text-sm text-teal-600 mt-1 font-mono text-center">
              {new Date(stop.pod.deliveredAt).toLocaleString("es-ES")}
              {stop.pod.receivedByName ? ` · ${stop.pod.receivedByName}` : ""}
            </p>
            {/* Se muestran también la firma y fotos ya capturadas -- antes
                desaparecían de esta pantalla en cuanto se completaba la
                parada. */}
            {stop.pod.signatureUrl && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-1">Firma</p>
                <img src={stop.pod.signatureUrl} alt="Firma de quien recibió el pedido" className="w-full rounded-lg border border-teal-200 bg-white" />
              </div>
            )}
            {stop.pod.photoUrls && stop.pod.photoUrls.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-teal-700 mb-1">Fotos</p>
                <div className="grid grid-cols-3 gap-2">
                  {stop.pod.photoUrls.map((url, idx) => (
                    <img key={idx} src={url} alt={`Foto ${idx + 1}`} className="w-full aspect-square object-cover rounded-lg border border-teal-200" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {stop.status === "failed" && (
          <div className="bg-red-50 rounded-2xl p-4 text-center">
            <p className="text-red-700 font-medium text-base">Incidencia registrada</p>
          </div>
        )}

        {stop.status === "returned" && (
          <div className="bg-slate-200 rounded-2xl p-4 text-center">
            <p className="text-slate-700 font-medium text-base">Retorno a almacén registrado</p>
          </div>
        )}
      </main>

      {/* 5 + 6. Barra de acciones inferior (5 iconos con indicador
          verde/rojo) + CTA final grande. */}
      {editableStage && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-slate-200 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] z-20">
          <div className="max-w-lg mx-auto space-y-3">
            <div className="flex items-center justify-around">
              <button
                type="button"
                onClick={() => photoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="flex flex-col items-center gap-1 text-slate-600 w-14"
              >
                <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-xl">
                  📷
                  <CompletionDot done={photoUrls.length > 0} />
                </span>
                <span className="text-[11px] font-semibold">Foto</span>
              </button>
              <button
                type="button"
                onClick={() => notesSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="flex flex-col items-center gap-1 text-slate-600 w-14"
              >
                <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-xl">
                  📝
                  <CompletionDot done={notesSaved && notesDraft.trim().length > 0} />
                </span>
                <span className="text-[11px] font-semibold">Notas</span>
              </button>
              <button
                type="button"
                onClick={() => signatureSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                className="flex flex-col items-center gap-1 text-slate-600 w-14"
              >
                <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-xl">
                  ✍️
                  <CompletionDot done={!!signatureUrl} />
                </span>
                <span className="text-[11px] font-semibold">Firma</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFormVisited(true);
                  setShowIncidentForm(true);
                }}
                className="flex flex-col items-center gap-1 text-slate-600 w-14"
              >
                <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-xl">
                  📋
                  <CompletionDot done={stop.incidents.length > 0 || formVisited} />
                </span>
                <span className="text-[11px] font-semibold">Formularios</span>
              </button>
              <button
                type="button"
                onClick={() => navigate(`/paradas/${id}/escanear`)}
                className="flex flex-col items-center gap-1 text-slate-600 w-14"
              >
                <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-slate-100 text-xl">
                  🔍
                  <CompletionDot done={(stop.scannedCodes?.length ?? 0) > 0} />
                </span>
                <span className="text-[11px] font-semibold">Escáner</span>
              </button>
            </div>
            <button
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-2xl py-4 text-lg font-bold shadow disabled:opacity-50"
            >
              ✓ Completar entrega
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
