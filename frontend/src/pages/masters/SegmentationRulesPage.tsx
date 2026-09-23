import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";

// Fase 28: pantalla de Backoffice para `ServiceSegmentationRule` -- petición
// de Raúl ("incorpora a la app la segmentacion por categoria de pedido...
// con los calculos de asignacion a categoria segun peso de producto"). El
// motor que aplica estas reglas (segmentation.service.ts) ya existía desde
// antes, pero no había ninguna pantalla para darlas de alta: sin filas
// activas, todo pedido caía siempre en el segmento de reserva ("Pesado").
//
// Los 4 segmentos son fijos (uno por valor del enum ServiceType, ver
// segmentation.routes.ts) -- esta pantalla no permite añadir ni borrar
// filas, solo editar el umbral de peso de cada uno. Las etiquetas visibles
// (Paquetería/Paletería/Ligero/Pesado) son el vocabulario real de Raúl; los
// valores técnicos que viajan a la API (paqueteria/paleteria/
// paleteria_pesada/gran_volumen) no cambian -- ver el mismo criterio en
// RatesPage.tsx.
const SEGMENT_LABELS: Record<string, string> = {
  paqueteria: "Paquetería",
  paleteria: "Paletería",
  paleteria_pesada: "Ligero",
  gran_volumen: "Pesado",
};

const SEGMENT_HINTS: Record<string, string> = {
  paqueteria: "Envíos pequeños que caben en furgoneta.",
  paleteria: "Palés sueltos, reparto compartido con otros clientes.",
  paleteria_pesada: "Varios palés -- vehículo con plataforma elevadora/trampilla.",
  gran_volumen: "Carga que ocupa el vehículo casi en exclusiva -- tráiler/camión completo. Sin límite superior.",
};

interface RuleRow {
  segment: string;
  maxWeightKg: number | null;
  maxPallets: number | null;
  maxWeightPerPalletKg: number | null;
  priority: number;
  active: boolean;
  persisted: boolean;
}

const cellCls = "w-32 rounded-md border border-slate-300 px-2 py-1.5 text-sm";

export default function SegmentationRulesPage() {
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();

  const rulesQuery = useQuery({
    queryKey: ["segmentation-rules"],
    queryFn: async () => (await api.get("/segmentation/rules")).data as { items: RuleRow[] },
  });

  const saveMutation = useMutation({
    mutationFn: async (payload: {
      segment: string;
      maxWeightKg: number | null;
      maxPallets: number | null;
      active: boolean;
    }) => {
      const { segment, ...rest } = payload;
      return (await api.put(`/segmentation/rules/${segment}`, rest)).data as RuleRow;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["segmentation-rules"], (prev: { items: RuleRow[] } | undefined) =>
        prev ? { items: prev.items.map((r) => (r.segment === updated.segment ? updated : r)) } : prev
      );
      showSuccess("Regla guardada");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo guardar la regla"),
  });

  const rules = rulesQuery.data?.items ?? [];
  const hasUnsaved = rules.some((r) => !r.persisted);

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-xl font-semibold text-slate-900">Segmentación de pedidos</h1>
        <p className="text-sm text-slate-500">
          Umbral de peso total del pedido que decide su categoría (Paquetería/Paletería/Ligero/Pesado). Se aplica
          automáticamente al crear o actualizar un pedido -- la primera categoría que cumple su límite, de arriba
          abajo, es la que se asigna.
        </p>
      </div>

      {hasUnsaved && (
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg p-3 text-sm text-amber-700">
          Todavía no has guardado ninguna regla -- las filas de abajo son una propuesta inicial calculada a partir de
          tu plantilla de transporte. Revísalas y pulsa "Guardar" en cada una para activarlas.
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3">Categoría</th>
              <th className="text-left px-4 py-3">Peso máx. del pedido (kg)</th>
              <th className="text-left px-4 py-3">Palés máx. (opcional)</th>
              <th className="text-left px-4 py-3">Activa</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rulesQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                  Cargando…
                </td>
              </tr>
            )}
            {rules.map((rule) => (
              <RuleTableRow
                key={rule.segment}
                rule={rule}
                onSave={(patch) => saveMutation.mutate({ segment: rule.segment, ...patch })}
                saving={saveMutation.isPending}
              />
            ))}
          </tbody>
        </table>
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}

function RuleTableRow({
  rule,
  onSave,
  saving,
}: {
  rule: RuleRow;
  onSave: (patch: { maxWeightKg: number | null; maxPallets: number | null; active: boolean }) => void;
  saving: boolean;
}) {
  const [maxWeightKg, setMaxWeightKg] = useState(rule.maxWeightKg == null ? "" : String(rule.maxWeightKg));
  const [maxPallets, setMaxPallets] = useState(rule.maxPallets == null ? "" : String(rule.maxPallets));
  const [active, setActive] = useState(rule.active);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setMaxWeightKg(rule.maxWeightKg == null ? "" : String(rule.maxWeightKg));
    setMaxPallets(rule.maxPallets == null ? "" : String(rule.maxPallets));
    setActive(rule.active);
    setDirty(false);
  }, [rule.segment, rule.maxWeightKg, rule.maxPallets, rule.active, rule.persisted]);

  return (
    <tr className={rule.persisted ? "hover:bg-brand-50/60" : "bg-amber-50/40 hover:bg-amber-50/70"}>
      <td className="px-4 py-2">
        <div className="font-medium text-slate-800">{SEGMENT_LABELS[rule.segment] ?? rule.segment}</div>
        <div className="text-xs text-slate-400">{SEGMENT_HINTS[rule.segment]}</div>
        {!rule.persisted && <div className="text-xs text-amber-600 mt-0.5">Propuesta sin guardar</div>}
      </td>
      <td className="px-4 py-2">
        {rule.segment === "gran_volumen" ? (
          <span className="text-xs text-slate-400">Sin límite</span>
        ) : (
          <input
            type="number"
            min="0"
            step="1"
            value={maxWeightKg}
            onChange={(e) => {
              setMaxWeightKg(e.target.value);
              setDirty(true);
            }}
            className={cellCls}
          />
        )}
      </td>
      <td className="px-4 py-2">
        <input
          type="number"
          min="0"
          step="1"
          placeholder="Sin límite"
          value={maxPallets}
          onChange={(e) => {
            setMaxPallets(e.target.value);
            setDirty(true);
          }}
          className={cellCls}
        />
      </td>
      <td className="px-4 py-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => {
            setActive(e.target.checked);
            setDirty(true);
          }}
          className="rounded border-slate-300"
        />
      </td>
      <td className="px-4 py-2 text-right">
        <button
          onClick={() => {
            onSave({
              maxWeightKg: maxWeightKg === "" ? null : Number(maxWeightKg),
              maxPallets: maxPallets === "" ? null : Number(maxPallets),
              active,
            });
            setDirty(false);
          }}
          disabled={saving || (!dirty && rule.persisted)}
          className="bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded-lg"
        >
          Guardar
        </button>
      </td>
    </tr>
  );
}
