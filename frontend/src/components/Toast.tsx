import { useEffect } from "react";

interface Props {
  message: string | null;
  variant?: "success" | "error";
  onDismiss: () => void;
}

export default function Toast({ message, variant = "success", onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;

  const tone = variant === "success" ? "bg-emerald-600" : "bg-red-600";

  return (
    <div className={`fixed bottom-4 right-4 z-50 ${tone} text-white text-sm px-4 py-2.5 rounded-lg shadow-lg`}>
      {message}
    </div>
  );
}
