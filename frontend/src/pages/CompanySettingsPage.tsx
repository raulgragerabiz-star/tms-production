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

// Fase 8Q2: datos fiscales/de contacto del emisor, para la cabecera/pie de
// los documentos legales que genera el TMS (albarán de entrega y carta de
// porte -- ver document-pdf.service.ts). Sin rellenar, esos documentos
// simplemente omiten la línea correspondiente.
interface CompanyProfile {
  name: string;
  taxId: string;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  province: string | null;
  phone: string | null;
  email: string | null;
  mercantileRegistryText: string | null;
}

const profileInputCls = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm";

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

  const profileQuery = useQuery({
    queryKey: ["company-settings", "profile"],
    queryFn: async () => (await api.get("/company/settings/profile")).data as CompanyProfile,
  });
  const [profile, setProfile] = useState<Partial<CompanyProfile>>({});
  useEffect(() => {
    if (profileQuery.data) setProfile(profileQuery.data);
  }, [profileQuery.data]);

  const saveProfileMutation = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/company/settings/profile", {
          address: profile.address || undefined,
          postalCode: profile.postalCode || undefined,
          city: profile.city || undefined,
          province: profile.province || undefined,
          phone: profile.phone || undefined,
          email: profile.email || "",
          mercantileRegistryText: profile.mercantileRegistryText || undefined,
        })
      ).data as CompanyProfile,
    onSuccess: (result) => {
      queryClient.setQueryData(["company-settings", "profile"], result);
      showSuccess("Datos de la empresa guardados");
    },
    onError: (err: any) => showError(err?.response?.data?.message ?? "No se pudieron guardar los datos"),
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

      <div className="bg-white rounded-xl border border-slate-200 p-5 max-w-2xl mt-6">
        <h2 className="text-sm font-semibold text-slate-800 mb-1">Datos de la empresa (documentos)</h2>
        <p className="text-sm text-slate-500 mb-4">
          Se imprimen en la cabecera y el pie del albarán de entrega y de la carta de porte que genera el TMS (Ficha
          del pedido y Planificador → Gestionar ruta). El nombre y el CIF ({profileQuery.data?.name} /{" "}
          {profileQuery.data?.taxId}) no se editan aquí.
        </p>

        {profileQuery.isLoading ? (
          <p className="text-sm text-slate-400">Cargando…</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Dirección</label>
              <input
                className={profileInputCls}
                value={profile.address ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
                placeholder="AVDA. DE LOS PIRINEOS, 7"
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Código postal</label>
                <input
                  className={profileInputCls}
                  value={profile.postalCode ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, postalCode: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Población</label>
                <input
                  className={profileInputCls}
                  value={profile.city ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Provincia</label>
                <input
                  className={profileInputCls}
                  value={profile.province ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, province: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Teléfono</label>
                <input
                  className={profileInputCls}
                  value={profile.phone ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email"
                  className={profileInputCls}
                  value={profile.email ?? ""}
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Registro Mercantil (pie de página)</label>
              <input
                className={profileInputCls}
                value={profile.mercantileRegistryText ?? ""}
                onChange={(e) => setProfile((p) => ({ ...p, mercantileRegistryText: e.target.value }))}
                placeholder="Inscrita en el Registro Mercantil de Madrid al Tomo: 25614, Folio: 165, Hoja: M-461575"
              />
            </div>

            <button
              onClick={() => saveProfileMutation.mutate()}
              disabled={saveProfileMutation.isPending}
              className="bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
            >
              {saveProfileMutation.isPending ? "Guardando…" : "Guardar"}
            </button>
          </div>
        )}
      </div>

      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
