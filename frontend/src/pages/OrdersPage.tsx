import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Chip from "@/components/Chip";
import Toast from "@/components/Toast";
import Pagination from "@/components/Pagination";
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
  // Mejora (2026-09-14): bultos/palés visibles en el listado -- petición
  // explícita de Raúl. `totalBoxes` es null cuando ningún producto del
  // pedido tiene todavía `unitsPerBox` cargado en el maestro.
  totalPallets: number;
  totalBoxes: number | null;
  customer: { businessCode: string; legalName: string; deliveryZone: { id: string; name: string } | null };
  deliveryPoint: { address: string; city: string | null };
  warehouse: { name: string };
}

interface DeliveryZoneOption {
  id: string;
  name: string;
  scheduleNotes: string[];
}

function formatPalletsBoxes(totalPallets: number, totalBoxes: number | null): string {
  const palletsLabel = `${totalPallets.toFixed(1)} palés`;
  return totalBoxes != null ? `${palletsLabel} · ${Math.round(totalBoxes)} bultos` : palletsLabel;
}

// Fase 8O: sondeo del campo de búsqueda antes de disparar la consulta --
// mismo criterio de siempre (no lanzar una petición por cada pulsación de
// tecla).
const SEARCH_DEBOUNCE_MS = 350;

export default function OrdersPage() {
  const [status, setStatus] = useState<string>("");
  // Fase 8O: buscador por nº de pedido, aparte del desplegable de estados
  // ya existente -- petición de Raúl, antes solo se podía filtrar por
  // estado o recorrer páginas a mano para encontrar un pedido concreto.
  const [orderNumberInput, setOrderNumberInput] = useState("");
  const [orderNumberSearch, setOrderNumberSearch] = useState("");
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

  // Paginación: antes siempre se pedía la página 1 sin ningún control para
  // avanzar, así que con más pedidos de los que caben en una página
  // (por defecto 25) el resto quedaba invisible sin ninguna forma de verlo.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  // Mejora (2026-09-14): filtro por circuito de reparto, para poder segmentar
  // los pedidos integrados según la ruta a la que pertenece su cliente --
  // petición explícita de Raúl. "" = todos, "sin-circuito" = clientes sin
  // asignar todavía (mismo valor especial que reconoce /customers).
  const [deliveryZoneId, setDeliveryZoneId] = useState("");

  // Fase 8O: debounce del buscador -- ver comentario junto a
  // SEARCH_DEBOUNCE_MS más arriba.
  useEffect(() => {
    const timer = setTimeout(() => {
      setOrderNumberSearch(orderNumberInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [orderNumberInput]);

  const { data, isLoading } = useQuery({
    queryKey: ["orders", status, orderNumberSearch, page, pageSize, deliveryZoneId],
    queryFn: async () =>
      (
        await api.get("/orders", {
          params: {
            ...(status ? { status } : {}),
            ...(orderNumberSearch ? { orderNumber: orderNumberSearch } : {}),
            ...(deliveryZoneId ? { deliveryZoneId } : {}),
            page,
            pageSize,
          },
        })
      ).data as {
        items: OrderRow[];
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
          <h1 className="text-xl font-semibold text-slate-900">Pedidos</h1>
          <p className="text-sm text-slate-500">{data?.total ?? 0} pedidos</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={orderNumberInput}
            onChange={(e) => setOrderNumberInput(e.target.value)}
            placeholder="Buscar por nº de pedido…"
            className="rounded-lg border border-slate-300 text-sm px-3 py-2 w-48"
          />
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
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

      {/* Mejora (2026-09-14): mismo recordatorio de días de reparto que en
          Clientes -- ver comentario allí sobre `scheduleNotes`. */}
      {selectedZone && selectedZone.scheduleNotes.length > 0 && (
        <p className="text-xs text-slate-500 mb-2">
          Circuito {selectedZone.name} — reparto: {selectedZone.scheduleNotes.join(" / ")}
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          {/* 2026-09-09: cabecera fija (sticky) y fila resaltada en ámbar al
              pasar el ratón -- mismo patrón de tabla del panel de referencia
              (TMS Getafe), extendido ahora de Analítica a las tablas
              principales del Backoffice. */}
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Nº pedido</th>
              <th className="text-left px-4 py-3">Cliente</th>
              <th className="text-left px-4 py-3">Circuito</th>
              <th className="text-left px-4 py-3">Punto de entrega</th>
              <th className="text-left px-4 py-3">Almacén</th>
              <th className="text-left px-4 py-3">Fecha comprometida</th>
              <th className="text-right px-4 py-3">Peso (kg)</th>
              <th className="text-left px-4 py-3">Bultos/Palés</th>
              <th className="text-left px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-slate-400">
                  No hay pedidos para este filtro.
                </td>
              </tr>
            )}
            {data?.items.map((o) => (
              <tr
                key={o.id}
                onClick={() => setSelectedOrderId(o.id)}
                className="hover:bg-brand-50/60 cursor-pointer"
              >

                <td className="px-4 py-3 font-mono font-semibold text-slate-800">{o.orderNumber}</td>
                <td className="px-4 py-3">
                  {o.customer.businessCode} — {o.customer.legalName}
                </td>
                <td className="px-4 py-3">
                  {o.customer.deliveryZone ? (
                    <Chip color="purple">{o.customer.deliveryZone.name}</Chip>
                  ) : (
                    <span className="text-slate-300">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">
                  {o.deliveryPoint.address}
                  {o.deliveryPoint.city ? `, ${o.deliveryPoint.city}` : ""}
                </td>
                <td className="px-4 py-3 text-slate-500">{o.warehouse.name}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(o.requestedDeliveryDate).toLocaleDateString("es-ES")}
                </td>
                <td className="px-4 py-3 text-right font-mono text-slate-600">{o.totalWeightKg.toFixed(1)}</td>
                <td className="px-4 py-3">
                  <Chip color="blue">{formatPalletsBoxes(o.totalPallets, o.totalBoxes)}</Chip>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={o.status} />
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
