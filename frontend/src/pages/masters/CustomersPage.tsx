import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Pagination from "@/components/Pagination";
import { useToast } from "@/hooks/use-toast";
import ImportCustomersModal from "@/pages/masters/ImportCustomersModal";

interface CustomerRow {
  id: string;
  businessCode: string;
  legalName: string;
  commercialName: string | null;
  active: boolean;
  defaultAddress: string | null;
  defaultCity: string | null;
  defaultPostalCode: string | null;
  _count: { deliveryPoints: number };
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  // Maestro de direcciones por código de cliente -- ver ImportCustomersModal
  // y customer-master-import.service.ts. Resuelve que el Excel de Pedidos
  // exportado por el ERP no traiga la dirección de entrega (esta vive en la
  // ficha del socio dentro del ERP, no en la línea de pedido).
  const [importModalOpen, setImportModalOpen] = useState(false);
  const { toast, showSuccess, showError, dismiss } = useToast();

  // Paginación: antes siempre se pedía la página 1 sin control para avanzar,
  // así que a partir del cliente 26 (tamaño de página por defecto del
  // backend) no había forma de verlos desde aquí.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page, pageSize],
    queryFn: async () =>
      (await api.get("/customers", { params: { search, page, pageSize } })).data as {
        items: CustomerRow[];
        total: number;
      },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} clientes registrados</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            placeholder="Buscar por código o nombre…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-64"
          />
          <button
            onClick={() => setImportModalOpen(true)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            Importar direcciones
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Código</th>
              <th className="text-left px-4 py-3">Razón social</th>
              <th className="text-left px-4 py-3">Nombre comercial</th>
              <th className="text-left px-4 py-3">Dirección por defecto</th>
              <th className="text-left px-4 py-3">Puntos de entrega</th>
              <th className="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{c.businessCode}</td>
                <td className="px-4 py-3">{c.legalName}</td>
                <td className="px-4 py-3 text-slate-500">{c.commercialName ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">
                  {c.defaultAddress ? (
                    <>
                      {c.defaultAddress}
                      {c.defaultCity ? `, ${c.defaultCity}` : ""}
                      {c.defaultPostalCode ? ` (${c.defaultPostalCode})` : ""}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3">{c._count.deliveryPoints}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${c.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    {c.active ? "Activo" : "Inactivo"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination
          page={page}
          pageSize={pageSize}
          total={data?.total ?? 0}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      <ImportCustomersModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
