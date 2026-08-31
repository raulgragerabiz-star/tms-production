// Copiar a apps/app-conductor/src/pages/ScanVehicleQrPage.tsx
// Requiere: npm install html5-qrcode --workspace=apps/app-conductor
// (librería gratuita, sin API key, coherente con la decisión de mapa sin
// coste del documento v1.1 §6 — misma filosofía aplicada aquí al escaneo).

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { bindVehicleByQrToken } from "@/api/driverApp";

export default function ScanVehicleQrPage() {
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"scanning" | "success" | "error">("scanning");
  const [message, setMessage] = useState("Apunta la cámara al QR del vehículo");
  const navigate = useNavigate();

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        async (decodedText) => {
          if (status !== "scanning") return;
          try {
            await scanner.stop();
            const result = await bindVehicleByQrToken(decodedText);
            setStatus("success");
            setMessage(`Vehículo vinculado: ${result.plate} (${result.vehicleType})`);
            setTimeout(() => navigate("/"), 1500);
          } catch {
            setStatus("error");
            setMessage("Token QR no válido. Inténtalo de nuevo.");
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

  return (
    <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white p-4">
      <div id="qr-reader" className="w-full max-w-sm rounded-lg overflow-hidden" />
      <p
        className={`mt-6 text-center text-base font-medium ${
          status === "success" ? "text-green-400" : status === "error" ? "text-red-400" : "text-white"
        }`}
      >
        {message}
      </p>
      <button onClick={() => navigate("/")} className="mt-8 text-sm text-slate-400 underline">
        Cancelar
      </button>
    </div>
  );
}
