// Fase 25 ("usuarios app" sub-fase 3): sustituye del todo a la pantalla de
// login anterior (email/contraseña + "Escanear QR del vehículo", esta última
// vivía en ScanToLoginPage.tsx, ahora retirada) -- petición explícita de
// Raúl: "un QR por centro + circuito + transportista, con formulario del
// conductor" en vez de credenciales o un QR por vehículo/conductor dado de
// alta. Dos pasos en la misma pantalla:
//   1) escanear el QR fijo pegado para ese circuito+transportista (mismo
//      motor html5-qrcode que ya usaba el resto de la app, sin API key);
//   2) rellenar nombre/DNI/teléfono (opcional)/matrícula/remolque (opcional)
//      y enviar -- ver loginWithRouteQr (api/driverApp.ts) y
//      POST /auth/route-qr-login. Estos datos son solo de trazabilidad (no
//      dan de alta ni vinculan ningún Driver/Vehicle real): identifican a la
//      persona que opera la ruta hoy, nada más.
import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { loginWithRouteQr, routeQrSessionFromLoginResponse } from "@/api/driverApp";
import { useAuthStore } from "@/store/auth-store";
import bigmatLogo from "@/assets/bigmat-logo.png";

type Step = "scanning" | "scan-error" | "form" | "submitting" | "submit-error";

export default function LoginPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [step, setStep] = useState<Step>("scanning");
  const [scanMessage, setScanMessage] = useState("Apunta la cámara al QR del circuito");
  const [token, setToken] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [driverName, setDriverName] = useState("");
  const [driverDni, setDriverDni] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [trailerPlate, setTrailerPlate] = useState("");

  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  useEffect(() => {
    if (step !== "scanning") return;
    const scanner = new Html5Qrcode("qr-reader-login");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        async (decodedText) => {
          try {
            await scanner.stop();
          } catch {
            /* la cámara ya podía estar parándose */
          }
          setToken(decodedText);
          setStep("form");
        },
        () => {
          /* ignorar frames sin QR detectado */
        }
      )
      .catch(() => {
        setStep("scan-error");
        setScanMessage("No se pudo acceder a la cámara. Revisa los permisos.");
      });

    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function retryScan() {
    setToken(null);
    setSubmitError(null);
    setScanMessage("Apunta la cámara al QR del circuito");
    setStep("scanning");
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    setStep("submitting");
    setSubmitError(null);
    try {
      const res = await loginWithRouteQr(token, {
        driverName: driverName.trim(),
        driverDni: driverDni.trim(),
        driverPhone: driverPhone.trim() || undefined,
        vehiclePlate: vehiclePlate.trim(),
        trailerPlate: trailerPlate.trim() || undefined,
      });
      setAuth(res.token, routeQrSessionFromLoginResponse(res));
      navigate("/");
    } catch (err: any) {
      setSubmitError(err?.response?.data?.message ?? "No se pudo entrar con este QR. Comprueba los datos o vuelve a escanear.");
      setStep("submit-error");
    }
  }

  const canSubmit = driverName.trim().length > 0 && driverDni.trim().length > 0 && vehiclePlate.trim().length > 0;

  if (step === "scanning" || step === "scan-error") {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-4">
        <img src={bigmatLogo} alt="BigMat" className="h-10 mb-4 bg-white rounded-lg px-3 py-1.5" />
        <div id="qr-reader-login" className="w-full max-w-sm rounded-lg overflow-hidden" />
        <p className={`mt-6 text-center text-base font-medium ${step === "scan-error" ? "text-red-400" : "text-white"}`}>{scanMessage}</p>
        {step === "scan-error" && (
          <button onClick={retryScan} className="mt-4 text-sm text-brand-300 underline">
            Volver a intentarlo
          </button>
        )}
      </div>
    );
  }

  // Fase 25: formulario de identificación tras escanear el QR -- pantalla
  // aparte del escáner (mismo criterio que el resto de la app: no pelear con
  // el ciclo de vida de la cámara dentro de una pantalla con scroll/teclado).
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-md p-8">
        <img src={bigmatLogo} alt="BigMat" className="h-14 mx-auto mb-4" />
        <h1 className="text-2xl font-semibold text-brand-700 mb-1 text-center">App Conductor</h1>
        <p className="text-sm text-slate-500 mb-6 text-center">
          QR leído correctamente. Identifícate para empezar la ruta de hoy.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            value={driverName}
            onChange={(e) => setDriverName(e.target.value)}
            placeholder="Nombre y apellidos"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
            autoFocus
          />
          <input
            value={driverDni}
            onChange={(e) => setDriverDni(e.target.value)}
            placeholder="DNI"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          <input
            type="tel"
            value={driverPhone}
            onChange={(e) => setDriverPhone(e.target.value)}
            placeholder="Teléfono (opcional)"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <input
            value={vehiclePlate}
            onChange={(e) => setVehiclePlate(e.target.value.toUpperCase())}
            placeholder="Matrícula del vehículo"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
            required
          />
          <input
            value={trailerPlate}
            onChange={(e) => setTrailerPlate(e.target.value.toUpperCase())}
            placeholder="Matrícula del remolque (opcional)"
            className="w-full rounded-xl border border-slate-300 px-4 py-3 text-base font-mono focus:outline-none focus:ring-2 focus:ring-brand-500"
          />

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <button
            type="submit"
            disabled={!canSubmit || step === "submitting"}
            className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-base font-medium disabled:opacity-60"
          >
            {step === "submitting" ? "Entrando…" : "Entrar"}
          </button>
        </form>

        <button onClick={retryScan} className="w-full text-center text-sm text-slate-400 underline mt-6">
          Volver a escanear
        </button>
      </div>
    </div>
  );
}
