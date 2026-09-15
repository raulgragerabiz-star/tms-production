import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import StatusBadge from "@/components/StatusBadge";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import { useAuthStore } from "@/store/auth-store";

// Fase 8V: mejora explícita de Raúl -- "establecer bien las facturaciones
// asociadas con los transportistas en cuanto a gasto y facturacion en
// empresa". Alcance acordado: SOLO el gasto de transportistas (esta
// pantalla), sin tocar la facturación a clientes (CustomerInvoice sigue sin
// usarse). Se añaden filtros, detalle por línea (envío/ruta/cliente detrás
// de cada importe) y el ciclo de disputa a nivel de línea que ya estaba
// escrito pero nunca activado (ver settlement-dispute.routes.ts en
// _deferred_v1.1_delta) -- aquí lo inicia y resuelve backoffice, porque el
// portal transportista (apps/carrier-portal) no está en producción.
interface SettlementLineRow {
  id: string;
  status: "accepted" | "disputed";
  amount: string;
}

interface SettlementRow {
  id: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  totalAmount: string;
  carrier: { legalName: string };
  lines: SettlementLineRow[];
}

interface SettlementLineDetail extends SettlementLineRow {
  disputeComment: string | null;
  disputedAt: string | null;
  disputedBy: string | null;
  shipment: {
    id: string;
    departedAt: string | null;
    finishedAt: string | null;
    vehicle: { plate: string } | null;
    driver: { fullName: string } | null;
    route: {
      routeDate: string;
      stops: { order: { orderNumber: string; customer: { legalName: string }; deliveryPoint: { city: string | null; province: string | null } } }[];
    };
  };
}

interface SettlementDetail extends SettlementRow {
  lines: SettlementLineDetail[];
}

interface CarrierOption {
  id: string;
  legalName: string;
}

// Fase 8W: informe agregado de gasto por transportista/centro/circuito
// ("ruta")/cliente -- ver GET /billing/expense-report.
interface ExpenseReportBucket {
  id: string;
  legalName?: string;
  name?: string;
  amount: number;
}

interface ExpenseReport {
  totals: { totalAmount: number; lineCount: number; equalSplitLineCount: number };
  byCarrier: ExpenseReportBucket[];
  byWarehouse: ExpenseReportBucket[];
  byDeliveryZone: ExpenseReportBucket[];
  byCustomer: ExpenseReportBucket[];
}

const STATUS_OPTIONS = [
  { value: "draft", label: "Generada" },
  { value: "validated", label: "Validada" },
  { value: "approved", label: "Aprobada" },
  { value: "paid", label: "Pagada" },
  { value: "disputed", label: "Disputada" },
];

// Transiciones permitidas desde cada estado -- mismo ciclo ya definido en el
// backend (draft -> validated -> approved -> paid, con posibilidad de caer a
// disputed desde cualquier punto por una línea individual).
const NEXT_STATUS: Record<string, string | null> = {
  draft: "validated",
  validated: "approved",
  approved: "paid",
  paid: null,
  disputed: "validated",
};

function summarize(stops: SettlementLineDetail["shipment"]["route"]["stops"]) {
  const customers = [...new Set(stops.map((s) => s.order.customer.legalName))];
  const orderNumbers = stops.map((s) => s.order.orderNumber);
  return { customers, orderNumbers };
}

