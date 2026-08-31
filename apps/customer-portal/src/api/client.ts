import axios from "axios";

/**
 * Mismo patrón ya usado en backoffice/carrier-portal/driver-app: en
 * Codespaces cada puerto tiene su propio subdominio, así que no se puede
 * hardcodear localhost:4000. Se reescribe dinámicamente el puerto del
 * frontend (5176) por el del backend (4000) sobre el mismo host.
 */
function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) return envUrl;

  const { hostname, protocol } = window.location;

  // Codespaces: algo-5176.app.github.dev -> algo-4000.app.github.dev
  const codespacesMatch = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (codespacesMatch) {
    return `${protocol}//${codespacesMatch[1]}-4000.${codespacesMatch[2]}`;
  }

  return "http://localhost:4000";
}

export const apiClient = axios.create({
  baseURL: `${resolveApiBaseUrl()}/api/customer-portal`,
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("customer_portal_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem("customer_portal_token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
