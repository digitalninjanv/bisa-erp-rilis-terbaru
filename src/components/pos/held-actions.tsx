"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteHeldSaleAction } from "@/server/actions/pos";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

export function HeldActions({
  id,
  label,
  // POS3-13: tombol hapus hanya dirender untuk pemilik tahanan atau
  // pemegang pos.void — selaras dengan penegakan di deleteHeldSaleAction.
  canDelete,
}: {
  id: string;
  label: string | null;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    setBusy(true);
    const result = await deleteHeldSaleAction(id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Pesanan ditahan dihapus.");
    router.refresh();
  }

  return (
    <div className="flex items-center justify-end gap-1.5">
      <a
        href={`/app/pos?resume=${id}`}
        className="inline-flex h-8 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
      >
        <Play className="size-3" /> Lanjutkan
      </a>
      {canDelete ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(true)}
          className="grid size-8 place-items-center rounded border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          aria-label="Hapus pesanan ditahan"
        >
          <Trash2 className="size-3.5" />
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={`Hapus pesanan ditahan${label ? ` "${label}"` : ""}?`}
        confirmLabel="Hapus pesanan"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
