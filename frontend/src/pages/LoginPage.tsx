import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";
import bigmatLogo from "@/assets/bigmat-logo.png";

export default function LoginPage() {
  const [email, setEmail] = useState("admin@tms.local");
  const [password, setPassword] = useState("Admin1234!");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      setAuth(data.token, data.user);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Error de acceso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-md p-8">
        <img src={bigmatLogo} alt="BigMat" className="h-14 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-brand-700 mb-1">TMS</h1>
        <p className="text-sm text-slate-500 mb-6">Sistema de expediciones — acceso interno</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              required
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-60"
          >
            {loading ? "Accediendo..." : "Iniciar sesión"}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-6">
          Demo: admin@tms.local / Admin1234!
        </p>
      </div>
    </div>
  );
}
