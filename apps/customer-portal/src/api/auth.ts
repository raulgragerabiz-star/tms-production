import axios from "axios";

function resolveApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_BASE_URL;
  if (envUrl) return envUrl;
  const { hostname, protocol } = window.location;
  const m = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (m) return `${protocol}//${m[1]}-4000.${m[2]}`;
  return "http://localhost:4000";
}

// Reutiliza el mismo endpoint de login que el resto de portales
// (/api/auth/login), que ya discrimina por AppUser.userType. No se crea
// un endpoint de auth nuevo — mismo principio de reutilización del
// documento v1.1.
export async function loginCustomerPortal(email: string, password: string) {
  const res = await axios.post(`${resolveApiBaseUrl()}/api/auth/login`, {
    email,
    password,
    expectedUserType: "customer_portal",
  });
  const { token } = res.data;
  localStorage.setItem("customer_portal_token", token);
  return token;
}

export function logoutCustomerPortal() {
  localStorage.removeItem("customer_portal_token");
}

export function isLoggedIn(): boolean {
  return !!localStorage.getItem("customer_portal_token");
}
