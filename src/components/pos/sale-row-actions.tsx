"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { voidSaleAction } from "@/server/actions/pos";
import { RowMenu, type RowMenuItem } from "@/components/blocks/row-menu";

export function SaleRowActions({
  saleId,
  number,
  status,
  canVoid,
  canReturn,
  canReprint,
}: {
  saleId: string;
  number: string;
  status: string;
  canVoid: boolean;
  canReturn: boolean;
  canReprint: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // POS2-19 (sebagian): dialog void menutup dengan Escape, sejajar
  // dengan dialog terminal.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function submit() {
    if (reason.trim().length < 3) {
      toast.error("Alasan void minimal 3 karakter.");
      return;
    }
    setBusy(true);
    const result = await voidSaleAction({ saleId, reason });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Transaksi ${number} di-void.`);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  // A-28 UI-5 (UX-A05): pola aksi baris A-25 — satu aksi utama
  // terlihat BERLABEL (Cetak nota, tindakan tersering di riwayat),
  // sisanya masuk menu ⋯ dengan void sebagai aksi destruktif
  // terpisah di dasar. Sebelumnya empat tombol ikon tanpa label
  // (cetak/retur/void sejajar tanpa pemisah).
  const menuItems: RowMenuItem[] = [
    // A-28 UI-2 (UX-D03): faktur format dokumen dari riwayat —
    // cetak ulang membawa salinan=1 seperti struk.
    { key: "faktur", label: "Cetak faktur A4", href: `/app/pos/nota/${saleId}/faktur?salinan=1&autoprint=1` },
    ...(canReturn && status === "completed"
      ? [{ key: "retur", label: "Retur penjualan", href: `/app/pos/retur?sale=${saleId}` } satisfies RowMenuItem]
      : []),
    // POS-VOID-01: void hanya untuk transaksi selesai — server
    // menolak void atas pesanan ditahan, jadi menampilkannya untuk
    // status held hanya menghasilkan aksi yang selalu gagal.
    ...(canVoid && status === "completed"
      ? [{ key: "void", label: "Void transaksi", danger: true } satisfies RowMenuItem]
      : []),
  ];

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canReprint ? (
        <a
          href={`/app/pos/nota/${saleId}?salinan=1&autoprint=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
          aria-label={`Cetak nota ${number}`}
        >
          <Printer className="size-3.5" />
          Cetak nota
        </a>
      ) : null}
      <RowMenu
        label={`Aksi lain untuk transaksi ${number}`}
        items={menuItems}
        onAction={(key) => {
          if (key === "void") setOpen(true);
        }}
      />

      {open ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Void transaksi ${number}`}
            className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl"
          >
            <h3 className="text-sm font-semibold">Void transaksi {number}</h3>
            <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
              Stok dikembalikan dan jurnal pembalik otomatis dibuat. Tindakan ini tercatat di audit log.
            </p>
            <textarea
              autoFocus
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              placeholder="Alasan void (wajib)"
              className="mt-3 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] outline-none focus:border-ring"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={submit}
                className="h-8 rounded-md bg-destructive px-3 text-[12px] font-medium text-white disabled:opacity-50"
              >
                {busy ? "Memproses…" : "Void transaksi"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
