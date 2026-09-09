import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";

// Carga del maestro de clientes/socios (Código, Nombre, Dirección completa).
// Por qué existe: el Excel de Pedidos que exporta el ERP trae el código de
// cliente en cada línea pero no la dirección de entrega (en el ERP esa
// dirección vive en la ficha del socio, no en la línea de pedido) -- con
// esto se carga antes esa dirección por código de cliente, y la importación
// de Pedidos la usa como valor por defecto cuando el pedido no trae la suya
// propia (ver orders-excel-import.service.ts).
//
// A diferencia de ImportOrdersModal, este NO necesita sondeo de progreso: el
// maestro de clientes tiene como mucho unos pocos miles de filas (una por
// cliente, no una por línea de pedido), así que el propio POST responde ya
// con el resultado.
interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

interface CustomerMasterErrorRow {
  codigo: string;
  motivo: string;
}

interface CustomerMasterImportSummary {
  filasLeidas: number;
  clientesDetectados: number;
  clientesCreados: number;
  clientesActualizados: number;
  puntosDeEntregaCreados: number;
  sinCodigoPostalDetectado: string[];
  erroresParseo: string[];
  errores: CustomerMasterErrorRow[];
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

export default function ImportCustomersModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<CustomerMasterImportSummary | null>(null);

  const downloadMutation = useMutation({
    mutationFn: async () => {
      const res = await api.get("/customers/import/template", { responseType: "blob" });
      return res.data as Blob;
    },
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "plantilla-maestro-clientes.xlsx";
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
      const res = await api.post("/customers/import", { fileBase64, fileName: file.name });
      return res.data as CustomerMasterImportSummary;
    },
    onSuccess: (data) => {
      setSummary(data);
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      const total = data.clientesCreados + data.clientesActualizados;
      if (total > 0) onSuccess(`${total} cliente(s) con dirección cargada correctamente`);
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? err?.message ?? "Error al importar el archivo"),
  });

  function resetAndClose() {
    setFile(null);
    setSummary(null);
    onClose();
  }

  return (
    <Modal open={open} title="Importar direcciones de clientes" onClose={resetAndClose} wide>
      {!summary && (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Sube un Excel con Código, Nombre y Dirección completa de tus clientes. La importación de Pedidos usará
            esta dirección por defecto cuando el Excel de pedidos no traiga la suya propia (habitual cuando el ERP
            exporta el pedido solo con el código de cliente).
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
              disabled={importMutation.isPending}
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
              <p className="text-lg font-semibold text-emerald-700">{summary.clientesCreados}</p>
              <p className="text-xs text-slate-500">Clientes nuevos</p>
            </div>
            <div className="bg-sky-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-sky-700">{summary.clientesActualizados}</p>
              <p className="text-xs text-slate-500">Direcciones actualizadas</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-lg font-semibold text-red-700">{summary.errores.length}</p>
              <p className="text-xs text-slate-500">Con errores</p>
            </div>
          </div>

          <p className="text-xs text-slate-500">
            {summary.puntosDeEntregaCreados} punto(s) de entrega dado(s) de alta a partir de estas direcciones
            (visibles en Maestros &gt; Clientes, columna "Puntos de entrega").
          </p>

          {summary.sinCodigoPostalDetectado.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
              <h3 className="text-xs font-semibold text-amber-700 uppercase mb-2">
                Sin código postal detectado ({summary.sinCodigoPostalDetectado.length})
              </h3>
              <p className="text-xs text-amber-700 mb-1">
                Se ha guardado la dirección tal cual, pero no se ha encontrado un código postal de 5 dígitos dentro
                del texto. Revísalas a mano desde Maestros &gt; Clientes.
              </p>
              <p className="text-xs text-amber-600 font-mono break-all">
                {summary.sinCodigoPostalDetectado.join(", ")}
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
