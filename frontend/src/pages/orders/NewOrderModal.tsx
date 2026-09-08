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
}

interface CustomerOption {
  id: string;
  businessCode: string;
  legalName: string;
}

interface DeliveryPointOption {
  id: string;
  label: string | null;
  address: string;
  city: string | null;
}

interface WarehouseOption {
  id: string;
  name: string;
}

interface ProductOption {
  id: string;
  sku: string;
  description: string;
}

interface LineDraft {
  productId: string;
  quantity: string;
  unit: string;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500";

const serviceTypeOptions = [
  { value: "", label: "Automático (por peso/palés)" },
  { value: "paqueteria", label: "Paquetería" },
  { value: "paleteria", label: "Paletería" },
  { value: "paleteria_pesada", label: "Paletería pesada" },
  { value: "gran_volumen", label: "Gran volumen / Camión completo" },
] as const;

export default function NewOrderModal({ open, onClose, onSuccess, onError }: Props) {
  const queryClient = useQueryClient();

  const [orderNumber, setOrderNumber] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [deliveryPointId, setDeliveryPointId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [priority, setPriority] = useState<"standard" | "urgent">("standard");
  const [serviceType, setServiceType] = useState<"" | "paqueteria" | "paleteria" | "paleteria_pesada" | "gran_volumen">("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ productId: "", quantity: "1", unit: "UD" }]);

  const customersQuery = useQuery({
    queryKey: ["customers-all"],
    queryFn: async () => (await api.get("/customers", { params: { pageSize: 100 } })).data as { items: CustomerOption[] },
    enabled: open,
  });

  const deliveryPointsQuery = useQuery({
    queryKey: ["delivery-points", customerId],
    queryFn: async () => (await api.get("/delivery-points", { params: { customerId } })).data as { items: DeliveryPointOption[] },
    enabled: open && !!customerId,
  });

  const warehousesQuery = useQuery({
    queryKey: ["warehouses"],
    queryFn: async () => (await api.get("/warehouses")).data as { items: WarehouseOption[] },
    enabled: open,
  });

  const productsQuery = useQuery({
    queryKey: ["products-all"],
    queryFn: async () => (await api.get("/products", { params: { pageSize: 100 } })).data as { items: ProductOption[] },
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        orderNumber,
        customerId,
        deliveryPointId,
        warehouseId,
        priority,
        serviceType: serviceType || undefined,
        requestedDeliveryDate,
        notes: notes || undefined,
        lines: lines
          .filter((l) => l.productId && Number(l.quantity) > 0)
          .map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unit: l.unit })),
      };
      return (await api.post("/orders", payload)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["orders"] });
      onSuccess("Pedido creado correctamente");
      resetAndClose();
    },
    onError: (err: any) => {
      onError(err?.response?.data?.message ?? "Error al crear el pedido");
    },
  });

  function resetAndClose() {
    setOrderNumber("");
    setCustomerId("");
    setDeliveryPointId("");
    setWarehouseId("");
    setPriority("standard");
    setServiceType("");
    setRequestedDeliveryDate("");
    setNotes("");
    setLines([{ productId: "", quantity: "1", unit: "UD" }]);
    onClose();
  }

  function updateLine(idx: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [...prev, { productId: "", quantity: "1", unit: "UD" }]);
  }

  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  const canSubmit = useMemo(
    () =>
      orderNumber.trim() &&
      customerId &&
      deliveryPointId &&
      warehouseId &&
      requestedDeliveryDate &&
      lines.some((l) => l.productId && Number(l.quantity) > 0),
    [orderNumber, customerId, deliveryPointId, warehouseId, requestedDeliveryDate, lines]
  );

  return (
    <Modal open={open} title="Nuevo pedido" onClose={resetAndClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Nº de pedido" required>
            <input className={inputCls} value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} required />
          </Field>
          <Field label="Fecha de entrega comprometida" required>
            <input
              type="date"
              className={inputCls}
              value={requestedDeliveryDate}
              onChange={(e) => setRequestedDeliveryDate(e.target.value)}
              required
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cliente" required>
            <select
              className={inputCls}
              value={customerId}
              onChange={(e) => {
                setCustomerId(e.target.value);
                setDeliveryPointId("");
              }}
              required
            >
              <option value="">Selecciona un cliente…</option>
              {customersQuery.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.businessCode} — {c.legalName}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Punto de entrega" required hint={!customerId ? "Selecciona primero un cliente" : undefined}>
            <select
              className={inputCls}
              value={deliveryPointId}
              onChange={(e) => setDeliveryPointId(e.target.value)}
              disabled={!customerId}
              required
            >
              <option value="">Selecciona un punto de entrega…</option>
              {deliveryPointsQuery.data?.items.map((dp) => (
                <option key={dp.id} value={dp.id}>
                  {dp.label ?? dp.address} {dp.city ? `(${dp.city})` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>

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
          <Field label="Prioridad">
            <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as any)}>
              <option value="standard">Estándar</option>
              <option value="urgent">Urgente</option>
            </select>
          </Field>
          <Field label="Tipo de servicio">
            <select className={inputCls} value={serviceType} onChange={(e) => setServiceType(e.target.value as any)}>
              {serviceTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Observaciones" hint="Instrucciones de entrega en texto libre, ej. horario límite">
          <textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-slate-700">Líneas de pedido</p>
            <button type="button" onClick={addLine} className="text-xs text-brand-600 font-medium hover:text-brand-700">
              + Añadir línea
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <select
                  className={`${inputCls} col-span-6`}
                  value={line.productId}
                  onChange={(e) => updateLine(idx, { productId: e.target.value })}
                >
                  <option value="">Producto…</option>
                  {productsQuery.data?.items.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.description}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className={`${inputCls} col-span-3`}
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                  placeholder="Cantidad"
                />
                <select
                  className={`${inputCls} col-span-2`}
                  value={line.unit}
                  onChange={(e) => updateLine(idx, { unit: e.target.value })}
                >
                  <option value="UD">UD</option>
                  <option value="PAL">PAL</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  disabled={lines.length === 1}
                  className="col-span-1 text-slate-400 hover:text-red-500 disabled:opacity-30 text-sm"
                >
                  ✕
                </button>
              </div>
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
            {mutation.isPending ? "Creando…" : "Crear pedido"}
          </button>
        </div>
      </form>
    </Modal>
  );
}