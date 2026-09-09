import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { logoutCustomerPortal } from "@/api/auth";
import Chip, { ChipColor } from "@/components/Chip";

interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  serviceType: string;
  deliveryPoint: { label: string; city: string };
}

const STATUS_LABEL: Record<string, string> = {
  received: "Recibido",
  validated: "Validado",
  planned: "Planificado",
  loading: "En carga",
  dispatched: "Expedido",
  in_transit: "En reparto",
  delivered: "Entregado",
  incident: "Incidencia",
  cancelled: "Cancelado",
};

const STATUS_COLOR: Record<string, ChipColor> = {
  received: "slate",
  validated: "slate",
  planned: "blue",
  loading: "blue",
  dispatched: "blue",
  in_transit: "amber",
  delivered: "teal",
  incident: "red",
  cancelled: "slate",
};

export default function OrdersPage() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["customer-orders", search],
    queryFn: async () => {
      const res = await apiClient.get<{ orders: OrderSummary[] }>("/orders", {
        params: search ? { search } : {},
      });
      return res.data.orders;
    },
    // Objetivo 4: seguimiento visual sin recargar manualmente la página (antes
    // solo se refrescaba al hacer una nueva petición manual, igual que el
    // detalle de pedido).
    refetchInterval: 30000,
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800">Mis pedidos</h1>
        <button
          onClick={() => {
            logoutCustomerPortal();
            window.location.href = "/login";
          }}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Cerrar sesión
        </button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <input
          type="text"
          placeholder="Buscar por número de pedido..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-slate-300 px-4 py-2 text-sm"
        />

        {isLoading && <p className="text-sm text-slate-500">Cargando pedidos...</p>}

        <ul className="divide-y divide-slate-200 bg-white rounded-xl shadow">
          {data?.map((order) => (
            <li key={order.id}>
              <Link
                to={`/pedidos/${order.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-brand-50/60"
              >
                <div>
                  <p className="text-sm font-mono font-semibold text-slate-800">{order.orderNumber}</p>
                  <p className="text-xs text-slate-500">
                    {order.deliveryPoint.label} — {order.deliveryPoint.city}
                  </p>
                </div>
                <Chip color={STATUS_COLOR[order.status] ?? "slate"}>{STATUS_LABEL[order.status] ?? order.status}</Chip>
              </Link>
            </li>
          ))}
          {data?.length === 0 && (
            <li className="px-4 py-6 text-sm text-slate-500 text-center">
              No se han encontrado pedidos.
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
