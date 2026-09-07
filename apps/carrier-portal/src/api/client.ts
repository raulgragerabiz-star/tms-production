import axios from "axios";
import { useAuthStore } from "@/store/auth-store";

/**
 * En Codespaces cada puerto vive en su propio subdominio, así que no se
 * puede hardcodear localhost:4000 (mismo fix ya aplicado en customer-portal:
 * ver apps/customer-portal/src/api/client.ts). Reescribe el puerto del
 * frontend por el del backend (4000) sobre el mismo host.
 */
function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  const { hostname, protocol } = window.location;
  const codespacesMatch = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (codespacesMatch) {
    return `${protocol}//${codespacesMatch[1]}-4000.${codespacesMatch[2]}/api`;
  }

  return "http://localhost:4000/api";
}

export const api = axios.create({
  baseURL: resolveApiBaseUrl(),
});

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error?.response?.status === 401) useAuthStore.getState().logout();
    return Promise.reject(error);
  }
);