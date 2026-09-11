// Fase 8R: estado en memoria de las importaciones del catálogo de productos
// en curso -- mismo patrón (y mismo motivo) que
// orders/lib/import-jobs.store.ts: un catálogo real (Bigmat ya tiene más de
// 10.000 productos) puede tardar más de lo que aguanta una petición HTTP
// antes de que el proxy la corte, así que el POST /products/import responde
// enseguida con un identificador de trabajo y el frontend va consultando el
// progreso (ver ImportProductsModal.tsx). Duplicado a propósito en vez de
// reutilizar el de "orders" -- mismo criterio de independencia entre
// servicios que ya se aplica en customer-master-import.service.ts.
import crypto from "node:crypto";
import type { ProductMasterImportSummary } from "../product-master-import.service";

export type ProductImportJobStatus = "processing" | "done" | "error";

export interface ProductImportJobState {
  id: string;
  status: ProductImportJobStatus;
  totalProducts: number;
  processedProducts: number;
  createdAt: number;
  summary?: ProductMasterImportSummary;
  error?: string;
}

const jobs = new Map<string, ProductImportJobState>();
const JOB_TTL_MS = 30 * 60 * 1000; // 30 minutos, de sobra para consultar el resultado

function cleanupOldJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of jobs) {
    if (job.createdAt < cutoff) jobs.delete(id);
  }
}

export function createProductImportJob(totalProducts: number): ProductImportJobState {
  cleanupOldJobs();
  const job: ProductImportJobState = {
    id: crypto.randomUUID(),
    status: "processing",
    totalProducts,
    processedProducts: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
}

export function getProductImportJob(id: string): ProductImportJobState | undefined {
  return jobs.get(id);
}

export function updateProductImportJob(id: string, patch: Partial<ProductImportJobState>): void {
  const job = jobs.get(id);
  if (!job) return;
  Object.assign(job, patch);
}
