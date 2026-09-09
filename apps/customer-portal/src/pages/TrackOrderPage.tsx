import { FormEvent, useState } from "react";
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
// incidencias. Antes esta página solo mostraba la línea de tiempo, mucho
// más pobre que el detalle con login.
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
  const [result, setResult] = useState<TrackingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  async function runLookup(): Promise<TrackingResult | null> {
    try {
      const data = await lookupOrderTracking(orderNumber.trim(), postalCode.trim());
      setResult(data);
      setError(null);
      return data;
    } catch (err: any) {
      setError(
        err?.response?.status === 429
          ? "Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo."
          : "No se ha encontrado ningún pedido con ese número y código postal."
      );
      setResult(null);
      return null;
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    await runLookup();
    setLoading(false);
  }

  async function handleSendFeedback() {
    if (rating === 0) return;
    setFeedbackSending(true);
    setFeedbackError(null);
    try {
      await submitTrackingFeedback(orderNumber.trim(), postalCode.trim(), rating, comment || undefined);
      await runLookup();
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
      await reportTrackingIncident(orderNumber.trim(), postalCode.trim(), incidentType, incidentDescription || undefined);
      setIncidentSent(true);
      setIncidentOpen(false);
      setIncidentDescription("");
      await runLookup();
    } catch {
      setIncidentError("No se pudo reportar la incidencia (puede que el pedido aún no tenga un envío en curso).");
    } finally {
      setIncidentSending(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4">
        <img src={bigmatLogo} alt="BigMat" className="h-12 mx-auto" />
        <h1 className="text-xl font-semibold text-slate-800">Consultar mi pedido</h1>
        <p className="text-sm text-slate-500">
          Introduce el número de pedido y el código postal de la entrega para ver su estado.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700">Nº de pedido</label>
            <input
              type="text"
              required
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Código postal de la entrega</label>
            <input
              type="text"
              required
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-md bg-brand-600 hover:bg-brand-700 text-white py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Consultando..." : "Consultar"}
          </button>
        </form>

        {result && (
          <div className="border-t border-slate-100 pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">Pedido {result.orderNumber}</p>
              <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-1 rounded-full">
                {statusLabel[result.status] ?? result.status}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Entrega en {result.deliveryPoint.city ?? "-"} · fecha comprometida{" "}
              {new Date(result.requestedDeliveryDate).toLocaleDateString("es-ES")}
            </p>
            <ul className="space-y-1.5">
              {result.timeline.map((step) => (
                <li key={step.key} className="flex items-center gap-2 text-sm">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${step.done ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  <span className={step.done ? "text-slate-700" : "text-slate-400"}>{step.label}</span>
                </li>
              ))}
            </ul>

            {/* Seguimiento en vivo: solo aparece mientras el envío está en
                reparto y hay al menos una posición GPS conocida. */}
            {result.livePosition && (
              <div className="pt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Seguimiento en vivo</p>
                <TrackingMap
                  lat={result.livePosition.lat}
                  lng={result.livePosition.lng}
                  label={`Actualizado ${new Date(result.livePosition.occurredAt).toLocaleTimeString("es-ES")}`}
                />
              </div>
            )}

            {/* Líneas del pedido */}
            {result.lines.length > 0 && (
              <div className="pt-2">
                <p className="text-xs font-medium text-slate-500 mb-1">Líneas del pedido</p>
                <ul className="divide-y divide-slate-100">
                  {result.lines.map((l, i) => (
                    <li key={i} className="py-1.5 flex justify-between text-sm">
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
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mt-2 mb-1">Justificante de entrega</p>
                <p className="text-xs text-slate-600">
                  Entregado el {new Date(result.pod.deliveredAt).toLocaleString("es-ES")}
                  {result.pod.receivedByName ? ` · Recibido por ${result.pod.receivedByName}` : ""}
                </p>

                {result.pod.signatureUrl && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">Firma</p>
                    <img
                      src={result.pod.signatureUrl}
                      alt="Firma de quien recibió el pedido"
                      className="w-full border border-slate-200 rounded-md bg-slate-50"
                    />
                    <a
                      href={result.pod.signatureUrl}
                      download={`firma-${result.orderNumber}.png`}
                      className="inline-block mt-1 text-xs text-brand-700 font-medium underline"
                    >
                      Descargar firma
                    </a>
                  </div>
                )}

                {result.pod.photoUrls && result.pod.photoUrls.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs font-medium text-slate-500 mb-1">Fotos de la entrega</p>
                    <div className="grid grid-cols-3 gap-2">
                      {result.pod.photoUrls.map((url, idx) => (
                        <a key={idx} href={url} download={`foto-${result.orderNumber}-${idx + 1}.jpg`}>
                          <img
                            src={url}
                            alt={`Foto de entrega ${idx + 1}`}
                            className="w-full aspect-square object-cover rounded-md border border-slate-200"
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
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mt-2 mb-1">Tu valoración</p>

                {result.feedback ? (
                  <div>
                    <div className="flex gap-1 text-base text-amber-400">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <span key={n}>{n <= result.feedback!.rating ? "★" : "☆"}</span>
                      ))}
                    </div>
                    {result.feedback.comment && (
                      <p className="text-sm text-slate-600 mt-1">{result.feedback.comment}</p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">Gracias por valorar esta entrega.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-slate-600">¿Cómo ha sido la entrega de este pedido?</p>
                    <div className="flex gap-1 text-xl">
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
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      rows={2}
                    />
                    <button
                      type="button"
                      disabled={rating === 0 || feedbackSending}
                      onClick={handleSendFeedback}
                      className="rounded-md bg-brand-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40"
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
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-medium text-slate-500 mt-2 mb-1">Incidencias reportadas</p>
                <ul className="space-y-1.5">
                  {result.incidents.map((inc, idx) => (
                    <li key={idx} className="text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-700">{INCIDENT_TYPE_LABEL[inc.incidentType] ?? inc.incidentType}</span>
                        <span className="text-xs font-medium bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                          {inc.status === "resolved" ? "Resuelta" : inc.status === "escalated" ? "Escalada" : "Abierta"}
                        </span>
                      </div>
                      {inc.description && <p className="text-xs text-slate-500">{inc.description}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Reportar / consultar una incidencia -- disponible salvo en pedidos cancelados */}
            {result.status !== "cancelled" && (
              <div className="pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between mt-2">
                  <p className="text-xs font-medium text-slate-500">¿Algún problema con este pedido?</p>
                  {!incidentOpen && (
                    <button
                      type="button"
                      onClick={() => {
                        setIncidentOpen(true);
                        setIncidentSent(false);
                      }}
                      className="text-xs text-brand-700 font-medium underline"
                    >
                      Reportar incidencia
                    </button>
                  )}
                </div>

                {incidentSent && !incidentOpen && (
                  <p className="text-sm text-green-700 mt-2">
                    Incidencia reportada. Nuestro equipo la revisará en breve.
                  </p>
                )}

                {incidentOpen && (
                  <div className="space-y-2 mt-2">
                    <select
                      value={incidentType}
                      onChange={(e) => setIncidentType(e.target.value)}
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                      className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                      rows={2}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={incidentSending}
                        onClick={handleSendIncident}
                        className="rounded-md bg-brand-700 text-white text-sm font-medium px-4 py-2 disabled:opacity-40"
                      >
                        {incidentSending ? "Enviando..." : "Enviar incidencia"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIncidentOpen(false)}
                        className="rounded-md text-sm text-slate-500 px-4 py-2 hover:bg-slate-100"
                      >
                        Cancelar
                      </button>
                    </div>
                    {incidentError && <p className="text-sm text-red-600">{incidentError}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
