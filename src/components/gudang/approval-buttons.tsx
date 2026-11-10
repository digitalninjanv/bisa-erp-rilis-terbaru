"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  approveStockAdjustmentAction,
  cancelStockAdjustmentAction,
  rejectStockAdjustmentAction,
} from "@/server/actions/inventory/penyesuaian";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

/**
 * T5-3 (D-17): decision buttons for adjustments parked as "pending" by
 * the approval gate. Visibility is decided by the page (checker sees
 * Setujui/Tolak, the maker sees Batalkan); the server enforces the
 * maker ≠ checker rule regardless of what the UI shows. FIX-GDG
 * Tahap 4 (GDG2-09): penolakan & pembatalan memakai dialog bersama,
 * bukan window.prompt/confirm.
 */
export function AdjustmentApproveButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function approve() {
    setBusy(true);
    const result = await approveStockAdjustmentAction({ id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Dokumen ${number} disetujui dan terposting. Stok serta jurnal sudah diterapkan.`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={approve}
      disabled={busy}
      className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-tone-green hover:bg-tone-green-soft disabled:opacity-50"
    >
      {busy ? "…" : "Setujui"}
    </button>
  );
}

export function AdjustmentRejectButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function reject(reason: string) {
    setBusy(true);
    const result = await rejectStockAdjustmentAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Dokumen ${number} ditolak. Stok dan jurnal tidak berubah.`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        Tolak
      </button>
      <ConfirmDialog
        open={open}
        title={`Tolak dokumen ${number}?`}
        description="Dokumen tidak jadi terposting — stok dan jurnal tidak berubah. Alasan tampil di riwayat agar pembuat dokumen tahu apa yang harus diperbaiki."
        confirmLabel="Tolak dokumen"
        danger
        busy={busy}
        reason={{ label: "Alasan penolakan", minLength: 3 }}
        onConfirm={(reason) => void reject(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

export function AdjustmentCancelButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function cancel() {
    setBusy(true);
    const result = await cancelStockAdjustmentAction({ id });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Dokumen ${number} dibatalkan sebelum terposting.`);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        Batalkan
      </button>
      <ConfirmDialog
        open={open}
        title={`Batalkan dokumen ${number}?`}
        description="Dokumen ini masih menunggu persetujuan dan belum mengubah stok apa pun — membatalkannya aman."
        confirmLabel="Batalkan dokumen"
        danger
        busy={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
