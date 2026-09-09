import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/use-toast";
import NewRateModal from "@/pages/rates/NewRateModal";
import NewSurchargeModal from "@/pages/rates/NewSurchargeModal";
import NewPriorityRateModal from "@/pages/rates/NewPriorityRateModal";

interface FullTruckRate {
  id: string;
  validFrom: string;
  validTo: string | null;
  includedKm: string;
  extraStopFee: string;
  extraKmFee: string;
  carrier: { legalName: string };
}

interface PalletRate {
  id: string;
  validFrom: string;
  validTo: string | null;
  fixedFeePerNote: string;
  looseItemFee: string;
  maxWeightPerPalletKg: string;
  carrier: { legalName: string };
}

interface SurchargeRow {
  id: string;
  surchargeType: string;
  calculationMode: string;
  value: string;
  validFrom: string;
  validTo: string | null;
  carrier: { legalName: string };
}

interface CustomerRateRow {
  id: string;
  serviceType: string;
  fixedAmount: string;
  validFrom: string;
  validTo: string | null;
  carrier: { legalName: string };
  customer: { legalName: string; businessCode: string };
}

interface ZoneRateRow {
  id: string;
  serviceType: string;
  zoneName: string;
  fixedAmount: string;
  validFrom: string;
  validTo: string | null;
  carrier: { legalName: string };
}

const surchargeTypeLabel: Record<string, string> = {
  fuel: "Combustible",
  adr: "ADR",
  holiday: "Festivo",
  toll: "Peaje",
  waiting_time: "Espera",
  zone: "Zona",
};

const calculationModeLabel: Record<string, string> = {
  fixed: "Fijo",
  percentage: "%",
  per_km: "€/km",
  per_hour: "€/hora",
};

// Etiquetas legibles de los 4 segmentos reales de ServiceType, usadas en las
// columnas "Servicio" de las tablas de tarifa por cliente/zona (antes se
// mostraba el valor crudo del enum con guiones bajos sustituidos por espacios).
const serviceSegmentLabel: Record<string, string> = {
  paqueteria: "Paquetería",
  paleteria: "Paletería",
  paleteria_pesada: "Paletería pesada",
  gran_volumen: "Gran volumen",
};

type Tab = "full_truck" | "pallet" | "surcharges" | "customer" | "zone";

