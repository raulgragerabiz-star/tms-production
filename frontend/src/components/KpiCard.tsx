// 2026-09-09: retoque visual siguiendo el panel de referencia que aportó
// Raúl (TMS Getafe) -- etiqueta en mayúsculas con tracking, valor grande en
// fuente monoespaciada (los números "se leen como datos", no como texto), y
// una nota opcional debajo. Mismas props que antes (label/value/tone) más
// un "sub" opcional, así ningún sitio que ya use <KpiCard> se rompe.
interface Props {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "accent" | "warning" | "danger" | "success";
}

const toneClasses: Record<string, string> = {
  default: "text-slate-900",
  accent: "text-brand-600",
  warning: "text-amber-600",
  danger: "text-red-600",
  success: "text-teal-600",
};

export default function KpiCard({ label, value, sub, tone = "default" }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-[0.68rem] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`font-mono text-2xl font-bold mt-1.5 ${toneClasses[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}
