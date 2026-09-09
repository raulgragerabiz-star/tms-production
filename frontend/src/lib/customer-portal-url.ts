// Enlace al Portal Cliente para dárselo a un cliente recién dado de alta por
// la carga de pedidos por Excel (ver ImportOrdersModal.tsx). Mismo patrón de
// resolución que ya usan customer-portal/carrier-portal/frontend para
// encontrarse entre sí en Codespaces (cada puerto vive en su propio
// subdominio: <nombre>-<puerto>.app.github.dev): se reescribe el puerto del
// Backoffice (este frontend) por el del Portal Cliente (5176). Con
// VITE_CUSTOMER_PORTAL_URL definida (despliegue fuera de Codespaces) se usa
// tal cual.
export function resolveCustomerPortalUrl(): string {
  const envUrl = import.meta.env.VITE_CUSTOMER_PORTAL_URL;
  if (envUrl) return envUrl;

  const { hostname, protocol } = window.location;
  const codespacesMatch = hostname.match(/^(.*)-\d+\.(app\.github\.dev)$/);
  if (codespacesMatch) {
    return `${protocol}//${codespacesMatch[1]}-5176.${codespacesMatch[2]}`;
  }

  return "http://localhost:5176";
}
