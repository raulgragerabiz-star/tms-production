import { ReactNode } from "react";

// Contenedor de tarjeta con título + descripción opcional, para envolver un
// gráfico, una tabla o cualquier bloque de contenido -- mismo patrón
// ".panel" del panel de referencia (TMS Getafe): tarjeta blanca, borde fino,
// esquina de 12px (rounded-xl), sin sombra.
interface Props {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export default function Panel({ title, description, children, className = "" }: Props) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-4 ${className}`}>
      {title && <h3 className="text-sm font-bold text-slate-800">{title}</h3>}
      {description && <p className="text-xs text-slate-500 mt-0.5 mb-3">{description}</p>}
      {children}
    </div>
  );
}
