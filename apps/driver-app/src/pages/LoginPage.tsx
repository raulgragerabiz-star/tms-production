import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { useAuthStore } from "@/store/auth-store";

export default function LoginPage() {
  const [email, setEmail] = useState("conductor@tms.local");
  const [password, setPassword] = useState("Driver1234!");
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
      if (data.user.userType !== "driver_app") {
        setError("Estas credenciales no pertenecen a la App Conductor");
        return;
      }
      setAuth(data.token, data.user);
      navigate("/");
    } catch (err: any) {
      setError(err?.response?.data?.message ?? "Error de acceso");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8">
        <h1 className="text-2xl font-semibold text-brand-700 mb-1">App Conductor</h1>
        <p className="text-sm text-slate-500 mb-6">Login simple para uso en cabina</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Teléfono / usuario"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="PIN / contraseña"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-base font-medium disabled:opacity-60"
          >
            {loading ? "Accediendo..." : "Entrar"}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-6 text-center">Demo: conductor@tms.local / Driver1234!</p>
      </div>
    </div>
  );
}
