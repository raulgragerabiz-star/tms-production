// Estado en memoria de las importaciones de pedidos por Excel en curso.
//
// Por qué en memoria y no en base de datos: un lote real (el informe de
// Bigmat aportado tiene 2.457 pedidos) tarda varios minutos en procesarse
// porque cada pedido hace varias idas y vueltas a la base de datos dentro de
// su propia transacción -- si el endpoint POST /orders/import esperase a que
// terminase TODO el lote antes de responder, la petición HTTP se quedaba
// colgada hasta que el proxy de Codespaces (o el propio navegador) la corta
// con un error de red, exactamente el problema que reportó Raúl. La solución
// es que el POST devuelva enseguida un identificador de trabajo y el
// navegador vaya preguntando el progreso -- para eso no hace falta que el
// estado sobreviva a un reinicio del proceso (es una importación manual que,
// si el servidor se reinicia a mitad, se puede simplemente repetir; el
// "Nº de pedido" ya creado no se duplica).
import crypto from "node:crypto";
import type { OrdersImportSummary } from "../orders-excel-import.service";

export type ImportJobStatus = "processing" | "done" | "error";

export interface ImportJobState {
  id: string;
  status: ImportJobStatus;
  totalOrders: number;
  processedOrders: number;
  createdAt: number;
  summary?: OrdersImportSummary;
  error?: string;
}

const jobs = new Map<string, ImportJobState>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutos, de sobra para consultar el resultado

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createImportJob(totalOrders: number): ImportJobState {
  cleanupOldJobs(); // aprovecha cada nueva importación para no acumular basura indefinidamente
  const job: ImportJobState = {
    id: crypto.randomUUID(),
    status: "processing",
    totalOrders,
    processedOrders: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getImportJob(id: string): ImportJobState | undefined {
  return jobs.get(id);
}

export function updateImportJob(id: string, patch: Partial<ImportJobState>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}
