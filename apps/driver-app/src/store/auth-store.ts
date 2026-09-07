import { create } from "zustand";

export interface DriverUser {
  id: string;
  email: string;
  fullName: string;
  userType: string;
  driverId: string | null;
}

interface AuthState {
  token: string | null;
  user: DriverUser | null;
  setAuth: (token: string, user: DriverUser) => void;
  logout: () => void;
}

const STORAGE_KEY = "tms_driver_app_auth";

function loadInitial(): { token: string | null; user: DriverUser | null } {
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