export default function BillingPage() {
  // Fase 8Y: petición de Raúl -- "la facturacion debe ser presentada en
  // varios bloques. Ruta, almacen origen, transportista, cliente", que es
  // exactamente el informe de gasto de la Fase 8W (byDeliveryZone/
  // byWarehouse/byCarrier/byCustomer, ver ExpenseReportView más abajo). Ya
  // existía, pero como pestaña secundaria detrás de "Liquidaciones" -- con
  // esta casi siempre vacía (ver botón "Generar liquidación" más arriba),
  // nunca se llegaba a ver. Ahora es la vista por defecto al entrar.
  const [view, setView] = useState<"liquidaciones" | "informe">("informe");
  const [carrierId, setCarrierId] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Fase 8Y: generación de liquidaciones -- corrección de Raúl ("no devuelve
  // correctamente datos de facturacion"). POST /billing/settlements existía
  // en el backend desde la Fase 8V/8W pero no había NINGÚN botón en esta
  // pantalla que lo llamara -- así que, aunque hubiera envíos finalizados sin
  // liquidar, la lista de Liquidaciones estaba condenada a salir siempre
  // vacía ("Sin liquidaciones para estos filtros") por mucho gasto real que
  // hubiera detrás. Formulario mínimo: transportista + periodo, igual que
  // pide el endpoint.
  const [showGenerate, setShowGenerate] = useState(false);
  const [genCarrierId, setGenCarrierId] = useState("");
  const [genFrom, setGenFrom] = useState("");
  const [genTo, setGenTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [disputeTarget, setDisputeTarget] = useState<{ lineId: string } | null>(null);
  const [resolveTarget, setResolveTarget] = useState<SettlementLineDetail | null>(null);
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();
  // Fase 10: petición explícita de Raúl -- "en el caso de liquidaciones
  // transportista no se puede eliminar una que se introduce", corrigiendo esa
  // laguna con el mismo patrón ya usado en Pedidos/Productos (botón
  // solo visible para admin_empresa/admin_plataforma + confirmación).
  const user = useAuthStore((s) => s.user);
  const canDeleteSettlements = user?.roles?.some((r) => r === "admin_empresa" || r === "admin_plataforma") ?? false;

  const carriersQuery = useQuery({
    queryKey: ["carriers"],
    queryFn: async () => (await api.get("/carriers")).data as { items: CarrierOption[] },
  });

  const params: Record<string, string> = {};
  if (carrierId) params.carrierId = carrierId;
  if (status) params.status = status;
  if (from) params.from = from;
  if (to) params.to = to;

  const { data, isLoading } = useQuery({
    queryKey: ["settlements", carrierId, status, from, to],
    queryFn: async () => (await api.get("/billing/settlements", { params })).data as { items: SettlementRow[]; total: number },
    enabled: view === "liquidaciones",
  });

  // Fase 8W: informe agregado -- mismos filtros de transportista/periodo,
  // sin el de estado (el gasto ya generado no depende del estado de cobro).
  const expenseReportParams: Record<string, string> = {};
  if (carrierId) expenseReportParams.carrierId = carrierId;
  if (from) expenseReportParams.from = from;
  if (to) expenseReportParams.to = to;

  const expenseReportQuery = useQuery({
    queryKey: ["billing-expense-report", carrierId, from, to],
    queryFn: async () => (await api.get("/billing/expense-report", { params: expenseReportParams })).data as ExpenseReport,
    enabled: view === "informe",
  });

  const detailQuery = useQuery({
    queryKey: ["settlement-detail", expandedId],
    queryFn: async () => (await api.get(`/billing/settlements/${expandedId}`)).data as SettlementDetail,
    enabled: !!expandedId,
  });

  const statusMutation = useMutation({
    mutationFn: async (payload: { id: string; status: string }) =>
      api.patch(`/billing/settlements/${payload.id}/status`, { status: payload.status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      showSuccess("Estado de la liquidación actualizado");
    },
    onError: () => showError("No se ha podido actualizar el estado"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/billing/settlements/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      showSuccess("Liquidación eliminada");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se ha podido eliminar la liquidación"),
  });

  function handleDeleteSettlement(s: SettlementRow) {
    if (
      !window.confirm(
        `¿Eliminar la liquidación de "${s.carrier.legalName}" (${s.lines.length} línea(s), ${Number(s.totalAmount).toFixed(2)} €)?\n\nEsta acción no se puede deshacer -- se borrarán también todas sus líneas.`
      )
    ) {
      return;
    }
    deleteMutation.mutate(s.id);
  }

  const disputeMutation = useMutation({
    mutationFn: async (payload: { lineId: string; comment: string }) =>
      api.patch(`/billing/settlement-lines/${payload.lineId}/dispute`, { comment: payload.comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["settlement-detail", expandedId] });
      setDisputeTarget(null);
      showSuccess("Línea marcada como disputada");
    },
    onError: () => showError("No se ha podido disputar la línea"),
  });

  const resolveMutation = useMutation({
    mutationFn: async (payload: { lineId: string; resolution: "accept_original" | "adjust_amount"; newAmount?: number; resolutionComment: string }) =>
      api.patch(`/billing/settlement-lines/${payload.lineId}/resolve-dispute`, {
        resolution: payload.resolution,
        newAmount: payload.newAmount,
        resolutionComment: payload.resolutionComment,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      queryClient.invalidateQueries({ queryKey: ["settlement-detail", expandedId] });
      setResolveTarget(null);
      showSuccess("Disputa resuelta");
    },
    onError: () => showError("No se ha podido resolver la disputa"),
  });

  // Fase 8Y: genera la liquidación (envíos "finished" del transportista y
  // periodo elegidos, sin liquidar todavía) -- ver comentario junto al
  // estado `showGenerate` más arriba.
  const generateMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post("/billing/settlements", { carrierId: genCarrierId, periodFrom: genFrom, periodTo: genTo })
      ).data as { settlement: SettlementRow; exceptions: string[]; lineCount: number },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      setShowGenerate(false);
      const lineCount = result.lineCount;
      if (lineCount === 0 && result.exceptions.length === 0) {
        showSuccess(
          "Liquidación generada, pero sin envíos que liquidar: no hay ningún envío finalizado de ese transportista en ese periodo que no estuviera ya liquidado."
        );
      } else if (result.exceptions.length > 0) {
        showSuccess(
          `Liquidación generada con ${lineCount} línea(s) — ${result.exceptions.length} envío(s) sin tarifa vigente, quedan pendientes de revisar a mano.`
        );
      } else {
        showSuccess(`Liquidación generada con ${lineCount} línea(s)`);
      }
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo generar la liquidación"),
  });

  return (
    <div>
      <h1 className="text-xl font-semibold text-slate-900 mb-1">Facturación / Liquidaciones</h1>
      <p className="text-sm text-slate-500 mb-4">
        Gasto por transportista y periodo, calculado siempre contra la tarifa vigente en la fecha real del viaje.
        Despliega una liquidación para ver el detalle por envío y disputar una línea si el importe no cuadra.
      </p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setView("informe")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "informe" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"
          }`}
        >
          Informe de gasto (por ruta / almacén / transportista / cliente)
        </button>
        <button
          onClick={() => setView("liquidaciones")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
            view === "liquidaciones" ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"
          }`}
        >
          Liquidaciones
        </button>
        {view === "liquidaciones" && (
          <button
            onClick={() => setShowGenerate((v) => !v)}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 hover:bg-slate-900 text-white"
          >
            + Generar liquidación
          </button>
        )}
      </div>

      {/* Fase 8Y: ver comentario junto al estado `showGenerate` -- sin esto no
          había forma de crear una liquidación desde la pantalla. */}
      {view === "liquidaciones" && showGenerate && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-4">
          <p className="text-sm font-semibold text-slate-700 mb-2">Generar liquidación</p>
          <p className="text-xs text-slate-500 mb-3">
            Crea una liquidación con todos los envíos finalizados del transportista elegido dentro del periodo, que
            todavía no tuvieran liquidación. Se puede generar tantas veces como haga falta — nunca duplica un envío ya
            liquidado.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Transportista</label>
              <select
                value={genCarrierId}
                onChange={(e) => setGenCarrierId(e.target.value)}
                className="rounded-lg border border-slate-300 text-sm px-3 py-2"
              >
                <option value="">Selecciona…</option>
                {carriersQuery.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.legalName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desde</label>
              <input type="date" value={genFrom} onChange={(e) => setGenFrom(e.target.value)} className="rounded-lg border border-slate-300 text-sm px-3 py-2" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Hasta</label>
              <input type="date" value={genTo} onChange={(e) => setGenTo(e.target.value)} className="rounded-lg border border-slate-300 text-sm px-3 py-2" />
            </div>
            <button
              onClick={() => generateMutation.mutate()}
              disabled={!genCarrierId || !genFrom || !genTo || generateMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {generateMutation.isPending ? "Generando…" : "Generar"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select
          value={carrierId}
          onChange={(e) => setCarrierId(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2"
        >
          <option value="">Todos los transportistas</option>
          {carriersQuery.data?.items.map((c) => (
            <option key={c.id} value={c.id}>
              {c.legalName}
            </option>
          ))}
        </select>
        {view === "liquidaciones" && (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-300 text-sm px-3 py-2"
          >
            <option value="">Todos los estados</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2"
        />
        <span className="text-sm text-slate-400">—</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="rounded-lg border border-slate-300 text-sm px-3 py-2"
        />
        {(carrierId || status || from || to) && (
          <button
            onClick={() => {
              setCarrierId("");
              setStatus("");
              setFrom("");
              setTo("");
            }}
            className="text-sm text-slate-500 underline"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {view === "informe" && (
        <ExpenseReportView data={expenseReportQuery.data} isLoading={expenseReportQuery.isLoading} />
      )}

      {view === "liquidaciones" && (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-3">Transportista</th>
              <th className="text-left px-4 py-3">Periodo</th>
              <th className="text-right px-4 py-3">Líneas</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-left px-4 py-3">Estado</th>
              <th className="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Cargando…</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">Sin liquidaciones para estos filtros.</td>
              </tr>
            )}
            {data?.items.map((s) => {
              const disputedCount = s.lines.filter((l) => l.status === "disputed").length;
              const next = NEXT_STATUS[s.status];
              const isExpanded = expandedId === s.id;
              return (
                <Fragment key={s.id}>
                  <tr
                    className="hover:bg-brand-50/60 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : s.id)}
                  >
                    <td className="px-4 py-3">{s.carrier.legalName}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(s.periodFrom).toLocaleDateString("es-ES")} — {new Date(s.periodTo).toLocaleDateString("es-ES")}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-600">
                      {s.lines.length}
                      {disputedCount > 0 && (
                        <span className="ml-1.5 text-[0.68rem] font-bold text-red-600">({disputedCount} disp.)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-slate-800">{Number(s.totalAmount).toFixed(2)} €</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {next && (
                        <button
                          onClick={() => statusMutation.mutate({ id: s.id, status: next })}
                          disabled={statusMutation.isPending}
                          className="text-teal-600 hover:text-teal-700 text-xs font-medium mr-3 disabled:opacity-50"
                        >
                          Pasar a {STATUS_OPTIONS.find((o) => o.value === next)?.label.toLowerCase()}
                        </button>
                      )}
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}
                        className="text-slate-500 hover:text-slate-700 text-xs font-medium"
                      >
                        {isExpanded ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                      {canDeleteSettlements && (
                        <button
                          onClick={() => handleDeleteSettlement(s)}
                          disabled={deleteMutation.isPending}
                          className="text-red-500 hover:text-red-600 text-xs font-medium ml-3 disabled:opacity-50"
                        >
                          Eliminar
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} className="bg-slate-50 px-4 py-4">
                        {detailQuery.isLoading && <p className="text-sm text-slate-400">Cargando detalle…</p>}
                        {detailQuery.data && detailQuery.data.id === s.id && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs bg-white rounded-lg border border-slate-200">
                              <thead className="bg-slate-100 text-slate-500 font-semibold uppercase tracking-wide">
                                <tr>
                                  <th className="text-left px-3 py-2">Fecha</th>
                                  <th className="text-left px-3 py-2">Pedido(s)</th>
                                  <th className="text-left px-3 py-2">Cliente(s)</th>
                                  <th className="text-left px-3 py-2">Vehículo / Conductor</th>
                                  <th className="text-right px-3 py-2">Importe</th>
                                  <th className="text-left px-3 py-2">Estado</th>
                                  <th className="text-right px-3 py-2">Acciones</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {detailQuery.data.lines.map((line) => {
                                  const { customers, orderNumbers } = summarize(line.shipment.route.stops);
                                  return (
                                    <tr key={line.id} className="align-top">
                                      <td className="px-3 py-2 font-mono text-slate-600 whitespace-nowrap">
                                        {new Date(line.shipment.route.routeDate).toLocaleDateString("es-ES")}
                                      </td>
                                      <td className="px-3 py-2 text-slate-700 max-w-[160px]">{orderNumbers.join(", ")}</td>
                                      <td className="px-3 py-2 text-slate-700 max-w-[180px]">{customers.join(", ")}</td>
                                      <td className="px-3 py-2 text-slate-500">
                                        {line.shipment.vehicle?.plate ?? "—"}
                                        {line.shipment.driver && <span className="block text-slate-400">{line.shipment.driver.fullName}</span>}
                                      </td>
                                      <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">
                                        {Number(line.amount).toFixed(2)} €
                                      </td>
                                      <td className="px-3 py-2">
                                        {line.status === "disputed" ? (
                                          <div>
                                            <span className="inline-block px-2 py-0.5 rounded font-mono text-[0.65rem] font-bold uppercase bg-red-100 text-red-700">
                                              Disputada
                                            </span>
                                            {line.disputeComment && (
                                              <p className="text-slate-500 mt-1 max-w-[220px]">{line.disputeComment}</p>
                                            )}
                                          </div>
                                        ) : (
                                          <span className="inline-block px-2 py-0.5 rounded font-mono text-[0.65rem] font-bold uppercase bg-emerald-100 text-emerald-700">
                                            Aceptada
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {line.status === "disputed" ? (
                                          <button
                                            onClick={() => setResolveTarget(line)}
                                            className="text-teal-600 hover:text-teal-700 font-medium"
                                          >
                                            Resolver
                                          </button>
                                        ) : (
                                          <button
                                            onClick={() => setDisputeTarget({ lineId: line.id })}
                                            className="text-slate-500 hover:text-slate-700 font-medium underline"
                                          >
                                            Disputar
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {disputeTarget && (
        <DisputeModal
          onClose={() => setDisputeTarget(null)}
          onConfirm={(comment) => disputeMutation.mutate({ lineId: disputeTarget.lineId, comment })}
          loading={disputeMutation.isPending}
        />
      )}

      {resolveTarget && (
        <ResolveDisputeModal
          line={resolveTarget}
          onClose={() => setResolveTarget(null)}
          onConfirm={(payload) => resolveMutation.mutate({ lineId: resolveTarget.id, ...payload })}
          loading={resolveMutation.isPending}
        />
      )}

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}

function DisputeModal({
  onClose,
  onConfirm,
  loading,
}: {
  onClose: () => void;
  onConfirm: (comment: string) => void;
  loading: boolean;
}) {
  const [comment, setComment] = useState("");
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Disputar línea de liquidación</h3>
        <p className="text-xs text-slate-500 mb-4">
          Explica por qué el importe no es correcto. La liquidación completa pasará a estado "Disputada" hasta que
          se resuelva.
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          placeholder="Motivo de la disputa (mín. 5 caracteres)…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm text-slate-500 px-3 py-1.5">
            Cancelar
          </button>
          <button
            disabled={comment.trim().length < 5 || loading}
            onClick={() => onConfirm(comment.trim())}
            className="rounded-md bg-red-600 hover:bg-red-700 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Enviando…" : "Confirmar disputa"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolveDisputeModal({
  line,
  onClose,
  onConfirm,
  loading,
}: {
  line: SettlementLineDetail;
  onClose: () => void;
  onConfirm: (payload: { resolution: "accept_original" | "adjust_amount"; newAmount?: number; resolutionComment: string }) => void;
  loading: boolean;
}) {
  const [resolution, setResolution] = useState<"accept_original" | "adjust_amount">("accept_original");
  const [newAmount, setNewAmount] = useState(line.amount);
  const [resolutionComment, setResolutionComment] = useState("");

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-slate-900 mb-1">Resolver disputa</h3>
        {line.disputeComment && (
          <p className="text-xs text-slate-500 mb-4 bg-slate-50 rounded-md px-3 py-2">
            <span className="font-semibold">Motivo:</span> {line.disputeComment}
          </p>
        )}
        <div className="space-y-2 mb-3">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={resolution === "accept_original"}
              onChange={() => setResolution("accept_original")}
            />
            Mantener el importe original ({Number(line.amount).toFixed(2)} €)
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="radio"
              checked={resolution === "adjust_amount"}
              onChange={() => setResolution("adjust_amount")}
            />
            Ajustar el importe
          </label>
          {resolution === "adjust_amount" && (
            <input
              type="number"
              step="0.01"
              min="0"
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          )}
        </div>
        <textarea
          value={resolutionComment}
          onChange={(e) => setResolutionComment(e.target.value)}
          rows={3}
          placeholder="Comentario de la resolución (mín. 5 caracteres)…"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="text-sm text-slate-500 px-3 py-1.5">
            Cancelar
          </button>
          <button
            disabled={
              resolutionComment.trim().length < 5 ||
              (resolution === "adjust_amount" && !(Number(newAmount) > 0)) ||
              loading
            }
            onClick={() =>
              onConfirm({
                resolution,
                newAmount: resolution === "adjust_amount" ? Number(newAmount) : undefined,
                resolutionComment: resolutionComment.trim(),
              })
            }
            className="rounded-md bg-teal-600 hover:bg-teal-700 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Confirmar resolución"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Fase 8W: informe agregado -- una lista de barras horizontales por
// dimensión (transportista/centro/circuito ("ruta")/cliente), mismo criterio
// que "Top zonas por volumen" de Analítica (magnitud = un único tono, barra
// proporcional al máximo de esa misma lista, etiqueta directa con el
// importe). Top 12 por panel para que quepa sin desbordar -- el resto sigue
// contando en el total, solo no se lista fila a fila.
function ExpenseReportView({ data, isLoading }: { data: ExpenseReport | undefined; isLoading: boolean }) {
  if (isLoading) {
    return <p className="text-sm text-slate-400 py-6 text-center">Cargando informe…</p>;
  }
  if (!data || data.totals.lineCount === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 px-4 py-6 text-center text-slate-400 text-sm">
        Sin liquidaciones para estos filtros.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Gasto total</p>
          <p className="font-mono text-xl font-semibold text-slate-800">{data.totals.totalAmount.toFixed(2)} €</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Liquidaciones</p>
          <p className="font-mono text-xl font-semibold text-slate-800">{data.totals.lineCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Repartidas a partes iguales</p>
          <p className="font-mono text-xl font-semibold text-slate-800">{data.totals.equalSplitLineCount}</p>
          {data.totals.equalSplitLineCount > 0 && (
            <p className="text-[11px] text-slate-400 mt-0.5">
              Sin peso conocido en todas las paradas de esa ruta -- repartidas a partes iguales entre clientes.
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ExpenseReportPanel title="Por transportista" rows={data.byCarrier} />
        <ExpenseReportPanel title="Por centro (almacén de origen)" rows={data.byWarehouse} />
        <ExpenseReportPanel title="Por ruta (circuito de reparto)" rows={data.byDeliveryZone} />
        <ExpenseReportPanel title="Por cliente" rows={data.byCustomer} />
      </div>
    </div>
  );
}

function ExpenseReportPanel({ title, rows }: { title: string; rows: ExpenseReportBucket[] }) {
  const top = rows.slice(0, 12);
  const max = top.reduce((m, r) => Math.max(m, r.amount), 0) || 1;
  const restAmount = rows.slice(12).reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800 mb-3">{title}</h3>
      {top.length === 0 && <p className="text-sm text-slate-400">Sin datos.</p>}
      <div className="space-y-2">
        {top.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <span className="text-xs text-slate-600 w-32 truncate flex-shrink-0" title={row.legalName ?? row.name}>
              {row.legalName ?? row.name}
            </span>
            <div className="flex-1 bg-slate-100 rounded h-4 relative overflow-hidden">
              <div
                className="bg-brand-500 h-full rounded"
                style={{ width: `${Math.max((row.amount / max) * 100, 2)}%` }}
              />
            </div>
            <span className="text-xs font-mono font-semibold text-slate-700 w-20 text-right flex-shrink-0">
              {row.amount.toFixed(0)} €
            </span>
          </div>
        ))}
        {rows.length > 12 && (
          <p className="text-[11px] text-slate-400 pt-1">
            + {rows.length - 12} más ({restAmount.toFixed(0)} €)
          </p>
        )}
      </div>
    </div>
  );
}
