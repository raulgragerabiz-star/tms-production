// Nuevo: apps/backoffice/src/components/planner/CandidatesModal.tsx
//
// Cierra el issue que quedó abierto en la sesión anterior: el backend ya
// expone POST /optimization/:routeId/select/:costSimulationId, pero no
// existía UI para mostrar las cost_simulation generadas por el motor
// (Fase 8) y dejar que el planificador elija — las rutas quedaban
// atascadas en `optimized` sin botón accionable.
//
// Reutiliza el patrón ya fijado en el diseño UX (Fase 5, Pantalla 8):
// tabla ordenada de más barato a más caro, opción más barata resaltada
// pero todas visibles (transparencia de decisión, no caja negra).
// Incorpora ya la segmentación v1.1: cada candidato muestra el segmento
// del pedido y se descarta en el propio backend si el vehicleType no es
// compatible (isVehicleTypeCompatibleWithSegment ya aplicado server-side
// en la capa de generación de candidatos).

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { useState } from "react";

interface CostSimulation {
  id: string;
  carrierId: string;
  carrierName: string;
  vehicleTypeId: string;
  vehicleTypeName: string;
  estimatedCost: number;
  currency: string;
  costBreakdown: {
    baseAmount?: number;
    extraKmAmount: number;
    extraStopAmount?: number;
    surcharges?: { type: string; amount: number }[];
  };
  occupancy: { weightPct: number; palletsPct: number };
  isSelected: boolean;
}

interface RouteSummary {
  id: string;
  segment: "paqueteria" | "paleteria" | "paleteria_pesada" | "gran_volumen";
  serviceType: string;
  routeDate: string;
  stopsCount: number;
  autoAssigned?: boolean;
  confidence?: number | null;
}

const SEGMENT_LABEL: Record<string, string> = {
  paqueteria: "Paquetería",
  paleteria: "Paletería",
  paleteria_pesada: "Paletería pesada",
  gran_volumen: "Gran volumen / camión completo",
};

interface CandidatesModalProps {
  routeId: string;
  open: boolean;
  onClose: () => void;
}

export default function CandidatesModal({ routeId, open, onClose }: CandidatesModalProps) {
  const queryClient = useQueryClient();
  const [selecting, setSelecting] = useState<string | null>(null);

  const { data: route } = useQuery({
    queryKey: ["route-summary", routeId],
    queryFn: async () => (await apiClient.get<RouteSummary>(`/routes/${routeId}`)).data,
    enabled: open,
  });

  const { data: candidates, isLoading } = useQuery({
    queryKey: ["cost-simulations", routeId],
    queryFn: async () =>
      (await apiClient.get<CostSimulation[]>(`/optimization/${routeId}/simulations`)).data,
    enabled: open,
  });

  const selectMutation = useMutation({
    mutationFn: async (costSimulationId: string) => {
      setSelecting(costSimulationId);
      return apiClient.post(`/optimization/${routeId}/select/${costSimulationId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["planner-routes"] });
      queryClient.invalidateQueries({ queryKey: ["cost-simulations", routeId] });
      onClose();
    },
    onSettled: () => setSelecting(null),
  });

  if (!open) return null;

  const cheapest = candidates && candidates.length > 0
    ? [...candidates].sort((a, b) => a.estimatedCost - b.estimatedCost)[0].id
    : null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Comparar transportistas</h2>
            {route && (
              <p className="text-sm text-slate-500">
                {route.stopsCount} paradas ·{" "}
                <span className="inline-block px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
                  {SEGMENT_LABEL[route.segment] ?? route.segment}
                </span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
            ✕
          </button>
        </div>

        <div className="p-6">
          {route?.autoAssigned && (
            <div className="mb-4 rounded-md bg-blue-50 border border-blue-200 px-3 py-2 text-xs text-blue-700">
              Esta ruta fue asignada automáticamente (confianza{" "}
              {route.confidence != null ? `${(route.confidence * 100).toFixed(0)}%` : "—"}). Puedes
              reasignarla manualmente si lo prefieres.
            </div>
          )}

          {isLoading && <p className="text-sm text-slate-500">Calculando candidatos...</p>}

          {!isLoading && candidates?.length === 0 && (
            <p className="text-sm text-slate-500">
              No hay transportistas/vehículos compatibles con el segmento{" "}
              <strong>{route ? SEGMENT_LABEL[route.segment] : ""}</strong> y la ocupación de
              esta ruta. Revisa `vehicle_type.compatible_segments` o divide la ruta.
            </p>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b">
                <th className="py-2">Transportista</th>
                <th className="py-2">Vehículo</th>
                <th className="py-2">Ocupación</th>
                <th className="py-2 text-right">Coste estimado</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {candidates?.map((c) => (
                <tr
                  key={c.id}
                  className={`border-b last:border-0 ${
                    c.id === cheapest ? "bg-green-50" : ""
                  }`}
                >
                  <td className="py-3 font-medium text-slate-800">{c.carrierName}</td>
                  <td className="py-3 text-slate-600">{c.vehicleTypeName}</td>
                  <td className="py-3 text-slate-600">
                    {Math.round(c.occupancy.weightPct)}% peso ·{" "}
                    {Math.round(c.occupancy.palletsPct)}% palés
                  </td>
                  <td className="py-3 text-right font-semibold text-slate-800">
                    {c.estimatedCost.toFixed(2)} {c.currency}
                    {c.id === cheapest && (
                      <span className="ml-2 text-xs font-normal text-green-700">
                        más barato
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    <button
                      disabled={selecting === c.id || c.isSelected}
                      onClick={() => selectMutation.mutate(c.id)}
                      className="rounded-md bg-slate-900 text-white px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                    >
                      {c.isSelected ? "Asignado" : selecting === c.id ? "Asignando..." : "Asignar"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
