// Fase 8L (rediseño App Conductor): "Escáner de códigos" de la barra de
// acciones de una parada -- verificación de mercancía (código de palet o
// bulto) durante la entrega. Mismo motor que ScanVehicleQrPage.tsx
// (html5-qrcode, sin API key), pero como pantalla aparte en vez de cámara
// incrustada en StopDetailPage: es el mismo patrón ya usado en esta app
// (ScanVehicleQrPage.tsx, ScanToLoginPage.tsx) para no pelear con el ciclo
// de vida de la cámara dentro de una pantalla con scroll.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Html5Qrcode } from "html5-qrcode";
import { scanStopCode } from "@/api/driverApp";

export default function ScanStopCodePage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [status, setStatus] = useState<"scanning" | "success" | "error">("scanning");
  const [message, setMessage] = useState("Apunta la cámara al código del palet o bulto");
  const navigate = useNavigate();

  useEffect(() => {
    const scanner = new Html5Qrcode("qr-reader-stop");
    scannerRef.current = scanner;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        async (decodedText) => {
          if (status !== "scanning" || !id) return;
          try {
            await scanner.stop();
            await scanStopCode(id, decodedText);
            queryClient.invalidateQueries({ queryKey: ["today-route"] });
            setStatus("success");
            setMessage(`Código registrado: ${decodedText}`);
            setTimeout(() => navigate(`/paradas/${id}`), 1200);
          } catch {
            setStatus("error");
            setMessage("No se pudo registrar el código. Inténtalo de nuevo.");
          }
        },
        () => {
          /* ignorar frames sin código detectado */
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
      <div id="qr-reader-stop" className="w-full max-w-sm rounded-lg overflow-hidden" />
      <p
        className={`mt-6 text-center text-base font-medium ${
          status === "success" ? "text-green-400" : status === "error" ? "text-red-400" : "text-white"
        }`}
      >
        {message}
      </p>
      <button onClick={() => navigate(`/paradas/${id}`)} className="mt-8 text-sm text-slate-400 underline">
        Cancelar
      </button>
    </div>
  );
}
