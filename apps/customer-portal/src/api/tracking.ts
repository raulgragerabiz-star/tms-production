import axios from "axios";
import { resolveApiBaseUrl } from "./client";

// Consulta pública de estado de pedido (Nº pedido + código postal), sin
// usuario ni contraseña -- ver backend/src/modules/tracking/tracking.routes.ts.
// Cliente axios aparte del de `client.ts` a propósito: ese apunta a
// /api/customer-portal (con token y con redirección a /login en un 401), y
// esta consulta no necesita ni lo uno ni lo otro.
const trackingClient = axios.create({
  baseURL: `${resolveApiBaseUrl()}/api/tracking`,
});

export interface TrackingTimelineStep {
  key: string;
  label: string;
  done: boolean;
}

export interface TrackingLine {
  product: string;
  quantity: number;
  unit: string;
}

export interface TrackingPod {
  signatureUrl: string | null;
  photoUrls: string[] | null;
  receivedByName: string | null;
  deliveredAt: string;
}

export interface TrackingFeedback {
  rating: number;
  comment: string | null;
}

export interface TrackingIncident {
  incidentType: string;
  status: string;
  description: string | null;
  createdAt: string;
}

export interface TrackingLivePosition {
  lat: number;
  lng: number;
  occurredAt: string;
}

export interface TrackingResult {
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  deliveryPoint: { label: string | null; address: string; city: string | null };
  lines: TrackingLine[];
  timeline: TrackingTimelineStep[];
  livePosition: TrackingLivePosition | null;
  pod: TrackingPod | null;
  feedback: TrackingFeedback | null;
  incidents: TrackingIncident[];
}

export async function lookupOrderTracking(orderNumber: string, postalCode: string): Promise<TrackingResult> {
  const res = await trackingClient.get("/lookup", { params: { orderNumber, postalCode } });
  return res.data as TrackingResult;
}

export async function submitTrackingFeedback(
  orderNumber: string,
  postalCode: string,
  rating: number,
  comment?: string
): Promise<TrackingFeedback> {
  const res = await trackingClient.post("/feedback", { orderNumber, postalCode, rating, comment });
  return res.data as TrackingFeedback;
}

export async function reportTrackingIncident(
  orderNumber: string,
  postalCode: string,
  incidentType: string,
  description?: string
): Promise<TrackingIncident> {
  const res = await trackingClient.post("/incidents", { orderNumber, postalCode, incidentType, description });
  return res.data as TrackingIncident;
}
