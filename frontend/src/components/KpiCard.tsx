interface Props {
  label: string;
  value: string | number;
  tone?: "default" | "warning" | "danger" | "success";
}

const toneClasses: Record<string, string> = {
  default: "text-slate-900",
  warning: "text-amber-600",
  danger: "text-red-600",
  success: "text-emerald-600",
};

export default function KpiCard({ label, value, tone = "default" }: Props) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`text-2xl font-semibold mt-1 ${toneClasses[tone]}`}>{value}</p>
    </div>
  );
}
