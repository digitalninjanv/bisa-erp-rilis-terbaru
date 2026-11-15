"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteSupplierReturnAction,
  postSupplierReturnAction,
  voidSupplierReturnAction,
} from "@/server/actions/supplier-returns";
import { d, formatIDR } from "@/lib/money";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

/**
 * RET-2: aksi dokumen retur pembelian di halaman detail. Aturan status
 * ditegakkan server (domain); tombol hanya tampil untuk status yang
 * relevan dan mengumpulkan konfirmasi/alasan seperti pola void gudang.
 */
export function SupplierReturnDocActions({
  id,
  number,
  status,
  hasResolutions,
}: {
  id: string;
  number: string;
  status: string;
  hasResolutions: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingVoid, setConfirmingVoid] = useState(false);

  async function post() {
    setBusy("post");
    const result = await postSupplierReturnAction({ returnId: id });
    setBusy("");
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      `Retur ${result.data.number} terposting — nilai stok (AVCO) ${formatIDR(result.data.totalValue)}${d(result.data.invoiceCreditAmount).gt(0) ? `, kredit faktur ${formatIDR(result.data.invoiceCreditAmount)}` : ""}, memotong utang ${formatIDR(result.data.payableAmount)}, klaim kredit ${formatIDR(result.data.creditAmount)}.`,
    );
    router.refresh();
  }

  async function remove() {
    setBusy("delete");
    const result = await deleteSupplierReturnAction({ returnId: id });
    setBusy("");
    setConfirmingDelete(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Draf retur ${number} dihapus.`);
    router.push("/app/gudang/retur-pembelian");
    router.refresh();
  }

  async function voidReturn(reason: string) {
    setBusy("void");
    const result = await voidSupplierReturnAction({ returnId: id, reason });
    setBusy("");
    setConfirmingVoid(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Retur ${number} dibatalkan — stok kembali dan jurnal posting dibalik.`);
    router.refresh();
  }

  if (status === "draft") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={busy !== ""}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy === "delete" ? "Menghapus…" : "Hapus draf"}
        </button>
        <button
          type="button"
          onClick={post}
          disabled={busy !== ""}
          className="inline-flex h-8 items-center rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy === "post" ? "Memposting…" : "Posting retur"}
        </button>
        <ConfirmDialog
          open={confirmingDelete}
          title={`Hapus draf retur ${number}?`}
          description="Draf belum menggerakkan stok atau uang, jadi aman dihapus. Penghapusan ini permanen."
          confirmLabel="Hapus draf"
          danger
          busy={busy !== ""}
          onConfirm={() => void remove()}
          onCancel={() => setConfirmingDelete(false)}
        />
      </div>
    );
  }

  if ((status === "posted" || status === "partially_resolved") && !hasResolutions) {
    return (
      <>
        <button
          type="button"
          onClick={() => setConfirmingVoid(true)}
          disabled={busy !== ""}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy === "void" ? "Membatalkan…" : "Batalkan retur"}
        </button>
        <ConfirmDialog
          open={confirmingVoid}
          title={`Batalkan retur ${number}?`}
          description="Stok barang retur dikembalikan ke gudang dan jurnal posting dibalik; potongan utang/klaim kredit pemasok ikut dibatalkan."
          confirmLabel="Batalkan retur"
          danger
          busy={busy !== ""}
          reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
          onConfirm={(reason) => void voidReturn(reason)}
          onCancel={() => setConfirmingVoid(false)}
        />
      </>
    );
  }

  return null;
}
