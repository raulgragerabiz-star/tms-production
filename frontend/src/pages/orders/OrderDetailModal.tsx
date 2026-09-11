import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Modal from "@/components/Modal";

// "Ficha única del pedido" (instrucciones del proyecto ampliadas): integra
// albaranes digitales, observaciones, documentos, incidencias, estado y
// trazabilidad completa en una sola pantalla. Antes esto era solo líneas +
// POD; el resto (observaciones, documentos, incidencias, trazabilidad) o
// bien no se pedía al backend, o se pedía pero nunca se pintaba.

interface PodDetail {
  signatureUrl: string | null;
  photoUrls: string[] | null;
  receivedByName: string | null;
  deliveredAt: string;
}

interface DocumentRow {
  id: string;
  documentType: string;
  fileUrl: string;
  createdAt: string;
}

interface IncidentRow {
  id: string;
  incidentType: string;
  description: string | null;
  status: string;
  createdAt: string;
}

interface RouteStopRow {
  id: string;
  status: string;
  eta: string | null;
  pod: PodDetail | null;
  incidents: IncidentRow[];
  route: {
    routeDate: string;
    warehouse: { name: string };
    carrier: { legalName: string } | null;
    vehicle: { plate: string } | null;
    shipment: { id: string; status: string; departedAt: string | null; finishedAt: string | null } | null;
  };
}

interface TimelineEvent {
  id: string;
  eventType: string;
  occurredAt: string;
  payload: { routeStopId?: string } | null;
}

// Fase 8O: valoración de satisfacción que el cliente deja desde el portal
// (Portal Cliente / seguimiento público) -- ya se guardaba, pero no se veía
// en ningún sitio del Backoffice.
interface DeliveryFeedbackRow {
  rating: number;
  comment: string | null;
  createdAt: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  notes: string | null;
  createdAt: string;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: { address: string; city: string | null };
  warehouse: { name: string };
  lines: { quantity: number; unit: string; product: { sku: string; description: string } }[];
  documents: DocumentRow[];
  routeStops: RouteStopRow[];
  timeline: TimelineEvent[];
  deliveryFeedback: DeliveryFeedbackRow | null;
}

interface Props {
  orderId: string | null;
  onClose: () => void;
}

const documentTypeLabel: Record<string, string> = {
  delivery_note: "Albarán de entrega",
  carriage_note: "Carta de porte",
  pod: "Justificante de entrega",
  invoice: "Factura",
};

const incidentTypeLabel: Record<string, string> = {
  delay: "Retraso",
  damage: "Mercancía dañada",
  refused: "Rechazo del cliente",
  access_issue: "Problema de acceso",
  other: "Otro",
};

const eventTypeLabel: Record<string, string> = {
  stop_arrival: "Llegada a la parada",
  stop_departure: "Salida de la parada",
  status_change: "Cambio de estado del envío",
};

