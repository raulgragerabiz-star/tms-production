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

export interface TrackingResult {
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  city: string | null;
  timeline: TrackingTimelineStep[];
}

export async function lookupOrderTracking(orderNumber: string, postalCode: string): Promise<TrackingResult> {
  const res = await trackingClient.get("/lookup", { params: { orderNumber, postalCode } });
  return res.data as TrackingResult;
}
