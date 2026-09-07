import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Modal from "@/components/Modal";
import Field from "@/components/Field";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** Prefijados al abrir desde el drag&drop del planificador (soltar un pedido en "nueva ruta"). */
  presetOrderId?: string;
  presetWarehouseId?: string;
  presetServiceType?: "full_truck" | "pallet";
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface PendingOrder {
  id: string;
  orderNumber: string;
  status: string;
  totalWeightKg: number;
  customer: { legalName: string };
  warehouse: { id: string; name: string };
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

export default function NewRouteModal({
  open,
  onClose,
  onSuccess,
  onError,
  presetOrderId,
  presetWarehouseId,
  presetServiceType,
}: Props) {
  const queryClient = useQueryClient();

  const [warehouseId, setWarehouseId] = useState(presetWarehouseId ?? "");
  const [routeDate, setRouteDate] = useState("");
  const [serviceType, setServiceType] = useState<"full_truck" | "pallet">(presetServiceType ?? "pallet");
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>(presetOrderId ? [presetOrderId] : []);

  // Sincroniza los valores prefijados cada vez que el modal se abre desde el drag&drop,
  // ya que el componente permanece montado entre aperturas.
  useMemo(() => {
    if (open) {
      if (presetOrderId) setSelectedOrderIds([presetOrderId]);
      if (presetWarehouseId) setWarehouseId(presetWarehouseId);
      if (presetServiceType) setServiceType(presetServiceType);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, presetOrderId, presetWarehouseId, presetServiceType]);

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
    enabled: open,
  });

  const pendingOrdersQuery = useQuery({
    queryKey: ["orders", "validated"],
    queryFn: async () => (await api.get("/orders", { params: { status: "validated", pageSize: 100 } })).data as { items: PendingOrder[] },
    enabled: open,
  });

  const filteredOrders = useMemo(
    () => (pendingOrdersQuery.data?.items ?? []).filter((o) => !warehouseId || o.warehouse.id === warehouseId),
    [pendingOrdersQuery.data, warehouseId]
  );

  const mutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/routes", {
          warehouseId,
          routeDate,
          serviceType,
          orderIds: selectedOrderIds,
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["routes"] });
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onSuccess("Ruta creada correctamente");
      resetAndClose();
    },
    onError: (err: any) => onError(err?.response?.data?.message ?? "Error al crear la ruta"),
  });

  function resetAndClose() {
    setWarehouseId("");
    setRouteDate("");
    setServiceType("pallet");
    setSelectedOrderIds([]);
    onClose();
  }

  function toggleOrder(id: string) {
    setSelectedOrderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canSubmit = warehouseId && routeDate && selectedOrderIds.length > 0;

  return (
    <Modal open={open} title="Nueva ruta / carga" onClose={resetAndClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-3 gap-4">
          <Field label="Almacén de salida" required>
            <select className={inputCls} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required>
              <option value="">Selecciona…</option>
              {warehousesQuery.data?.items.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Fecha de la ruta" required>
            <input type="date" className={inputCls} value={routeDate} onChange={(e) => setRouteDate(e.target.value)} required />
          </Field>
          <Field label="Tipo de servicio" required>
            <select className={inputCls} value={serviceType} onChange={(e) => setServiceType(e.target.value as any)}>
              <option value="pallet">Paletería</option>
              <option value="full_truck">Camión completo</option>
            </select>
          </Field>
        </div>

        <div>
          <p className="text-sm font-medium text-slate-700 mb-2">
            Pedidos validados pendientes de planificar ({selectedOrderIds.length} seleccionados)
          </p>
          <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto divide-y divide-slate-100">
            {pendingOrdersQuery.isLoading && <p className="p-4 text-sm text-slate-400">Cargando…</p>}
            {!pendingOrdersQuery.isLoading && filteredOrders.length === 0 && (
              <p className="p-4 text-sm text-slate-400">No hay pedidos validados pendientes para este almacén.</p>
            )}
            {filteredOrders.map((o) => (
              <label key={o.id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedOrderIds.includes(o.id)}
                  onChange={() => toggleOrder(o.id)}
                  className="rounded border-slate-300"
                />
                <span className="font-medium text-slate-700">{o.orderNumber}</span>
                <span className="text-slate-500">{o.customer.legalName}</span>
                <span className="ml-auto text-slate-400 text-xs">{o.totalWeightKg.toFixed(1)} kg</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={resetAndClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-100">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium disabled:opacity-50"
          >
            {mutation.isPending ? "Creando…" : "Crear ruta"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
