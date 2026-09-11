// Fase 8Q2: mismo helper que Backoffice (frontend/src/lib/document-pdf.ts)
// para abrir el albarán/carta de porte en PDF -- necesita pedirse como blob
// autenticado (el endpoint exige el mismo token Bearer que el resto de la
// API) en vez de un <a href> normal, y así se abre en el visor de PDF nativo
// del móvil, listo para enseñar en un control de carretera.
import { api } from "@/api/client";

export async function viewDocumentPdf(path: string) {
  const res = await api.get(path, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}
