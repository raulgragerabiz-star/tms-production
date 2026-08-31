// apps/app-conductor/src/components/OfflineBanner.tsx
//
// Se monta una vez en el layout raíz de la app (App.tsx), fuera del
// router, para que sea visible en cualquier pantalla — el conductor debe
// saber en todo momento si sus acciones se están guardando localmente.

import { useOfflineSync } from "@/offline/useOfflineSync";

export default function OfflineBanner() {
  const { isOnline, pendingCount, failedCount, syncing } = useOfflineSync();

  if (isOnline && pendingCount === 0 && failedCount === 0) {
    return null; // todo sincronizado, no ocupar espacio en pantalla
  }

  const bg = !isOnline ? "bg-amber-500" : failedCount > 0 ? "bg-red-500" : "bg-blue-500";

  const message = !isOnline
    ? `Sin conexión — ${pendingCount} acción(es) guardadas en el dispositivo`
    : failedCount > 0
    ? `${failedCount} acción(es) con error al sincronizar`
    : syncing
    ? "Sincronizando..."
    : `Sincronizando ${pendingCount} acción(es) pendientes...`;

  return (
    <div className={`${bg} text-white text-sm text-center py-2 px-4 font-medium`}>
      {message}
    </div>
  );
}
