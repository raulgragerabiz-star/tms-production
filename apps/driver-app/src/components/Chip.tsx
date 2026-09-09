// 2026-09-09: mismo componente "chip" que ya existe en el Backoffice
// (frontend/src/components/Chip.tsx) -- se duplica aquí porque cada app es
// un paquete npm independiente y no se pueden compartir componentes React
// entre ellas sin montar un paquete compartido nuevo (fuera de alcance de
// este cambio, puramente visual). Etiqueta pequeña de categoría o estado:
// fuente monoespaciada, negrita, esquina poco redondeada -- sustituye a los
// `<span className="... rounded-full">` que había sueltos en cada pantalla
// de esta app.
export type ChipColor = "teal" | "blue" | "amber" | "red" | "purple" | "slate";

interface Props {
  children: string;
  color?: ChipColor;
}

const colorClasses: Record<ChipColor, string> = {
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