// Construye una traza cronológica única combinando: alta del pedido, creación
// de cada ruta por la que ha pasado, eventos de seguimiento reales (llegada/
// salida/cambios de estado, sin el gps_ping suelto -- demasiado granular para
// leer aquí) e incidencias, y el justificante de entrega si ya existe.
function buildTimeline(data: OrderDetail) {
  type Entry = { at: string; label: string; tone: "default" | "warning" | "success" };
  const entries: Entry[] = [
    { at: data.createdAt, label: "Pedido recibido", tone: "default" },
  ];

  for (const stop of data.routeStops) {
    entries.push({
      at: stop.route.routeDate,
      label: `Planificado en ruta del ${new Date(stop.route.routeDate).toLocaleDateString("es-ES")} (${stop.route.warehouse.name}${stop.route.carrier ? ` · ${stop.route.carrier.legalName}` : ""}${stop.route.vehicle ? ` · ${stop.route.vehicle.plate}` : ""})`,
      tone: "default",
    });
    for (const inc of stop.incidents) {
      entries.push({
        at: inc.createdAt,
        label: `Incidencia: ${incidentTypeLabel[inc.incidentType] ?? inc.incidentType}${inc.description ? ` — ${inc.description}` : ""}`,
        tone: "warning",
      });
    }
    if (stop.pod) {
      entries.push({
        at: stop.pod.deliveredAt,
        label: `Entregado${stop.pod.receivedByName ? ` · recibido por ${stop.pod.receivedByName}` : ""}`,
        tone: "success",
      });
    }
  }

  for (const ev of data.timeline) {
    entries.push({ at: ev.occurredAt, label: eventTypeLabel[ev.eventType] ?? ev.eventType, tone: "default" });
  }

  return entries.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

const toneDot: Record<string, string> = {
  default: "bg-slate-300",
  warning: "bg-amber-400",
  success: "bg-emerald-500",
};

export default function OrderDetailModal({ orderId, onClose }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}`)).data as OrderDetail,
    enabled: !!orderId,
  });

  const pod = data?.routeStops.find((s) => s.pod)?.pod ?? null;
  const allIncidents = data?.routeStops.flatMap((s) => s.incidents) ?? [];

  return (
    <Modal open={!!orderId} title={data ? `Pedido ${data.orderNumber}` : "Pedido"} onClose={onClose} wide>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {data && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-800 font-medium">
                {data.customer.businessCode} — {data.customer.legalName}
              </p>
              <p className="text-xs text-slate-500">
                {data.deliveryPoint.address}
                {data.deliveryPoint.city ? `, ${data.deliveryPoint.city}` : ""} · {data.warehouse.name}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Fecha comprometida: {new Date(data.requestedDeliveryDate).toLocaleDateString("es-ES")}
              </p>
            </div>
            <StatusBadge status={data.status} />
          </div>

          {data.notes && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-1">Observaciones</h3>
              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg p-3">{data.notes}</p>
            </div>
          )}

          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Líneas</h3>
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {data.lines.map((l, i) => (
                <li key={i} className="px-3 py-2 flex justify-between text-sm">
                  <span className="text-slate-700">
                    {l.product.sku} — {l.product.description}
                  </span>
                  <span className="text-slate-500">
                    {l.quantity} {l.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid md:grid-cols-2 gap-5">
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Documentos</h3>
              {data.documents.length === 0 && <p className="text-sm text-slate-400">Sin documentos adjuntos.</p>}
              {data.documents.length > 0 && (
                <ul className="space-y-1.5">
                  {data.documents.map((d) => (
                    <li key={d.id}>
                      <a
                        href={d.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-blue-700 underline"
                      >
                        {documentTypeLabel[d.documentType] ?? d.documentType}
                      </a>
                      <span className="text-xs text-slate-400 ml-2">
                        {new Date(d.createdAt).toLocaleDateString("es-ES")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">
                Incidencias {allIncidents.length > 0 && `(${allIncidents.length})`}
              </h3>
              {allIncidents.length === 0 && <p className="text-sm text-slate-400">Sin incidencias registradas.</p>}
              {allIncidents.length > 0 && (
                <ul className="space-y-1.5">
                  {allIncidents.map((inc) => (
                    <li key={inc.id} className="text-sm">
                      <span className="font-medium text-slate-700">{incidentTypeLabel[inc.incidentType] ?? inc.incidentType}</span>{" "}
                      <StatusBadge status={inc.status} />
                      {inc.description && <p className="text-xs text-slate-500">{inc.description}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Trazabilidad</h3>
            <ul className="space-y-2">
              {buildTimeline(data).map((entry, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${toneDot[entry.tone]}`} />
                  <div>
                    <p className="text-slate-700">{entry.label}</p>
                    <p className="text-xs text-slate-400">{new Date(entry.at).toLocaleString("es-ES")}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {data.status === "delivered" && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Justificante de entrega</h3>

              {!pod && (
                <p className="text-sm text-slate-500">Todavía no hay justificante disponible para este pedido.</p>
              )}

              {pod && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Entregado el {new Date(pod.deliveredAt).toLocaleString("es-ES")}
                    {pod.receivedByName ? ` · Recibido por ${pod.receivedByName}` : ""}
                  </p>

                  {pod.signatureUrl && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Firma</p>
                      <img
                        src={pod.signatureUrl}
                        alt="Firma de quien recibió el pedido"
                        className="w-full max-w-sm border border-slate-200 rounded-md bg-slate-50"
                      />
                      <a href={pod.signatureUrl} download={`firma-${data.orderNumber}.png`} className="inline-block mt-2 text-sm text-blue-700 font-medium underline">
                        Descargar firma
                      </a>
                    </div>
                  )}

                  {pod.photoUrls && pod.photoUrls.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Fotos de la entrega</p>
                      <div className="grid grid-cols-3 gap-2">
                        {pod.photoUrls.map((url, idx) => (
                          <a key={idx} href={url} download={`foto-${data.orderNumber}-${idx + 1}.jpg`}>
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
            </div>
          )}

          {/* Fase 8O: valoración de satisfacción que el cliente deja desde
              el portal -- ya se guardaba (DeliveryFeedback) pero no
              aparecía en ningún sitio de esta ficha. Mismo criterio que el
              justificante de entrega: solo tiene sentido una vez entregado. */}
          {data.status === "delivered" && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Valoración del cliente</h3>
              {!data.deliveryFeedback && (
                <p className="text-sm text-slate-500">El cliente todavía no ha valorado esta entrega.</p>
              )}
              {data.deliveryFeedback && (
                <div>
                  <div className="flex gap-0.5 text-lg text-amber-400">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <span key={n}>{n <= data.deliveryFeedback!.rating ? "★" : "☆"}</span>
                    ))}
                  </div>
                  {data.deliveryFeedback.comment && (
                    <p className="text-sm text-slate-600 mt-1">{data.deliveryFeedback.comment}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(data.deliveryFeedback.createdAt).toLocaleString("es-ES")}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