// 2026-09-09: "embedded" -- se usa desde el nuevo "Flota y Transportistas"
// (pestaña Tarifas), que ya pone su propio título arriba; solo oculta el
// h1 propio de esta pantalla, las 5 sub-pestañas (camión completo/paletería/
// cliente/zona/suplementos) y el motor de tarifas siguen exactamente igual.
// Sin este prop (uso independiente) el comportamiento no cambia en nada.
export default function RatesPage({ embedded = false }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("full_truck");
  const [rateModalOpen, setRateModalOpen] = useState(false);
  const [surchargeModalOpen, setSurchargeModalOpen] = useState(false);
  const [priorityModalOpen, setPriorityModalOpen] = useState(false);
  const { toast, showSuccess, showError, dismiss } = useToast();

  const fullTruck = useQuery({
    queryKey: ["rates-full-truck"],
    queryFn: async () => (await api.get("/rates/full-truck")).data as { items: FullTruckRate[] },
    enabled: tab === "full_truck",
  });

  const pallet = useQuery({
    queryKey: ["rates-pallet"],
    queryFn: async () => (await api.get("/rates/pallet")).data as { items: PalletRate[] },
    enabled: tab === "pallet",
  });

  const surcharges = useQuery({
    queryKey: ["rate-surcharges"],
    queryFn: async () => (await api.get("/rates/surcharges")).data as { items: SurchargeRow[] },
    enabled: tab === "surcharges",
  });

  const customerRates = useQuery({
    queryKey: ["rates-customer"],
    queryFn: async () => (await api.get("/rates/customer")).data as { items: CustomerRateRow[] },
    enabled: tab === "customer",
  });

  const zoneRates = useQuery({
    queryKey: ["rates-zone"],
    queryFn: async () => (await api.get("/rates/zone")).data as { items: ZoneRateRow[] },
    enabled: tab === "zone",
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "full_truck", label: "Camión completo" },
    { id: "pallet", label: "Paletería" },
    { id: "customer", label: "Por cliente" },
    { id: "zone", label: "Por zona" },
    { id: "surcharges", label: "Suplementos" },
  ];

  function handleNewClick() {
    if (tab === "full_truck" || tab === "pallet") setRateModalOpen(true);
    else if (tab === "surcharges") setSurchargeModalOpen(true);
    else setPriorityModalOpen(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        {embedded ? <div /> : <h1 className="text-xl font-semibold text-slate-900">Tarifas</h1>}
        <button
          onClick={handleNewClick}
          className="bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          + Nueva
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Motor de tarifas (Fase 9): la resolución de precio prioriza cliente → zona → tarifa
        general, y le suma todos los suplementos vigentes y aplicables. Todas las vigencias
        se validan sin solape en el backend.
      </p>

      <div className="flex gap-2 mb-4 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t.id ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "full_truck" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Vigencia</th>
                <th className="text-right px-4 py-3">Km incluidos</th>
                <th className="text-right px-4 py-3">Parada adicional</th>
                <th className="text-right px-4 py-3">€/km extra</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fullTruck.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin tarifas registradas.</td>
                </tr>
              )}
              {fullTruck.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{r.carrier.legalName}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(r.validFrom).toLocaleDateString("es-ES")} — {r.validTo ? new Date(r.validTo).toLocaleDateString("es-ES") : "vigente"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{r.includedKm}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.extraStopFee).toFixed(2)} €</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.extraKmFee).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "pallet" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Vigencia</th>
                <th className="text-right px-4 py-3">Fijo/albarán</th>
                <th className="text-right px-4 py-3">Bulto suelto</th>
                <th className="text-right px-4 py-3">Peso máx/palé</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pallet.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin tarifas registradas.</td>
                </tr>
              )}
              {pallet.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{r.carrier.legalName}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(r.validFrom).toLocaleDateString("es-ES")} — {r.validTo ? new Date(r.validTo).toLocaleDateString("es-ES") : "vigente"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.fixedFeePerNote).toFixed(2)} €</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.looseItemFee).toFixed(2)} €</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.maxWeightPerPalletKg).toFixed(0)} kg</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "customer" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-left px-4 py-3">Vigencia</th>
                <th className="text-right px-4 py-3">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customerRates.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin tarifas por cliente registradas.</td>
                </tr>
              )}
              {customerRates.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{r.carrier.legalName}</td>
                  <td className="px-4 py-3">{r.customer.businessCode} — {r.customer.legalName}</td>
                  <td className="px-4 py-3">{serviceSegmentLabel[r.serviceType] ?? r.serviceType}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(r.validFrom).toLocaleDateString("es-ES")} — {r.validTo ? new Date(r.validTo).toLocaleDateString("es-ES") : "vigente"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.fixedAmount).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "zone" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Zona / Provincia</th>
                <th className="text-left px-4 py-3">Servicio</th>
                <th className="text-left px-4 py-3">Vigencia</th>
                <th className="text-right px-4 py-3">Importe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {zoneRates.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin tarifas por zona registradas.</td>
                </tr>
              )}
              {zoneRates.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{r.carrier.legalName}</td>
                  <td className="px-4 py-3">{r.zoneName}</td>
                  <td className="px-4 py-3">{serviceSegmentLabel[r.serviceType] ?? r.serviceType}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(r.validFrom).toLocaleDateString("es-ES")} — {r.validTo ? new Date(r.validTo).toLocaleDateString("es-ES") : "vigente"}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.fixedAmount).toFixed(2)} €</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "surcharges" && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs font-semibold uppercase tracking-wide sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3">Transportista</th>
                <th className="text-left px-4 py-3">Tipo</th>
                <th className="text-left px-4 py-3">Modo</th>
                <th className="text-right px-4 py-3">Valor</th>
                <th className="text-left px-4 py-3">Vigencia</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {surcharges.data?.items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin suplementos registrados.</td>
                </tr>
              )}
              {surcharges.data?.items.map((r) => (
                <tr key={r.id} className="hover:bg-brand-50/60">
                  <td className="px-4 py-3">{r.carrier.legalName}</td>
                  <td className="px-4 py-3">{surchargeTypeLabel[r.surchargeType] ?? r.surchargeType}</td>
                  <td className="px-4 py-3">{calculationModeLabel[r.calculationMode] ?? r.calculationMode}</td>
                  <td className="px-4 py-3 text-right font-mono text-slate-600">{Number(r.value).toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {new Date(r.validFrom).toLocaleDateString("es-ES")} — {r.validTo ? new Date(r.validTo).toLocaleDateString("es-ES") : "vigente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewRateModal
        open={rateModalOpen}
        serviceType={tab === "pallet" ? "pallet" : "full_truck"}
        onClose={() => setRateModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <NewSurchargeModal
        open={surchargeModalOpen}
        onClose={() => setSurchargeModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <NewPriorityRateModal
        open={priorityModalOpen}
        kind={tab === "customer" ? "customer" : "zone"}
        onClose={() => setPriorityModalOpen(false)}
        onSuccess={showSuccess}
        onError={showError}
      />
      <Toast message={toast.message} variant={toast.variant} onDismiss={dismiss} />
    </div>
  );
}
