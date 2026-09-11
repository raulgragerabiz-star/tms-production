import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";

// Fase 8R: carga masiva del catálogo de productos desde el formato de
// columnas REAL de Bigmat (CODIGO, DESCRIPCION, PROVEEDOR, Familia,
// Unidades Caja/Palet, Código EAN, Clasificación, medidas por Unidad/
// Paquete/Palet, Apilabilidad, Condiciones de Almacenamiento, Medida a Peso,
// Tipo Envase, Pedido mínimo B2C -- ver product-master-parser.ts).
//
// Mismo patrón que ImportOrdersModal: el POST /products/import responde de
// inmediato con un identificador de trabajo (un catálogo real puede tener
// varios miles de filas) y este modal va consultando el progreso.
interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface ProductImportErrorRow {
  codigo: string;
  motivo: string;
}

interface ProductMasterImportSummary {
  filasLeidas: number;
  productosDetectados: number;
  productosCreados: number;
  productosActualizados: number;
  erroresParseo: string[];
  errores: ProductImportErrorRow[];
}

interface ImportStatusResponse {
  status: "processing" | "done" | "error";
  totalProducts: number;
  processedProducts: number;
  summary?: ProductMasterImportSummary;
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

export default function ImportProductsModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<{ total: number; processed: number } | null>(null);
  const [summary, setSummary] = useState<ProductMasterImportSummary | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/products/import/template", { responseType: "blob" });
      return res.data as Blob;
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantilla-catalogo-productos.xlsx";
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
        const res = await api.get(`/products/import/${importId}/status`);
        const data = res.data as ImportStatusResponse;
        setProgress({ total: data.totalProducts, processed: data.processedProducts });

        if (data.status === "processing") {
          pollStatus(importId);
          return;
        }
        if (data.status === "error") {
          onError(data.error ?? "Error al importar el archivo");
          setProgress(null);
          return;
        }
        setSummary(data.summary ?? null);
        setProgress(null);
        queryClient.invalidateQueries({ queryKey: ["products"] });
        if (data.summary) {
          const total = data.summary.productosCreados + data.summary.productosActualizados;
          if (total > 0) onSuccess(`${total} producto(s) cargado(s) correctamente`);
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
      const res = await api.post("/products/import", { fileBase64, fileName: file.name });
      return res.data as { importId: string; totalProducts: number };
    },
    onSuccess: (data) => {
      setProgress({ total: data.totalProducts, processed: 0 });
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
    <Modal open={open} title="Importar catálogo de productos" onClose={resetAndClose} wide>
      {!summary && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Sube un Excel con la ficha de cada producto (CODIGO, DESCRIPCION, PROVEEDOR, Familia, unidades por
            caja/palé, Código EAN, Clasificación, medidas, apilabilidad, condiciones de almacenamiento, etc.). Si
            vuelves a subir el mismo fichero corregido más adelante, se actualiza por CODIGO en vez de duplicar.
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
                Procesando producto {progress.processed} de {progress.total}…
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
              <p className="text-lg font-semibold text-emerald-700">{summary.productosCreados}</p>
              <p className="text-xs text-slate-500">Productos nuevos</p>
            </div>
            <div className="bg-sky-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-sky-700">{summary.productosActualizados}</p>
              <p className="text-xs text-slate-500">Actualizados</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-red-700">{summary.errores.length}</p>
              <p className="text-xs text-slate-500">Con errores</p>
            </div>
          </div>

          {(summary.erroresParseo.length > 0 || summary.errores.length > 0) && (
            <div className="border border-red-200 rounded-lg p-3 max-h-48 overflow-y-auto">
              <h3 className="text-xs font-semibold text-red-700 uppercase mb-2">Incidencias</h3>
              <ul className="space-y-1 text-sm text-red-700">
                {summary.erroresParseo.map((e, i) => (
                  <li key={`p-${i}`}>{e}</li>
                ))}
                {summary.errores.map((e, i) => (
                  <li key={`o-${i}`}>
                    <span className="font-medium">{e.codigo}:</span> {e.motivo}
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
