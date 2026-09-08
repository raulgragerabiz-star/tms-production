import { useEffect, useRef, useState } from "react";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
}

// Captura de firma táctil en un <canvas> plano (sin librería externa, para no
// añadir una dependencia nueva al build). Funciona con touch y con puntero
// (ratón, en el navegador de escritorio para pruebas). El trazo se exporta
// como PNG en base64 (data URL) directamente en `onChange` -- el backend ya
// acepta cualquier string en `signatureUrl` (Objetivo 3), así que no hace
// falta ningún endpoint de subida de ficheros nuevo.
export default function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Alta resolución en pantallas con devicePixelRatio > 1, sin que el
    // tamaño en CSS cambie (el canvas se dibuja a mayor densidad, pero ocupa
    // el mismo espacio en pantalla).
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e293b";
    }
  }, []);

  function getPoint(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const point = getPoint(e);
    if (ctx && lastPointRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    }
    lastPointRef.current = point;
    if (!hasSignature) setHasSignature(true);
  }

  function finishStroke() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    emitCurrentSignature();
  }

  function emitCurrentSignature() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    onChange(canvas.toDataURL("image/png"));
  }

  function handleClear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const ratio = window.devicePixelRatio || 1;
      ctx.clearRect(0, 0, canvas.width / ratio, canvas.height / ratio);
    }
    setHasSignature(false);
    onChange(null);
  }

  return (
    <div>
      <p className="text-sm font-semibold text-slate-700 mb-2">Firma de quien recibe</p>
      <canvas
        ref={canvasRef}
        className="w-full h-40 bg-slate-50 rounded-xl border border-slate-300 touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
      />
      <div className="flex items-center justify-between mt-2">
        <p className="text-xs text-slate-400">{hasSignature ? "Firma registrada" : "Firma aquí con el dedo"}</p>
        <button type="button" onClick={handleClear} className="text-xs text-brand-600 font-medium">
          Borrar
        </button>
      </div>
    </div>
  );
}
