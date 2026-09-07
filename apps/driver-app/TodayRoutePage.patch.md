# Parche sobre `apps/app-conductor/src/pages/TodayRoutePage.tsx` ya existente

No se reescribe el fichero completo (ya está en producción y funcionando,
"Ruta de hoy — Conductor Demo" confirmado). Se añaden estos bloques.

> Nota sobre `apiClient` y rutas: los ejemplos de este delta asumen que el
> `apiClient` de la app conductor tiene `baseURL = <backend>/api`, y por eso
> las llamadas usan rutas como `/driver-app/shipments/...`. Si tu
> `apiClient` ya incluye `/api/driver-app` en el baseURL, quita ese prefijo
> de las URLs de `driverApp.ts` y `gpsTracker.ts` en consecuencia — ajústalo
> una vez, en un solo sitio.

## 0. Actualización IMPORTANTE — `confirmShipmentLoad` ya no es async

Con el modo offline, `confirmShipmentLoad()` pasa a ser **síncrona y
optimista**: encola la acción y devuelve al instante, sin esperar
respuesta del servidor (documento v1.1 offline, §Modo offline). El botón
debe reflejar el cambio de estado localmente sin esperar confirmación:

```tsx
{shipment?.status === "programmed" && (
  <button
    onClick={() => {
      confirmShipmentLoad(shipment.id);
      // Optimistic update: refleja "loaded" en la UI inmediatamente,
      // el OfflineBanner ya informa si la sync real falla más tarde.
      queryClient.setQueryData(["today-route"], (old: any) => ({
        ...old,
        shipment: { ...old.shipment, status: "loaded" },
      }));
    }}
    className="w-full rounded-md bg-slate-900 text-white py-3 text-base font-semibold"
  >
    Confirmar carga
  </button>
)}
```

## 0.1 Arrancar/parar el GPS tracker con el ciclo de vida del envío

```tsx
import { startGpsTracking, stopGpsTracking } from "@/offline/gpsTracker";

useEffect(() => {
  if (shipment?.status === "in_transit") {
    startGpsTracking(shipment.id);
  }
  return () => stopGpsTracking();
}, [shipment?.id, shipment?.status]);
```

## 0.2 Montar el banner offline en el layout raíz

En `App.tsx`, fuera del `<Routes>`, justo debajo del header:

```tsx
import OfflineBanner from "@/components/OfflineBanner";
// ...
<OfflineBanner />
```

---

Bloques ya existentes de la sesión anterior (sin cambios):

## 1. Import nuevo

```tsx
import { confirmShipmentLoad } from "@/api/driverApp";
import { useNavigate } from "react-router-dom";
```

## 2. Botón "Confirmar carga" — SUSTITUIDO por el bloque 0 de arriba.
No añadir este botón: la versión vigente es la optimista/offline del
bloque 0. Se deja esta nota para que no se aplique por error la versión
`await`-bloqueante de la sesión anterior, incompatible con la cola offline.

## 3. Acceso a "Vincular vehículo por QR" — botón secundario en la misma
cabecera, siempre visible al inicio de turno (útil cuando el conductor no
tiene vehículo fijo asignado ese día, documento v1.1 §5.1).

```tsx
<button
  onClick={() => navigate("/vincular-vehiculo")}
  className="text-sm text-slate-500 underline"
>
  Vincular vehículo (escanear QR)
</button>
```

Requiere añadir la ruta `/vincular-vehiculo` -> `ScanVehicleQrPage` en el
router de la app (`App.tsx`), ver `ScanVehicleQrPage.tsx` adjunto en esta
misma carpeta.
