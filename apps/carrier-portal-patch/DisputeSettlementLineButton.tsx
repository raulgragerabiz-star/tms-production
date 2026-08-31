// Copiar a apps/carrier-portal/src/components/DisputeSettlementLineButton.tsx
// Se usa en la tabla de líneas de una carrier_settlement (documento
// 13-portal-transportista-TMS.md: "posibilidad de marcar una línea como
// disputed con comentario, iniciando el ciclo de revisión").

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";

interface DisputeSettlementLineButtonProps {
  settlementLineId: string;
  currentStatus: "pending" | "accepted" | "disputed";
}

export default function DisputeSettlementLineButton({
  settlementLineId,
  currentStatus,
}: DisputeSettlementLineButtonProps) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/carrier-portal/settlement-lines/${settlementLineId}/dispute`, { comment }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["carrier-settlements"] });
      setOpen(false);
      setComment("");
    },
  });

  if (currentStatus === "disputed") {
    return (
      <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">
        Disputada
      </span>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-slate-500 underline"
      >
        Disputar
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">
              Disputar línea de liquidación
            </h3>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Explica el motivo de la disputa (mín. 5 caracteres)..."
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setOpen(false)}
                className="text-sm text-slate-500 px-3 py-1.5"
              >
                Cancelar
              </button>
              <button
                disabled={comment.trim().length < 5 || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="rounded-md bg-red-600 text-white px-4 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {mutation.isPending ? "Enviando..." : "Confirmar disputa"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
