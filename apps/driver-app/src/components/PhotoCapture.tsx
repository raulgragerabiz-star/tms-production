import { useRef, useState } from "react";

interface PhotoCaptureProps {
  onChange: (dataUrls: string[]) => void;
  maxPhotos?: number;
}

const MAX_DIMENSION_PX = 1280;
const JPEG_QUALITY = 0.72;

// Redimensiona/comprime la foto en el propio dispositivo antes de meterla en
// el payload (las fotos de cámara de móvil pueden pesar varios MB; sin esto
// unas pocas fotos podrían superar el límite de 5mb del body-parser del
// backend). Se apoya en un <canvas> oculto, sin librerías nuevas.
function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("No se pudo leer la imagen"));
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > MAX_DIMENSION_PX) {
          height = Math.round((height * MAX_DIMENSION_PX) / width);
          width = MAX_DIMENSION_PX;
        } else if (height > MAX_DIMENSION_PX) {
          width = Math.round((width * MAX_DIMENSION_PX) / height);
          height = MAX_DIMENSION_PX;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas no soportado"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// Captura de fotos (incidencia o evidencia de entrega) desde la cámara del
// móvil o la galería. `capture="environment"` abre directamente la cámara
// trasera en la mayoría de navegadores móviles; en escritorio simplemente
// abre el selector de archivos normal, así que también sirve para pruebas.
export default function PhotoCapture({ onChange, maxPhotos = 4 }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setIsProcessing(true);
    try {
      const files = Array.from(fileList).slice(0, Math.max(0, maxPhotos - photos.length));
      const resized = await Promise.all(files.map(resizeImageFile));
      const next = [...photos, ...resized];
      setPhotos(next);
      onChange(next);
    } finally {
      setIsProcessing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleRemove(index: number) {
    const next = photos.filter((_, i) => i !== index);
    setPhotos(next);
    onChange(next);
  }

  return (
    <div>
      <p className="text-sm font-semibold text-slate-700 mb-2">Fotos (opcional)</p>
      {photos.length > 0 && (
        <div className="grid grid-cols-4 gap-2 mb-2">
          {photos.map((src, idx) => (
            <div key={idx} className="relative">
              <img src={src} alt={`Foto ${idx + 1}`} className="w-full aspect-square object-cover rounded-lg border border-slate-200" />
              <button
                type="button"
                onClick={() => handleRemove(idx)}
                className="absolute -top-1.5 -right-1.5 bg-slate-800 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center"
                aria-label="Quitar foto"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {photos.length < maxPhotos && (
        <label className="block w-full text-center bg-white border border-slate-300 border-dashed rounded-xl py-3 text-sm text-slate-500 cursor-pointer">
          {isProcessing ? "Procesando…" : "📷 Añadir foto"}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={isProcessing}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </label>
      )}
    </div>
  );
}
