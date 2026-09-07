import { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  required?: boolean;
  hint?: string;
}

export default function Field({ label, children, required, hint }: Props) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}
