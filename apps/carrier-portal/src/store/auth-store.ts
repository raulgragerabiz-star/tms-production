import { create } from "zustand";

export interface PortalUser {
  id: string;
  email: string;
  fullName: string;
  userType: string;
  carrierId: string | null;
}

interface AuthState {
  token: string | null;
  user: PortalUser | null;
  setAuth: (token: string, user: PortalUser) => void;
  logout: () => void;
}

const STORAGE_KEY = "tms_carrier_portal_auth";

function loadInitial(): { token: string | null; user: PortalUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, user: null };
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  ...loadInitial(),
  setAuth: (token, user) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem(STORAGE_KEY);
    set({ token: null, user: null });
  },
}));
