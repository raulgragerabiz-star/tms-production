import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";

// Motor de inteligencia (3/3): auto-optimización de rutas -- ver
// auto-optimization.service.ts / auto-optimization.orchestrator.ts.
// Apagado por defecto (opt-in real): cuando se activa, cada vez que se
// genera una comparativa de transportistas en el Planificador ("Comparar
// transportistas" -> POST /optimization/:routeId/simulate) el sistema
// evalúa si el mejor candidato supera el umbral de confianza configurado
// aquí y, si es así, lo asigna solo -- sin tocar vehículo ni conductor, que
// se siguen eligiendo a mano en el Planificador igual que hasta ahora.
interface AutoAssignSettings {
  autoAssignEnabled: boolean;
  autoAssignMinConfidence: string;
}

export default function CompanySettingsPage() {
  const queryClient = useQueryClient();
  const { toast, showSuccess, showError, dismiss } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [minConfidence, setMinConfidence] = useState(75);

  const { data, isLoading } = useQuery({
    queryKey: ["company-settings", "auto-assign"],
    queryFn: async () => (await api.get("/company/settings/auto-assign")).data as AutoAssignSettings,
  });

  useEffect(() => {
    if (data) {
      setEnabled(data.autoAssignEnabled);
      setMinConfidence(Math.round(Number(data.autoAssignMinConfidence) * 100));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/company/settings/auto-assign", {
          autoAssignEnabled: enabled,
          autoAssignMinConfidence: minConfidence / 100,
        })
      ).data as AutoAssignSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(["company-settings", "auto-assign"], result);
      showSuccess("Configuración guardada");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudo guardar la configuración"),
  });

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-900">Configuración</h1>
        <p className="text-sm text-slate-500">Ajustes generales de la empresa.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 max-w-2xl">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">
          Motor de inteligencia — asignación automática de transportista
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Cuando está activada, al generar la comparativa de transportistas en el Planificador ("Comparar
          transportistas") el sistema asigna automáticamente el mejor candidato si su puntuación de confianza supera
          el umbral configurado y saca ventaja clara sobre el segundo mejor — si no, la ruta queda igual que ahora,
          esperando a que se elija a mano. Nunca elige vehículo ni conductor: eso se sigue haciendo desde el
          Planificador.
        </p>

        {isLoading ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : (
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="rounded border-slate-300"
              />
              Activar asignación automática de transportista
            </label>

            <div>
              <label className="block text-sm text-slate-700 mb-1">
                Umbral mínimo de confianza: <span className="font-semibold">{minConfidence}%</span>
              </label>
              <input
                type="range"
                min={50}
                max={99}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                disabled={!enabled}
                className="w-full disabled:opacity-50"
              />
              <p className="text-xs text-slate-400 mt-1">
                Cuanto más alto, más exigente — menos rutas se asignarán solas, pero con más margen de seguridad.
              </p>
            </div>

            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {saveMutation.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        )}
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
