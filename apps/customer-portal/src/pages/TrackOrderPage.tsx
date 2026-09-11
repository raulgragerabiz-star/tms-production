import { FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  lookupOrderTracking,
  reportTrackingIncident,
  submitTrackingFeedback,
  TrackingResult,
} from "@/api/tracking";
import TrackingMap from "@/components/TrackingMap";
import bigmatLogo from "@/assets/bigmat-logo.png";

// Consulta pública de estado de pedido: acceso único para cualquiera, sin
// usuario ni contraseña -- decisión explícita de Raúl para no tener que dar
// de alta un cliente + credenciales por cada pedido de prueba. Solo hace
// falta el Nº de pedido y el código postal de la entrega; la respuesta
// nunca incluye nada de otros pedidos ni datos internos (coste,
// observaciones...). El Portal Cliente con usuario/contraseña sigue
// existiendo en /login para quien ya lo tuviera configurado.
//
// 2026-09-09: ampliada para tener paridad con el Portal Cliente autenticado
// (`OrderDetailPage.tsx`) -- seguimiento en vivo sobre mapa, justificante de
// entrega (firma + fotos), valoración de satisfacción y reporte/consulta de
// incidencias.
//
// Fase 8L: rediseñada como "app" de seguimiento en vez de un formulario web
// centrado -- cabecera fija en color corporativo (mismo lenguaje que la App
// Conductor), tarjetas a todo el ancho, tipografía más grande, y
// auto-actualización mientras el pedido está "en reparto" (antes solo se
// refrescaba si el cliente pulsaba algo, aunque el conductor ya estuviera en
// camino). La consulta ahora vive en React Query en vez de estado manual
// para poder usar `refetchInterval`.
const statusLabel: Record<string, string> = {
  received: "Recibido",
  validated: "Validado",
  planned: "Planificado",
  loading: "En carga",
  dispatched: "Expedido",
  in_transit: "En reparto",
  delivered: "Entregado",
  incident: "Incidencia",
  cancelled: "Cancelado",
};

const statusBadgeClass: Record<string, string> = {
  received: "bg-slate-100 text-slate-700",
  validated: "bg-slate-100 text-slate-700",
  planned: "bg-blue-50 text-blue-700",
  loading: "bg-blue-50 text-blue-700",
  dispatched: "bg-blue-50 text-blue-700",
  in_transit: "bg-amber-50 text-amber-700",
  delivered: "bg-teal-50 text-teal-700",
  incident: "bg-red-50 text-red-700",
  cancelled: "bg-slate-100 text-slate-500",
};

const INCIDENT_TYPE_LABEL: Record<string, string> = {
  delay: "Retraso",
  damage: "Mercancía dañada",
  refused: "Rechazo del pedido",
  access_issue: "Problema de acceso al punto de entrega",
  other: "Otro",
};

