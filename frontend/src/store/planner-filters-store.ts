import { create } from "zustand";

// Fase 8j: petición explícita de Raúl -- "la pestaña planificador se resetea
// cada vez que cambias de pestaña. si eliges almacén, fecha y estado pedido
// generando listado, cuando cambias de pestaña y vuelves se han quitado y
// reseteado los datos". Causa: warehouseId/routeDate vivían en un useState
// de PlannerPage.tsx, y el filtro "Estado del pedido" en uno de
// PlanificacionTab.tsx -- React destruye por completo ese estado en cuanto
// el componente se desmonta, y eso pasa tanto al salir de "Planificador" del
// menú y volver, como al cambiar entre las pestañas internas Planificación/
// Rutas/Despacho (PlannerPage solo monta la pestaña activa).
//
// Un store de Zustand vive en memoria mientras dure la sesión de la SPA
// (mismo patrón ya usado en auth-store.ts), así que sobrevive a que React
// desmonte y remonte los componentes -- basta con leer/escribir aquí en vez
// de con useState local. Deliberadamente NO se persiste en localStorage (a
// diferencia de auth-store.ts): son solo filtros de la vista actual, no algo
// que deba sobrevivir a cerrar el navegador ni compartirse entre pestañas.
export type PlannerView = "planificacion" | "rutas" | "despacho";

// Fase 11 (petición explícita de Raúl): "poder no solo elegir un día
// concreto para planificación si no también un rango de fechas en las que
// poder tener una vista más amplia de las salidas programadas". Antes solo
// existía `routeDate` (un único día); ahora es un rango `dateFrom`/`dateTo`
// -- con ambos iguales (el valor por defecto, hoy) se comporta exactamente
// como el selector de un solo día de siempre, así que nada se rompe para
// quien no toque "Hasta". Mismo patrón de dos fechas que ya usa BillingPage.
const today = new Date().toISOString().slice(0, 10);

interface PlannerFiltersState {
  warehouseId: string;
  dateFrom: string;
  dateTo: string;
  view: PlannerView;
  orderStatus: string;
  // Fase 15 (más tarde): filtro por ruta/circuito de reparto -- petición
  // explícita de Raúl ("no se ve que haya una opcion de seleccionar por
  // ruta a parte de por almacen"). "" = todas, "sin-circuito" = sin
  // circuito resuelto para ese almacén. Vive aquí, no en useState local,
  // por el mismo motivo que orderStatus (Fase 8j): no perderlo al cambiar
  // de pestaña dentro del Planificador.
  deliveryZoneId: string;
  setWarehouseId: (id: string) => void;
  setDateFrom: (date: string) => void;
  setDateTo: (date: string) => void;
  /** Fija dateFrom Y dateTo al mismo día -- atajo para volver a "un solo día". */
  setSingleDate: (date: string) => void;
  setView: (view: PlannerView) => void;
  setOrderStatus: (status: string) => void;
  setDeliveryZoneId: (id: string) => void;
}

export const usePlannerFiltersStore = create<PlannerFiltersState>((set) => ({
  warehouseId: "",
  dateFrom: today,
  dateTo: today,
  view: "planificacion",
  orderStatus: "validated",
  deliveryZoneId: "",
  setWarehouseId: (warehouseId) => set({ warehouseId }),
  setDateFrom: (dateFrom) => set({ dateFrom }),
  setDateTo: (dateTo) => set({ dateTo }),
  setSingleDate: (date) => set({ dateFrom: date, dateTo: date }),
  setView: (view) => set({ view }),
  setOrderStatus: (orderStatus) => set({ orderStatus }),
  setDeliveryZoneId: (deliveryZoneId) => set({ deliveryZoneId }),
}));
