import { useState, useCallback } from "react";

interface ToastState {
  message: string | null;
  variant: "success" | "error";
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>({ message: null, variant: "success" });

  const showSuccess = useCallback((message: string) => setToast({ message, variant: "success" }), []);
  const showError = useCallback((message: string) => setToast({ message, variant: "error" }), []);
  const dismiss = useCallback(() => setToast((t) => ({ ...t, message: null })), []);

  return { toast, showSuccess, showError, dismiss };
}
