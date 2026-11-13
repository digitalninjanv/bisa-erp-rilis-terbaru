"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ReceiptText, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  postOfflineReviewItemAction,
  resolveOfflineOutboxAction,
} from "@/server/actions/pos-offline";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

/**
 * FIX-POS Tahap 2 (POS3-03/04/06): panel aksi peninjauan hanya
 * dirender untuk pemegang izin supervisor (`pos.void`) — halaman
 * yang memutuskan. "Posting ulang" menjalankan sinkronisasi normal;
 * "Selesaikan @ harga struk" memposting penyelesaian eksplisit pada
 * harga struk offline ke sesi asal (termasuk yang sudah tertutup).
 */
export function OfflineResolveButtons({
  id,
  clientKey,
  canPost = false,
}: {
  id: string;
  clientKey: string;
  canPost?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /* G1 (FRM-02): konfirmasi settle & catatan penyelesaian kini
     dialog bersama, bukan window.confirm/window.prompt. */
  const [confirmingSettle, setConfirmingSettle] = useState(false);
  const [resolving, setResolving] = useState<"done" | "discarded" | null>(null);

  async function post(mode: "retry" | "settle") {
    setBusy(true);
    const result = await postOfflineReviewItemAction({ outboxId: id, mode });
    setBusy(false);
    setConfirmingSettle(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (result.data.mode === "retry" && result.data.status !== "synced" && result.data.status !== "duplicate") {
      toast.warning(
        result.data.message ??
          "Item belum dapat diposting dan tetap berada di daftar peninjauan.",
      );
    } else {
      toast.success(
        result.data.saleNumber
          ? `Penjualan tercatat sebagai ${result.data.saleNumber}.`
          : "Item berhasil diposting.",
      );
    }
    router.refresh();
  }

  async function resolve(resolution: "done" | "discarded", note: string) {
    setBusy(true);
    const result = await resolveOfflineOutboxAction({
      outboxId: id,
      resolution,
      note: note || undefined,
    });
    setBusy(false);
    setResolving(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      resolution === "done"
        ? "Antrean ditandai selesai ditinjau."
        : "Antrean dibuang dari daftar peninjauan.",
    );
    router.refresh();
  }

  return (
    <span className="inline-flex gap-1">
      {canPost ? (
        <>
          <button
            type="button"
            onClick={() => post("retry")}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-sky-50 hover:text-sky-700 disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" /> Posting ulang
          </button>
          <button
            type="button"
            onClick={() => setConfirmingSettle(true)}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-violet-50 hover:text-violet-700 disabled:opacity-40"
          >
            <ReceiptText className="size-3.5" /> Selesaikan @ harga struk
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={() => setResolving("done")}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-40"
      >
        <CheckCircle2 className="size-3.5" /> Tandai selesai
      </button>
      <button
        type="button"
        onClick={() => setResolving("discarded")}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
      >
        <Trash2 className="size-3.5" /> Buang
      </button>
      <ConfirmDialog
        open={confirmingSettle}
        title={`Posting penyelesaian untuk antrean ${clientKey}?`}
        description="Penjualan diposting pada harga struk offline ke sesi kasir asal. Periksa kasir asal, jumlah satuan dasar dan faktor kemasan pada rincian antrean; penyelesaian menyetujui snapshot tersebut. Tindakan ini tercatat di audit."
        confirmLabel="Posting penyelesaian"
        busy={busy}
        onConfirm={() => void post("settle")}
        onCancel={() => setConfirmingSettle(false)}
      />
      <ConfirmDialog
        open={resolving !== null}
        title={
          resolving === "done"
            ? `Selesaikan antrean ${clientKey}?`
            : `Buang antrean ${clientKey}?`
        }
        confirmLabel={resolving === "done" ? "Tandai selesai" : "Buang antrean"}
        danger={resolving === "discarded"}
        busy={busy}
        reason={{
          label:
            resolving === "done"
              ? "Catatan penyelesaian (mis. sudah dibuat manual)"
              : "Alasan membuang",
          minLength: 0,
        }}
        onConfirm={(note) => {
          if (resolving) void resolve(resolving, note);
        }}
        onCancel={() => setResolving(null)}
      />
    </span>
  );
}
