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

interface PlannerFiltersState {
  warehouseId: string;
  routeDate: string;
  view: PlannerView;
  orderStatus: string;
  setWarehouseId: (id: string) => void;
  setRouteDate: (date: string) => void;
  setView: (view: PlannerView) => void;
  setOrderStatus: (status: string) => void;
}

export const usePlannerFiltersStore = create<PlannerFiltersState>((set) => ({
  warehouseId: "",
  routeDate: new Date().toISOString().slice(0, 10),
  view: "planificacion",
  orderStatus: "validated",
  setWarehouseId: (warehouseId) => set({ warehouseId }),
  setRouteDate: (routeDate) => set({ routeDate }),
  setView: (view) => set({ view }),
  setOrderStatus: (orderStatus) => set({ orderStatus }),
}));
