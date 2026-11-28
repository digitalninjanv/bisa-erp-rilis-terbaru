"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteStatementImportAction,
  markStatementImportReconciledAction,
} from "@/server/actions/bank-reconciliation";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

export function ImportStatementActions({
  importId,
  fileName,
  reconciled,
  matchedCount,
  unmatchedCount,
}: {
  importId: string;
  fileName: string;
  reconciled: boolean;
  matchedCount: number;
  unmatchedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"complete" | "delete" | null>(null);

  async function complete() {
    setBusy(true);
    const result = await markStatementImportReconciledAction({ importId });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Rekonsiliasi ${fileName} ditandai selesai.`);
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await deleteStatementImportAction({ importId });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Berkas impor ${fileName} dihapus.`);
    router.refresh();
  }

  const completeDisabled = busy || reconciled || unmatchedCount > 0;
  const deleteDisabled = busy || reconciled || matchedCount > 0;
  const completeTitle = reconciled
    ? "Sudah ditandai selesai"
    : unmatchedCount > 0
      ? `${unmatchedCount} baris belum tertaut — selesaikan dulu`
      : "Tandai rekonsiliasi berkas ini selesai";
  const deleteTitle = reconciled
    ? "Berkas yang sudah selesai tidak dapat dihapus"
    : matchedCount > 0
      ? `${matchedCount} baris masih tertaut — lepas tautan dulu`
      : "Hapus berkas impor ini";

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={() => setConfirm("complete")}
          disabled={completeDisabled}
          title={completeTitle}
          className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CheckCircle2 className="size-3" /> Selesai
        </button>
        <button
          type="button"
          onClick={() => setConfirm("delete")}
          disabled={deleteDisabled}
          title={deleteTitle}
          className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 className="size-3" /> Hapus
        </button>
      </div>

      <ConfirmDialog
        open={confirm === "complete"}
        title={`Tandai rekonsiliasi ${fileName} selesai?`}
        description="Semua baris sudah tertaut. Setelah ditandai selesai, berkas tidak dapat dihapus; koreksi harus lewat jurnal penyesuaian atau berkas baru."
        confirmLabel="Tandai selesai"
        busy={busy}
        onConfirm={() => void complete()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={`Hapus berkas impor ${fileName}?`}
        description="Seluruh baris mutasi dari berkas ini ikut dihapus. Tindakan ini tidak mengubah jurnal yang sudah ada."
        confirmLabel="Hapus berkas"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(null)}
      />
    </>
  );
}
