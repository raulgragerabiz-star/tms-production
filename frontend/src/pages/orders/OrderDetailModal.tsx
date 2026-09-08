import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Modal from "@/components/Modal";

interface PodDetail {
  signatureUrl: string | null;
  photoUrls: string[] | null;
  receivedByName: string | null;
  deliveredAt: string;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  status: string;
  requestedDeliveryDate: string;
  customer: { businessCode: string; legalName: string };
  deliveryPoint: { address: string; city: string | null };
  warehouse: { name: string };
  lines: { quantity: number; unit: string; product: { sku: string; description: string } }[];
  routeStops: { id: string; pod: PodDetail | null }[];
}

interface OrderDetailModalProps {
  orderId: string | null;
  onClose: () => void;
}

export default function OrderDetailModal({ orderId, onClose }: OrderDetailModalProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["order-detail", orderId],
    queryFn: async () => (await api.get(`/orders/${orderId}`)).data as OrderDetail,
    enabled: !!orderId,
  });

  const pod = data?.routeStops.find((s) => s.pod)?.pod ?? null;

  return (
    <Modal open={!!orderId} title={data ? `Pedido ${data.orderNumber}` : "Pedido"} onClose={onClose} wide>
      {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}

      {data && (
        <div className="space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-800 font-medium">
                {data.customer.businessCode} — {data.customer.legalName}
              </p>
              <p className="text-xs text-slate-500">
                {data.deliveryPoint.address}
                {data.deliveryPoint.city ? `, ${data.deliveryPoint.city}` : ""} · {data.warehouse.name}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Fecha comprometida: {new Date(data.requestedDeliveryDate).toLocaleDateString("es-ES")}
              </p>
            </div>
            <StatusBadge status={data.status} />
          </div>

          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Líneas</h3>
            <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg">
              {data.lines.map((l, i) => (
                <li key={i} className="px-3 py-2 flex justify-between text-sm">
                  <span className="text-slate-700">
                    {l.product.sku} — {l.product.description}
                  </span>
                  <span className="text-slate-500">
                    {l.quantity} {l.unit}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {data.status === "delivered" && (
            <div>
              <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Justificante de entrega</h3>

              {!pod && (
                <p className="text-sm text-slate-500">Todavía no hay justificante disponible para este pedido.</p>
              )}

              {pod && (
                <div className="space-y-3">
                  <p className="text-sm text-slate-600">
                    Entregado el {new Date(pod.deliveredAt).toLocaleString("es-ES")}
                    {pod.receivedByName ? ` · Recibido por ${pod.receivedByName}` : ""}
                  </p>

                  {pod.signatureUrl && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Firma</p>
                      <img
                        src={pod.signatureUrl}
                        alt="Firma de quien recibió el pedido"
                        className="w-full max-w-sm border border-slate-200 rounded-md bg-slate-50"
                      />
                      <a href={pod.signatureUrl} download={`firma-${data.orderNumber}.png`} className="inline-block mt-2 text-sm text-blue-700 font-medium underline">
                        Descargar firma
                      </a>
                    </div>
                  )}

                  {pod.photoUrls && pod.photoUrls.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Fotos de la entrega</p>
                      <div className="grid grid-cols-3 gap-2">
                        {pod.photoUrls.map((url, idx) => (
                          <a key={idx} href={url} download={`foto-${data.orderNumber}-${idx + 1}.jpg`}>
                            <img
                              src={url}
                              alt={`Foto de entrega ${idx + 1}`}
                              className="w-full aspect-square object-cover rounded-md border border-slate-200"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}