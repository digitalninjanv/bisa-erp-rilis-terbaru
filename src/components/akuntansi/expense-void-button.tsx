"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { voidExpenseAction } from "@/server/actions/accounting/beban-transfer";

export function ExpenseVoidButton({
  id,
  number,
  disabled = false,
}: {
  id: string;
  number: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidExpenseAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Beban ${number} dibatalkan dan jurnal pembalik dibuat.`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center rounded border border-border bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "…" : "Batalkan"}
      </button>
      <ConfirmDialog
        open={open}
        title={`Batalkan beban ${number}?`}
        description="Jurnal pembalik dibuat dan dokumen tetap tersimpan berstatus Dibatalkan. Tindakan ini tercatat di audit."
        confirmLabel="Batalkan beban"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
