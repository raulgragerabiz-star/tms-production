// Copiar a apps/backoffice/src/components/settings/AutoAssignSettingsPanel.tsx
// Se monta en Configuración (Fase 5, Pantalla 13), junto a Usuarios/Roles
// y Empresa/Almacenes.

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface AutoAssignSettings {
  autoAssignEnabled: boolean;
  autoAssignMinConfidence: string; // Decimal viaja como string desde Prisma/JSON
}

export default function AutoAssignSettingsPanel() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["auto-assign-settings"],
    queryFn: async () => (await apiClient.get<AutoAssignSettings>("/company/settings/auto-assign")).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [confidence, setConfidence] = useState(0.75);

  useEffect(() => {
    if (data) {
      setEnabled(data.autoAssignEnabled);
      setConfidence(Number(data.autoAssignMinConfidence));
    }
  }, [data]);

  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.patch("/company/settings/auto-assign", {
        autoAssignEnabled: enabled,
        autoAssignMinConfidence: confidence,
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auto-assign-settings"] }),
  });

  return (
    <div className="bg-white rounded-lg shadow p-5 space-y-4 max-w-xl">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">Optimización automática</h3>
        <p className="text-xs text-slate-500 mt-1">
          Cuando está activada, el sistema asigna transportista automáticamente en rutas donde
          encuentra un candidato claramente mejor que el resto — equilibrando coste, fiabilidad de
          distancia del transportista y aprovechamiento del vehículo según el tipo de pedido (los
          pedidos urgentes priorizan fiabilidad sobre precio; el camión completo dedicado prioriza
          economía). Si no hay un candidato claramente mejor, o la confianza no alcanza el umbral,
          la ruta queda igual que hoy: pendiente de que la asignes tú desde el comparador.
        </p>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="rounded border-slate-300"
        />
        <span className="text-sm text-slate-700">Activar asignación automática</span>
      </label>

      {enabled && (
        <div>
          <label className="text-xs font-medium text-slate-500">
            Confianza mínima requerida: {(confidence * 100).toFixed(0)}%
          </label>
          <input
            type="range"
            min={0.5}
            max={0.95}
            step={0.05}
            value={confidence}
            onChange={(e) => setConfidence(Number(e.target.value))}
            className="w-full"
          />
          <p className="text-[10px] text-slate-400 mt-1">
            Más alto = más conservador (menos rutas se auto-asignan, pero con más certeza).
          </p>
        </div>
      )}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        {mutation.isPending ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}
