import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import { resolveCustomerPortalUrl } from "@/lib/customer-portal-url";

// Carga de pedidos por Excel (instrucciones ampliadas: "Recepción de pedidos
// desde cualquier origen -- ERP, API o carga manual"), pensada sobre todo
// para poder alimentar la aplicación con datos de prueba sin depender de la
// integración real con el ERP.
//
// El POST /orders/import responde de inmediato con un identificador de
// trabajo (el procesamiento real, potencialmente miles de pedidos, ocurre
// en segundo plano en el backend) -- este modal va consultando el progreso
// cada segundo hasta que termina. Antes se esperaba aquí mismo a que
// terminase todo el lote, y con un archivo grande la petición se cortaba
// con un error de red antes de recibir respuesta.
//
// La consulta de estado por parte del cliente ya NO crea un usuario ni una
// contraseña por cliente (decisión de Raúl: un acceso único para todos,
// diferenciado solo por el número de pedido consultado -- ver
// apps/customer-portal/src/pages/TrackOrderPage.tsx en /seguimiento).
interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface ImportErrorRow {
  pedido: string;
  motivo: string;
}

interface CreatedCustomerInfo {
  customerId: string;
  businessCode: string;
  legalName: string;
}

interface OrdersImportSummary {
  filasLeidas: number;
  pedidosDetectados: number;
  pedidosCreados: number;
  pedidosOmitidos: number;
  erroresParseo: string[];
  errores: ImportErrorRow[];
  clientesCreados: CreatedCustomerInfo[];
  productosCreadosAutomaticamente: string[];
}

interface ImportStatusResponse {
  status: "processing" | "done" | "error";
  totalOrders: number;
  processedOrders: number;
  summary?: OrdersImportSummary;
  error?: string;
}

const POLL_INTERVAL_MS = 1000;

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export default function ImportOrdersModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ total: number; processed: number } | null>(null);
  const [summary, setSummary] = useState<OrdersImportSummary | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const portalUrl = resolveCustomerPortalUrl();

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/orders/import/template", { responseType: "blob" });
      return res.data as Blob;
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantilla-carga-pedidos.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    onError: () => onError("No se ha podido descargar la plantilla"),
  });

  function pollStatus(importId: string) {
    pollTimer.current = setTimeout(async () => {
      try {
        const res = await api.get(`/orders/import/${importId}/status`);
        const data = res.data as ImportStatusResponse;
        setProgress({ total: data.totalOrders, processed: data.processedOrders });

        if (data.status === "processing") {
          pollStatus(importId);
          return;
        }
        if (data.status === "error") {
          onError(data.error ?? "Error al importar el archivo");
          setProgress(null);
          return;
        }
        // status === "done"
        setSummary(data.summary ?? null);
        setProgress(null);
        queryClient.invalidateQueries({ queryKey: ["orders"] });
        if (data.summary && data.summary.pedidosCreados > 0) {
          onSuccess(`${data.summary.pedidosCreados} pedido(s) importado(s) correctamente`);
        }
      } catch {
        onError("Se ha perdido la conexión mientras se comprobaba el progreso de la importación");
        setProgress(null);
      }
    }, POLL_INTERVAL_MS);
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecciona primero un archivo");
      const buffer = await file.arrayBuffer();
      const fileBase64 = arrayBufferToBase64(buffer);
      const res = await api.post("/orders/import", { fileBase64, fileName: file.name });
      return res.data as { importId: string; totalOrders: number };
    },
    onSuccess: (data) => {
      setProgress({ total: data.totalOrders, processed: 0 });
      pollStatus(data.importId);
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? err?.message ?? "Error al importar el archivo"),
  });

  function resetAndClose() {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    setFile(null);
    setSummary(null);
    setProgress(null);
    onClose();
  }

  const isBusy = importMutation.isPending || progress != null;

  return (
    <Modal open={open} title="Importar pedidos desde Excel" onClose={resetAndClose} wide>
      {!summary && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Sube un Excel con uno o varios pedidos (una fila por línea de pedido, repitiendo el Nº de pedido si
            tiene varias líneas) para probar la aplicación sin depender de la integración con el ERP.
          </p>

          <button
            onClick={() => downloadMutation.mutate()}
            disabled={downloadMutation.isPending}
            className="text-sm text-brand-600 hover:text-brand-700 font-medium underline"
          >
            {downloadMutation.isPending ? "Generando plantilla…" : "Descargar plantilla de ejemplo"}
          </button>

          <div>
            <input
              type="file"
              accept=".xlsx,.xls"
              disabled={isBusy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
          </div>

          {progress && (
            <div className="space-y-1.5">
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-600 transition-all"
                  style={{ width: `${progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                Procesando pedido {progress.processed} de {progress.total}…
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={resetAndClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
              Cancelar
            </button>
            <button
              onClick={() => importMutation.mutate()}
              disabled={!file || isBusy}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {isBusy ? "Importando…" : "Importar"}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-slate-800">{summary.filasLeidas}</p>
              <p className="text-xs text-slate-500">Filas leídas</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-emerald-700">{summary.pedidosCreados}</p>
              <p className="text-xs text-slate-500">Pedidos creados</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-amber-700">{summary.pedidosOmitidos}</p>
              <p className="text-xs text-slate-500">Omitidos (duplicados)</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-red-700">{summary.errores.length}</p>
              <p className="text-xs text-slate-500">Con errores</p>
            </div>
          </div>

          {summary.pedidosCreados > 0 && (
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-600">
                Para consultar el estado de cualquiera de estos pedidos no hace falta usuario ni contraseña: basta
                con el número de pedido y el código postal de la entrega en{" "}
                <a href={`${portalUrl}/seguimiento`} target="_blank" rel="noreferrer" className="underline font-medium">
                  {portalUrl}/seguimiento
                </a>
                .
              </p>
            </div>
          )}

          {summary.clientesCreados.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Clientes nuevos dados de alta ({summary.clientesCreados.length})
              </h3>
              <p className="text-xs text-slate-400 break-all">
                {summary.clientesCreados.map((c) => `${c.businessCode} — ${c.legalName}`).join(" · ")}
              </p>
            </div>
          )}

          {summary.productosCreadosAutomaticamente.length > 0 && (
            <div className="border border-slate-200 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-slate-500 uppercase mb-2">
                Productos creados automáticamente ({summary.productosCreadosAutomaticamente.length})
              </h3>
              <p className="text-xs text-slate-500 mb-1">
                No existían en el catálogo; se han creado con datos mínimos (peso provisional 1 kg). Complétalos
                desde Maestros &gt; Productos cuando se conozcan sus datos reales.
              </p>
              <p className="text-xs text-slate-400 font-mono break-all">
                {summary.productosCreadosAutomaticamente.join(", ")}
              </p>
            </div>
          )}

          {(summary.erroresParseo.length > 0 || summary.errores.length > 0) && (
            <div className="border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto">
              <h3 className="text-xs font-semibold text-red-700 uppercase mb-2">Incidencias</h3>
              <ul className="space-y-1 text-sm text-red-700">
                {summary.erroresParseo.map((e, i) => (
                  <li key={`p-${i}`}>{e}</li>
                ))}
                {summary.errores.map((e, i) => (
                  <li key={`o-${i}`}>
                    <span className="font-medium">{e.pedido}:</span> {e.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => {
                setSummary(null);
                setFile(null);
              }}
              className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700"
            >
              Importar otro archivo
            </button>
            <button
              onClick={resetAndClose}
              className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
