// Fase 8Q2: helper compartido para abrir/descargar los PDFs de documentación
// legal (albarán de entrega / carta de porte -- ver document-pdf.service.ts
// en el backend). Los endpoints exigen el mismo token Bearer que el resto de
// la API (`api` ya lo añade en su interceptor), así que un <a href> normal
// no serviría -- se pide como blob autenticado y se abre/descarga desde ahí,
// mismo patrón ya usado para la plantilla de importación de pedidos/clientes
// (ImportOrdersModal.tsx / ImportCustomersModal.tsx).
import { api } from "@/api/client";

// "Ver en pantalla": abre el PDF en una pestaña nueva con el visor nativo
// del navegador -- cubre a la vez el caso "verlo ahora" (Backoffice) y el de
// enseñarlo desde el móvil en un control de carretera (App Conductor).
export async function viewDocumentPdf(path: string) {
  const res = await api.get(path, { responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank");
}

// Descarga forzada (para archivar/enviar) -- mismo endpoint, con
// `?download=1` para que el backend cambie `Content-Disposition` a
// "attachment".
export async function downloadDocumentPdf(path: string, filename: string) {
  const res = await api.get(path, { params: { download: 1 }, responseType: "blob" });
  const blob = new Blob([res.data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
