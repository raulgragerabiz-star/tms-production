import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "@/api/client";

interface InboxData {
  pendingAcceptance: { id: string; routeDate: string; warehouse: { name: string }; stops: { id: string }[] }[];
  openIncidents: { id: string; incidentType: string; description: string | null; shipment: { id: string } }[];
  activeShipments: {
    id: string;
    status: string;
    vehicle: { plate: string };
    route: { routeDate: string; warehouse: { name: string } };
  }[];
}

export default function InboxPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["carrier-inbox"],
    queryFn: async () => (await api.get("/carrier-portal/inbox")).data as InboxData,
    refetchInterval: 20000,
  });

  const acceptMutation = useMutation({
    mutationFn: async (routeId: string) => (await api.post(`/carrier-portal/routes/${routeId}/accept`)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["carrier-inbox"] }),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ routeId, reason }: { routeId: string; reason: string }) =>
      (await api.post(`/carrier-portal/routes/${routeId}/reject`, { reason })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["carrier-inbox"] }),
  });

  if (isLoading) return <p className="text-sm text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          Viajes por aceptar ({data?.pendingAcceptance.length ?? 0})
        </h2>
        <div className="space-y-2">
          {data?.pendingAcceptance.length === 0 && (
            <p className="text-sm text-slate-400 bg-white rounded-lg border border-slate-200 p-4">
              No tienes viajes pendientes de confirmar.
            </p>
          )}
          {data?.pendingAcceptance.map((r) => (
            <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {new Date(r.routeDate).toLocaleDateString("es-ES")} — {r.warehouse.name}
                </p>
                <p className="text-xs text-slate-500">{r.stops.length} paradas</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => acceptMutation.mutate(r.id)}
                  className="text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg"
                >
                  Aceptar
                </button>
                <button
                  onClick={() => {
                    const reason = window.prompt("Motivo del rechazo:");
                    if (reason) rejectMutation.mutate({ routeId: r.id, reason });
                  }}
                  className="text-xs font-medium bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded-lg"
                >
                  Rechazar
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          Viajes activos ({data?.activeShipments.length ?? 0})
        </h2>
        <div className="space-y-2">
          {data?.activeShipments.length === 0 && (
            <p className="text-sm text-slate-400 bg-white rounded-lg border border-slate-200 p-4">Sin viajes activos.</p>
          )}
          {data?.activeShipments.map((s) => (
            <Link
              key={s.id}
              to={`/viajes/${s.id}`}
              className="block bg-white rounded-lg border border-slate-200 p-4 hover:border-brand-300"
            >
              <p className="text-sm font-medium text-slate-800">
                {new Date(s.route.routeDate).toLocaleDateString("es-ES")} — {s.route.warehouse.name}
              </p>
              <p className="text-xs text-slate-500">
                Vehículo {s.vehicle.plate} · Estado: {s.status}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-700 mb-2">
          Incidencias abiertas ({data?.openIncidents.length ?? 0})
        </h2>
        <div className="space-y-2">
          {data?.openIncidents.length === 0 && (
            <p className="text-sm text-slate-400 bg-white rounded-lg border border-slate-200 p-4">
              Sin incidencias abiertas.
            </p>
          )}
          {data?.openIncidents.map((inc) => (
            <Link
              key={inc.id}
              to={`/viajes/${inc.shipment.id}`}
              className="block bg-white rounded-lg border border-red-200 bg-red-50 p-4 hover:border-red-300"
            >
              <p className="text-sm font-medium text-red-700 capitalize">{inc.incidentType.replace("_", " ")}</p>
              <p className="text-xs text-red-500">{inc.description ?? "Sin descripción"}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
