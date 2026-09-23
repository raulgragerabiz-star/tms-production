import { create } from "zustand";

// Fase 25 ("usuarios app" sub-fase 3): sustituye del todo a la sesión de
// cuenta de conductor (email/contraseña o QR de vehículo) -- petición
// explícita de Raúl. Ya no hay ningún AppUser real detrás de una sesión de
// la App Conductor: se entra escaneando el QR fijo de un circuito de
// reparto (centro + circuito + transportista) y rellenando un formulario de
// identificación (nombre, DNI, teléfono opcional, matrícula, remolque
// opcional) -- ver LoginPage.tsx y POST /auth/route-qr-login. Estos datos
// son solo de trazabilidad (no crean ni vinculan ningún Driver/Vehicle
// real), pero sí identifican a la persona en toda la sesión: por eso se
// guardan aquí en vez de en un simple `token`.
export interface RouteQrSession {
  driverName: string;
  driverDni: string;
  driverPhone: string | null;
  vehiclePlate: string;
  trailerPlate: string | null;
  warehouse: { id: string; name: string };
  deliveryZone: { id: string; name: string };
  carrier: { id: string; legalName: string };
}

interface AuthState {
  token: string | null;
  session: RouteQrSession | null;
  setAuth: (token: string, session: RouteQrSession) => void;
  logout: () => void;
}

const STORAGE_KEY = "tms_driver_app_auth";

function loadInitial(): { token: string | null; session: RouteQrSession | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, session: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, session: null };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadInitial(),
  setAuth: (token, session) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, session }));
    set({ token, session });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, session: null });
  },
}));
