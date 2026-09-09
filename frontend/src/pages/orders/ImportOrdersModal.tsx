import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import { resolveCustomerPortalUrl } from "@/lib/customer-portal-url";

// Carga de pedidos por Excel (instrucciones ampliadas: "Recepción de pedidos
// desde cualquier origen -- ERP, API o carga manual"), pensada sobre todo
// para poder alimentar la aplicación con datos de prueba sin depender de la
// integración real con el ERP. Backend: POST /orders/import (ver
// orders-excel-import.service.ts) -- el fichero se manda en base64 dentro
// del JSON, sin librería de subida de ficheros nueva.
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

interface CreatedCustomerCredential {
  customerId: string;
  businessCode: string;
  legalName: string;
  email: string;
  password: string;
}

interface OrdersImportSummary {
  filasLeidas: number;
  pedidosDetectados: number;
  pedidosCreados: number;
  pedidosOmitidos: number;
  erroresParseo: string[];
  errores: ImportErrorRow[];
  clientesCreados: CreatedCustomerCredential[];
  productosCreadosAutomaticamente: string[];
}

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
  const [summary, setSummary] = useState<OrdersImportSummary | null>(null);
  const portalUrl = resolveCustomerPortalUrl();

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

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Selecciona primero un archivo");
      const buffer = await file.arrayBuffer();
      const fileBase64 = arrayBufferToBase64(buffer);
      const res = await api.post("/orders/import", { fileBase64, fileName: file.name });
      return res.data.summary as OrdersImportSummary;
    },
    onSuccess: (data) => {
      setSummary(data);
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      if (data.pedidosCreados > 0) {
        onSuccess(`${data.pedidosCreados} pedido(s) importado(s) correctamente`);
      }
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? err?.message ?? "Error al importar el archivo"),
  });

  function resetAndClose() {
    setFile(null);
    setSummary(null);
    onClose();
  }

  return (
    <Modal open={open} title="Importar pedidos desde Excel" onClose={resetAndClose} wide>
      {!summary && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Sube un Excel con uno o varios pedidos (una fila por línea de pedido, repitiendo el Nº de pedido si
            tiene varias líneas) para probar la aplicación sin depender de la integración con el ERP. Si un
            cliente no existe todavía, se da de alta automáticamente junto con un usuario de acceso al Portal
            Cliente.
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
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={resetAndClose} className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700">
              Cancelar
            </button>
            <button
              onClick={() => importMutation.mutate()}
              disabled={!file || importMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {importMutation.isPending ? "Importando…" : "Importar"}
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

          {summary.clientesCreados.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-amber-800 uppercase mb-2">
                Clientes nuevos con acceso al Portal Cliente creado
              </h3>
              <p className="text-xs text-amber-700 mb-2">
                Apunta o comparte estas credenciales ahora: la contraseña no se puede volver a consultar aquí (se
                puede resetear desde Maestros &gt; Usuarios si se pierde). Enlace del portal:{" "}
                <a href={portalUrl} target="_blank" rel="noreferrer" className="underline font-medium">
                  {portalUrl}
                </a>
              </p>
              <ul className="space-y-1.5">
                {summary.clientesCreados.map((c) => (
                  <li key={c.customerId} className="text-sm bg-white rounded-md px-3 py-2 border border-amber-100">
                    <span className="font-medium text-slate-700">
                      {c.businessCode} — {c.legalName}
                    </span>
                    <br />
                    <span className="text-slate-500">Usuario: </span>
                    <span className="font-mono text-slate-800">{c.email}</span>
                    <span className="text-slate-500"> · Contraseña: </span>
                    <span className="font-mono text-slate-800">{c.password}</span>
                  </li>
                ))}
              </ul>
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
            <div className="border border-red-200 rounded-lg p-3">
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
              onClick={() => setSummary(null)}
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
