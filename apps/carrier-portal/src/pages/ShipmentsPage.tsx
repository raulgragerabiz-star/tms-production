import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import Chip, { ChipColor } from "@/components/Chip";

interface ShipmentRow {
  id: string;
  status: string;
  departedAt: string | null;
  finishedAt: string | null;
  route: { routeDate: string; warehouse: { name: string }; stops: { id: string }[] };
  vehicle: { plate: string };
}

const statusLabel: Record<string, string> = {
  programmed: "Programado",
  loaded: "Cargado",
  in_transit: "En tránsito",
  finished: "Finalizado",
};

const statusColor: Record<string, ChipColor> = {
  programmed: "slate",
  loaded: "amber",
  in_transit: "blue",
  finished: "teal",
};

export default function ShipmentsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["carrier-shipments"],
    queryFn: async () => (await api.get("/carrier-portal/shipments")).data as { items: ShipmentRow[]; total: number },
  });

  return (
    <div>
      <h2 className="text-lg font-semibold text-slate-900 mb-4">Mis viajes</h2>
      <div className="space-y-2">
        {isLoading && <p className="text-sm text-slate-400">Cargando…</p>}
        {!isLoading && data?.items.length === 0 && <p className="text-sm text-slate-400">Sin viajes registrados.</p>}
        {data?.items.map((s) => (
          <Link key={s.id} to={`/viajes/${s.id}`} className="block bg-white rounded-xl border border-slate-200 p-4 hover:border-brand-300">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-800">
                {new Date(s.route.routeDate).toLocaleDateString("es-ES")} — {s.route.warehouse.name}
              </p>
              <Chip color={statusColor[s.status] ?? "slate"}>{statusLabel[s.status] ?? s.status}</Chip>
            </div>
            <p className="text-xs text-slate-500 mt-1 font-mono">
              Vehículo {s.vehicle.plate} · {s.route.stops.length} paradas
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
