// Fase 8k: petición explícita de Raúl -- "el QR realmente no sirve de nada
// si antes tiene que acceder con email y contraseña. la logica del qr es
// que al escanearlo desde el movil, acceda a la app de driver asociada a
// ese conductor, vehiculo y empresa de tte correspondiente". Esta pantalla
// es la nueva puerta de entrada sin contraseña: escanea el QR físico del
// vehículo (el mismo que ya se generaba desde Backoffice > Conductores) y,
// si ese vehículo tiene un conductor asignado con cuenta de App Conductor,
// entra directamente -- sin pasar por LoginPage. Mismo componente
// Html5Qrcode que ya usaba ScanVehicleQrPage.tsx (esa sigue intacta, para
// cuando un conductor YA logueado cambia de vehículo a media jornada).
//
// Ruta: /escanear-acceso, montada en App.tsx SIN ProtectedRoute (todavía no
// hay ningún token en este punto).
import { useEffect, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { loginWithVehicleQr } from "@/api/driverApp";
import { useAuthStore } from "@/store/auth-store";
import bigmatLogo from "@/assets/bigmat-logo.png";

export default function ScanToLoginPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"scanning" | "success" | "error">("scanning");
  const [message, setMessage] = useState("Apunta la cámara al QR del vehículo");
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader-login");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        async (decodedText) => {
          if (status !== "scanning") return;
          try {
            await scanner.stop();
            const result = await loginWithVehicleQr(decodedText);
            setAuth(result.token, result.user);
            setStatus("success");
            setMessage(`Acceso correcto -- vehículo ${result.vehicle.plate}`);
            setTimeout(() => navigate("/"), 1000);
          } catch (err: any) {
            setStatus("error");
            setMessage(err?.response?.data?.message ?? "No se pudo entrar con este QR. Inténtalo de nuevo.");
          }
        },
        () => {
          /* ignorar frames sin QR detectado */
        }
      )
      .catch(() => {
        setStatus("error");
        setMessage("No se pudo acceder a la cámara. Revisa los permisos.");
      });

    return () => {
      scannerRef.current?.stop().catch(() => {});
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function retry() {
    setStatus("scanning");
    setMessage("Apunta la cámara al QR del vehículo");
  }

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-4">
      <img src={bigmatLogo} alt="BigMat" className="h-10 mb-4 bg-white rounded-lg px-3 py-1.5" />
      <div id="qr-reader-login" className="w-full max-w-sm rounded-lg overflow-hidden" />
      <p
        className={`mt-6 text-center text-base font-medium ${
          status === "success" ? "text-green-400" : status === "error" ? "text-red-400" : "text-white"
        }`}
      >
        {message}
      </p>
      {status === "error" && (
        <button onClick={retry} className="mt-4 text-sm text-brand-300 underline">
          Volver a intentarlo
        </button>
      )}
      <Link to="/login" className="mt-8 text-sm text-slate-400 underline">
        Entrar con email y contraseña
      </Link>
    </div>
  );
}
