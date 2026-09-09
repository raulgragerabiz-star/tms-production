// Etiqueta pequeña de categoría (no de estado de ciclo de vida -- para eso
// está <StatusBadge>): clasificación ABC de clientes, tipo de vehículo,
// segmento de servicio, etc. Mismo patrón "chip" del panel de referencia
// (TMS Getafe): fuente monoespaciada, negrita, esquina poco redondeada.
interface Props {
  children: string;
  color?: "teal" | "blue" | "amber" | "red" | "purple" | "slate";
}

const colorClasses: Record<string, string> = {
  teal: "bg-teal-100 text-teal-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
  purple: "bg-violet-100 text-violet-700",
  slate: "bg-slate-100 text-slate-600",
};

export default function Chip({ children, color = "slate" }: Props) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded font-mono text-[0.68rem] font-bold whitespace-nowrap ${colorClasses[color]}`}>
      {children}
    </span>
  );
}