// Ver nota equivalente en OrderDetailPage.tsx: un <a href download> descarga
// una data URL sin bloqueos del navegador; window.open(dataUrl) se queda en
// blanco en Chrome/Firefox por política de seguridad frente a data: URLs.
export default function TrackOrderPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [feedbackSending, setFeedbackSending] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const [incidentOpen, setIncidentOpen] = useState(false);
  const [incidentType, setIncidentType] = useState("delay");
  const [incidentDescription, setIncidentDescription] = useState("");
  const [incidentSending, setIncidentSending] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [incidentSent, setIncidentSent] = useState(false);

  const trimmedOrderNumber = orderNumber.trim();
  const trimmedPostalCode = postalCode.trim();

  // Fase 8L: mientras el envío está circulando de verdad se vuelve a
  // consultar solo cada 20s (mismo intervalo que usa el resto de la suite
  // para seguimiento en vivo, ver DispatchBoard.tsx/RutasTab.tsx) -- para
  // cualquier otro estado no tiene sentido sondear una y otra vez algo que
  // ya no va a cambiar solo.
  //
  // Fase 8O -- fix: esto comprobaba `status === "in_transit"`, pero ese
  // campo es el estado COMERCIAL del pedido (planned/dispatched/...), que en
  // la práctica casi nunca llega a valer "in_transit" -- solo se mueve
  // automáticamente a "delivered" al completar la entrega. Así que aunque el
  // conductor ya estuviera circulando de verdad, esta pantalla nunca
  // sondeaba sola, y solo se veía el estado real si el cliente volvía atrás
  // y repetía la búsqueda (lo que sí lanza una consulta nueva). Ahora se usa
  // `liveTracking`, que refleja el estado real del envío (ver
  // tracking.routes.ts / api/tracking.ts).
  const trackingQuery = useQuery<TrackingResult>({
    queryKey: ["tracking", trimmedOrderNumber, trimmedPostalCode],
    queryFn: () => lookupOrderTracking(trimmedOrderNumber, trimmedPostalCode),
    enabled: submitted && trimmedOrderNumber.length > 0 && trimmedPostalCode.length > 0,
    retry: false,
    refetchInterval: (query) => (query.state.data?.liveTracking ? 20000 : false),
  });

  const result = submitted ? trackingQuery.data : undefined;
  // El formulario se queda visible (con el botón deshabilitado mostrando
  // "Consultando…") hasta que llega un resultado -- así no hay una pantalla
  // en blanco mientras se espera la primera respuesta, y si falla (número
  // equivocado, límite de consultas) el mensaje de error aparece justo
  // debajo sin tener que volver a nada.
  const showForm = !submitted || !result;

  const lookupError = trackingQuery.isError
    ? (trackingQuery.error as any)?.response?.status === 429
      ? "Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo."
      : "No se ha encontrado ningún pedido con ese número y código postal."
    : null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitted) {
      trackingQuery.refetch();
    } else {
      setSubmitted(true);
    }
  }

  function handleSearchAnother() {
    setSubmitted(false);
    setOrderNumber("");
    setPostalCode("");
    setIncidentOpen(false);
    setIncidentSent(false);
  }

  async function handleSendFeedback() {
    if (rating === 0) return;
    setFeedbackSending(true);
    setFeedbackError(null);
    try {
      await submitTrackingFeedback(trimmedOrderNumber, trimmedPostalCode, rating, comment || undefined);
      await trackingQuery.refetch();
    } catch {
      setFeedbackError("No se pudo enviar la valoración. Inténtalo de nuevo.");
    } finally {
      setFeedbackSending(false);
    }
  }

  async function handleSendIncident() {
    setIncidentSending(true);
    setIncidentError(null);
    try {
      await reportTrackingIncident(trimmedOrderNumber, trimmedPostalCode, incidentType, incidentDescription || undefined);
      setIncidentSent(true);
      setIncidentOpen(false);
      setIncidentDescription("");
      await trackingQuery.refetch();
    } catch {
      setIncidentError("No se pudo reportar la incidencia (puede que el pedido aún no tenga un envío en curso).");
    } finally {
      setIncidentSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100">
      {/* Cabecera fija en color corporativo -- mismo lenguaje visual que la
          App Conductor (Fase 8L), en vez del formulario flotante sobre fondo
          gris que había antes. */}
      <header className="bg-brand-600 text-white px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <span className="bg-white rounded-lg px-1.5 py-1 shrink-0">
            <img src={bigmatLogo} alt="BigMat" className="h-7 block" />
          </span>
          <div className="min-w-0">
            <h1 className="text-lg font-bold truncate">
              {result ? `Pedido ${result.orderNumber}` : "Seguimiento de pedido"}
            </h1>
            {result && (
              <p className="text-xs text-brand-100">
                {statusLabel[result.status] ?? result.status}
                {trackingQuery.data?.liveTracking && " · actualizando cada 20s"}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pt-4 pb-10 space-y-4">
        {showForm && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <p className="text-base text-slate-500">
              Introduce el número de pedido y el código postal de la entrega para ver su estado.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Nº de pedido</label>
                <input
                  type="text"
                  required
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Código postal de la entrega</label>
                <input
                  type="text"
                  required
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base"
                />
              </div>

              {lookupError && <p className="text-sm text-red-600">{lookupError}</p>}

              <button
                type="submit"
                disabled={trackingQuery.isFetching}
                className="w-full rounded-xl bg-brand-600 hover:bg-brand-700 text-white py-3.5 text-base font-semibold disabled:opacity-50"
              >
                {trackingQuery.isFetching ? "Consultando…" : "Consultar"}
              </button>
            </form>
          </div>
        )}

        {submitted && result && (
          <>
            <button type="button" onClick={handleSearchAnother} className="text-sm text-brand-700 font-medium underline">
              ← Buscar otro pedido
            </button>

            <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className={`text-sm font-semibold px-3 py-1 rounded-full ${statusBadgeClass[result.status] ?? "bg-slate-100 text-slate-700"}`}>
                  {statusLabel[result.status] ?? result.status}
                </span>
              </div>
              <p className="text-base text-slate-600">
                Entrega en {result.deliveryPoint.city ?? "-"} · fecha comprometida{" "}
                {new Date(result.requestedDeliveryDate).toLocaleDateString("es-ES")}
              </p>
              <ul className="space-y-2 pt-1">
                {result.timeline.map((step) => (
                  <li key={step.key} className="flex items-center gap-2 text-base">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${step.done ? "bg-emerald-500" : "bg-slate-300"}`} />
                    <span className={step.done ? "text-slate-700 font-medium" : "text-slate-400"}>{step.label}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Seguimiento en vivo: solo aparece mientras el envío está en
                reparto y hay al menos una posición GPS conocida. */}
            {result.livePosition && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Seguimiento en vivo</p>
                <TrackingMap
                  lat={result.livePosition.lat}
                  lng={result.livePosition.lng}
                  label={`Actualizado ${new Date(result.livePosition.occurredAt).toLocaleTimeString("es-ES")}`}
                />
              </div>
            )}

            {/* Líneas del pedido */}
            {result.lines.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Líneas del pedido</p>
                <ul className="divide-y divide-slate-100">
                  {result.lines.map((l, i) => (
                    <li key={i} className="py-2 flex justify-between text-base">
                      <span className="text-slate-700">{l.product}</span>
                      <span className="text-slate-500">
                        {l.quantity} {l.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Justificante de entrega (firma + fotos) */}
            {result.pod && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Justificante de entrega</p>
                <p className="text-base text-slate-600">
                  Entregado el {new Date(result.pod.deliveredAt).toLocaleString("es-ES")}
                  {result.pod.receivedByName ? ` · Recibido por ${result.pod.receivedByName}` : ""}
                </p>

                {result.pod.signatureUrl && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-slate-500 mb-1">Firma</p>
                    <img
                      src={result.pod.signatureUrl}
                      alt="Firma de quien recibió el pedido"
                      className="w-full border border-slate-200 rounded-lg bg-slate-50"
                    />
                    <a
                      href={result.pod.signatureUrl}
                      download={`firma-${result.orderNumber}.png`}
                      className="inline-block mt-1 text-sm text-brand-700 font-medium underline"
                    >
                      Descargar firma
                    </a>
                  </div>
                )}

                {result.pod.photoUrls && result.pod.photoUrls.length > 0 && (
                  <div className="mt-3">
                    <p className="text-sm font-medium text-slate-500 mb-1">Fotos de la entrega</p>
                    <div className="grid grid-cols-3 gap-2">
                      {result.pod.photoUrls.map((url, idx) => (
                        <a key={idx} href={url} download={`foto-${result.orderNumber}-${idx + 1}.jpg`}>
                          <img
                            src={url}
                            alt={`Foto de entrega ${idx + 1}`}
                            className="w-full aspect-square object-cover rounded-lg border border-slate-200"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Valoración de satisfacción -- solo tiene sentido una vez entregado */}
            {result.status === "delivered" && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Tu valoración</p>

                {result.feedback ? (
                  <div>
                    <div className="flex gap-1 text-xl text-amber-400">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n}>{n <= result.feedback!.rating ? "★" : "☆"}</span>
                      ))}
                    </div>
                    {result.feedback.comment && (
                      <p className="text-base text-slate-600 mt-1">{result.feedback.comment}</p>
                    )}
                    <p className="text-sm text-slate-400 mt-1">Gracias por valorar esta entrega.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-base text-slate-600">¿Cómo ha sido la entrega de este pedido?</p>
                    <div className="flex gap-1 text-2xl">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setRating(n)}
                          className={n <= rating ? "text-amber-400" : "text-slate-300"}
                          aria-label={`${n} estrellas`}
                        >
                          {n <= rating ? "★" : "☆"}
                        </button>
                      ))}
                    </div>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Comentario opcional..."
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                      rows={2}
                    />
                    <button
                      type="button"
                      disabled={rating === 0 || feedbackSending}
                      onClick={handleSendFeedback}
                      className="rounded-xl bg-brand-700 text-white text-base font-semibold px-4 py-2.5 disabled:opacity-40"
                    >
                      {feedbackSending ? "Enviando..." : "Enviar valoración"}
                    </button>
                    {feedbackError && <p className="text-sm text-red-600">{feedbackError}</p>}
                  </div>
                )}
              </div>
            )}

            {/* Incidencias ya reportadas para este pedido */}
            {result.incidents.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-400 mb-2">Incidencias reportadas</p>
                <ul className="space-y-2">
                  {result.incidents.map((inc, idx) => (
                    <li key={idx} className="text-base">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">{INCIDENT_TYPE_LABEL[inc.incidentType] ?? inc.incidentType}</span>
                        <span className="text-sm font-medium bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full">
                          {inc.status === "resolved" ? "Resuelta" : inc.status === "escalated" ? "Escalada" : "Abierta"}
                        </span>
                      </div>
                      {inc.description && <p className="text-sm text-slate-500">{inc.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reportar / consultar una incidencia -- disponible salvo en pedidos cancelados */}
            {result.status !== "cancelled" && (
              <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-500">¿Algún problema con este pedido?</p>
                  {!incidentOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setIncidentOpen(true);
                        setIncidentSent(false);
                      }}
                      className="text-sm text-brand-700 font-semibold underline"
                    >
                      Reportar incidencia
                    </button>
                  )}
                </div>

                {incidentSent && !incidentOpen && (
                  <p className="text-base text-green-700 mt-2">
                    Incidencia reportada. Nuestro equipo la revisará en breve.
                  </p>
                )}

                {incidentOpen && (
                  <div className="space-y-2 mt-2">
                    <select
                      value={incidentType}
                      onChange={(e) => setIncidentType(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                    >
                      {Object.entries(INCIDENT_TYPE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={incidentDescription}
                      onChange={(e) => setIncidentDescription(e.target.value)}
                      placeholder="Describe brevemente lo ocurrido (opcional)"
                      className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-base"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={incidentSending}
                        onClick={handleSendIncident}
                        className="rounded-xl bg-brand-700 text-white text-base font-semibold px-4 py-2.5 disabled:opacity-40"
                      >
                        {incidentSending ? "Enviando..." : "Enviar incidencia"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIncidentOpen(false)}
                        className="rounded-xl text-base text-slate-500 px-4 py-2.5 hover:bg-slate-100"
                      >
                        Cancelar
                      </button>
                    </div>
                    {incidentError && <p className="text-sm text-red-600">{incidentError}</p>}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
