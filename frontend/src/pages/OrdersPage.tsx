import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import NewOrderModal from "@/pages/orders/NewOrderModal";
import OrderDetailModal from "@/pages/orders/OrderDetailModal";
import ImportOrdersModal from "@/pages/orders/ImportOrdersModal";

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  priority: string;
  requestedDeliveryDate: string;
  totalWeightKg: number;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: { address: string; city: string | null };
  warehouse: { name: string };
}

export default function OrdersPage() {
  const [status, setStatus] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  // Carga de pedidos por Excel (instrucciones ampliadas del proyecto):
  // alternativa manual a la integración con el ERP, sobre todo para poder
  // meter datos de prueba sin depender de esa integración.
  const [importModalOpen, setImportModalOpen] = useState(false);
  // Objetivo 3/4: id del pedido cuyo detalle (líneas + justificante de
  // entrega) se está consultando -- null = modal cerrado. No toca el estado
  // ni el listado ya existentes.
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const { toast, showSuccess, showError, dismiss } = useToast();

  const { data, isLoading } = useQuery({
    queryKey: ["orders", status],
    queryFn: async () =>
      (await api.get("/orders", { params: status ? { status } : {} })).data as { items: OrderRow[]; total: number },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Pedidos</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} pedidos</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2"
          >
            <option value="">Todos los estados</option>
            <option value="received">Recibido</option>
            <option value="validated">Validado</option>
            <option value="planned">Planificado</option>
            <option value="loading">En carga</option>
            <option value="dispatched">Expedido</option>
            <option value="in_transit">En reparto</option>
            <option value="delivered">Entregado</option>
            <option value="incident">Incidencia</option>
            <option value="cancelled">Cancelado</option>
          </select>
          <button
            onClick={() => setImportModalOpen(true)}
            className="bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg"
          >
            Importar Excel
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            + Nuevo pedido
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Nº pedido</th>
              <th className="text-left px-4 py-3">Cliente</th>
              <th className="text-left px-4 py-3">Punto de entrega</th>
              <th className="text-left px-4 py-3">Almacén</th>
              <th className="text-left px-4 py-3">Fecha comprometida</th>
              <th className="text-left px-4 py-3">Peso (kg)</th>
              <th className="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No hay pedidos para este filtro.
                </td>
              </tr>
            )}
            {data?.items.map((o) => (
              <tr
                key={o.id}
                onClick={() => setSelectedOrderId(o.id)}
                className="hover:bg-slate-50 cursor-pointer"
              >

                <td className="px-4 py-3 font-medium text-slate-800">{o.orderNumber}</td>
                <td className="px-4 py-3">
                  {o.customer.businessCode} — {o.customer.legalName}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {o.deliveryPoint.address}
                  {o.deliveryPoint.city ? `, ${o.deliveryPoint.city}` : ""}
                </td>
                <td className="px-4 py-3 text-slate-500">{o.warehouse.name}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(o.requestedDeliveryDate).toLocaleDateString("es-ES")}
                </td>
                <td className="px-4 py-3 text-slate-500">{o.totalWeightKg.toFixed(1)}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewOrderModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <OrderDetailModal orderId={selectedOrderId} onClose={() => setSelectedOrderId(null)} />
      <ImportOrdersModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
