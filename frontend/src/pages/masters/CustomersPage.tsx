import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import Pagination from "@/components/Pagination";
import Chip from "@/components/Chip";
import { useToast } from "@/hooks/use-toast";
import ImportCustomersModal from "@/pages/masters/ImportCustomersModal";
import NewCustomerModal, { CustomerEditable } from "@/pages/masters/NewCustomerModal";
import { useAuthStore } from "@/store/auth-store";

interface CustomerRow {
  id: string;
  businessCode: string;
  legalName: string;
  commercialName: string | null;
  taxId: string | null;
  active: boolean;
  defaultAddress: string | null;
  defaultCity: string | null;
  defaultProvince: string | null;
  defaultPostalCode: string | null;
  _count: { deliveryPoints: number };
  // Mejora (2026-09-14): circuito de reparto (MAD1, Portu 4...) -- petición
  // explícita de Raúl para ver/segmentar qué clientes pertenecen a cada ruta.
  deliveryZone: { id: string; name: string } | null;
}

interface DeliveryZoneOption {
  id: string;
  name: string;
  scheduleNotes: string[];
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  // Maestro de direcciones por código de cliente -- ver ImportCustomersModal
  // y customer-master-import.service.ts. Resuelve que el Excel de Pedidos
  // exportado por el ERP no traiga la dirección de entrega (esta vive en la
  // ficha del socio dentro del ERP, no en la línea de pedido).
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Fase 7b: alta/edición manual de clientes -- el mismo modal sirve para
  // las dos cosas, según lleve o no un cliente ya cargado (ver NewCustomerModal).
  const [editingCustomer, setEditingCustomer] = useState<CustomerEditable | "new" | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();
  const queryClient = useQueryClient();
  // Fase 11: petición explícita de Raúl -- "quiero poder borrar cualquier
  // dato desde el perfil de administrador, incluidos datos que contengan
  // histórico". Ya no es una baja lógica: borra al cliente y TODOS sus datos
  // (pedidos, direcciones, tarifas, facturas, devoluciones) en cascada.
  const user = useAuthStore((s) => s.user);
  const canDelete = user?.roles?.some((r) => r === "admin_empresa" || r === "admin_plataforma") ?? false;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/customers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      showSuccess("Cliente eliminado, junto con todos sus pedidos y datos asociados");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo eliminar el cliente"),
  });

  function handleDelete(c: CustomerRow) {
    if (
      window.confirm(
        `¿Eliminar definitivamente al cliente "${c.legalName}"? Esta acción no se puede deshacer: se borrarán también todos sus pedidos, direcciones de entrega, tarifas, facturas y devoluciones, aunque sean históricos reales.`
      )
    ) {
      deleteMutation.mutate(c.id);
    }
  }

  // Paginación: antes siempre se pedía la página 1 sin control para avanzar,
  // así que a partir del cliente 26 (tamaño de página por defecto del
  // backend) no había forma de verlos desde aquí.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Mejora (2026-09-14): filtro por circuito de reparto -- "" es "todos",
  // "sin-circuito" es el valor especial que reconoce el backend para los
  // clientes sin asignar todavía.
  const [deliveryZoneId, setDeliveryZoneId] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customers", search, page, pageSize, deliveryZoneId],
    queryFn: async () =>
      (
        await api.get("/customers", {
          params: { search, page, pageSize, deliveryZoneId: deliveryZoneId || undefined },
        })
      ).data as {
        items: CustomerRow[];
        total: number;
      },
  });

  const { data: zonesData } = useQuery({
    queryKey: ["delivery-zones", "options"],
    queryFn: async () => (await api.get("/delivery-zones")).data as { items: DeliveryZoneOption[] },
  });
  const selectedZone = zonesData?.items.find((z) => z.id === deliveryZoneId);

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
          <select
            value={deliveryZoneId}
            onChange={(e) => {
              setDeliveryZoneId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2"
          >
            <option value="">Todos los circuitos</option>
            <option value="sin-circuito">Sin circuito</option>
            {zonesData?.items.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setImportModalOpen(true)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            Importar direcciones
          </button>
          <button
            onClick={() => setEditingCustomer("new")}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg whitespace-nowrap"
          >
            + Nuevo cliente
          </button>
        </div>
      </div>

      {/* Mejora (2026-09-14): recordatorio de los días de reparto del circuito
          seleccionado -- viene de `scheduleNote` (texto libre por transportista
          en la tarifa del circuito), no de un campo estructurado, así que puede
          haber más de uno si varios transportistas reparten esa zona en días
          distintos. */}
      {selectedZone && selectedZone.scheduleNotes.length > 0 && (
        <p className="text-xs text-slate-500 mb-2">
          Circuito {selectedZone.name} — reparto: {selectedZone.scheduleNotes.join(" / ")}
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Código</th>
              <th className="text-left px-4 py-3">Razón social</th>
              <th className="text-left px-4 py-3">Nombre comercial</th>
              <th className="text-left px-4 py-3">Dirección por defecto</th>
              <th className="text-left px-4 py-3">Circuito</th>
              <th className="text-right px-4 py-3">Puntos de entrega</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-left px-4 py-3">Acción</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="hover:bg-brand-50/60">
                <td className="px-4 py-3 font-mono font-semibold text-xs">{c.businessCode}</td>
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
                <td className="px-4 py-3">
                  {c.deliveryZone ? <Chip color="purple">{c.deliveryZone.name}</Chip> : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{c._count.deliveryPoints}</td>
                <td className="px-4 py-3">
                  <Chip color={c.active ? "teal" : "slate"}>{c.active ? "Activo" : "Inactivo"}</Chip>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <button
                    onClick={() => setEditingCustomer({ ...c, deliveryZoneId: c.deliveryZone?.id ?? null })}
                    className="text-xs text-brand-600 hover:text-brand-700 font-medium mr-3"
                  >
                    Editar
                  </button>
                  {canDelete && (
                    <button onClick={() => handleDelete(c)} className="text-xs text-red-500 hover:text-red-600 font-medium">
                      Eliminar
                    </button>
                  )}
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
      <NewCustomerModal
        open={editingCustomer !== null}
        customer={editingCustomer === "new" || editingCustomer === null ? null : editingCustomer}
        onClose={() => setEditingCustomer(null)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
