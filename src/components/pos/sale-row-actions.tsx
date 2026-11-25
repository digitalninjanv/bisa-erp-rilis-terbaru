"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { getDesktopPrintBridge } from "@/lib/pos/desktop-print";
import { voidSaleAction } from "@/server/actions/pos";
import { RowMenu, type RowMenuItem } from "@/components/blocks/row-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

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
  const cancelRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

  async function submit() {
    if (submitting.current) return;
    if (reason.trim().length < 3) {
      toast.error("Alasan void minimal 3 karakter.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    try {
      const result = await voidSaleAction({ saleId, reason });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Transaksi ${number} di-void.`);
      setOpen(false);
      setReason("");
      router.refresh();
    } catch {
      toast.error("Status void belum pasti. Periksa riwayat sebelum mencoba lagi.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  // A-28 UI-5 (UX-A05): pola aksi baris A-25 — satu aksi utama
  // terlihat BERLABEL (Cetak nota, tindakan tersering di riwayat),
  // sisanya masuk menu ⋯ dengan void sebagai aksi destruktif
  // terpisah di dasar. Sebelumnya empat tombol ikon tanpa label
  // (cetak/retur/void sejajar tanpa pemisah).
  const menuItems: RowMenuItem[] = [
    // A-28 UI-2 (UX-D03): faktur format dokumen dari riwayat —
    // hanya untuk pemegang izin cetak ulang; halaman faktur juga
    // menegakkan izin & audit di server.
    ...(canReprint
      ? [{
          key: "faktur",
          label: "Cetak faktur A4",
          href: `/app/pos/nota/${saleId}/faktur?salinan=1&autoprint=1`,
        } satisfies RowMenuItem]
      : []),
    ...(canReturn && status === "completed"
      ? [{ key: "retur", label: "Retur penjualan", href: `/app/pos/retur?sale=${saleId}` } satisfies RowMenuItem]
      : []),
    // POS-VOID-01: void hanya untuk transaksi selesai — server
    // menolak void atas pesanan ditahan, jadi menampilkannya untuk
    // status held hanya menghasilkan aksi yang selalu gagal.
    ...(canVoid && status === "completed"
      ? [{ key: "void", label: "Batalkan transaksi", danger: true } satisfies RowMenuItem]
      : []),
  ];

  return (
    <div className="flex items-center justify-end gap-1.5">
      {canReprint ? (
        <a
          href={`/app/pos/nota/${saleId}?salinan=1&autoprint=1`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 items-center gap-1.5 rounded border border-border bg-card px-3 text-[11px] font-medium text-foreground transition-colors hover:bg-muted lg:h-8 lg:px-2.5"
          aria-label={`Cetak nota ${number}`}
          onClick={(event) => {
            const desktop = getDesktopPrintBridge();
            if (!desktop) return;
            event.preventDefault();
            void desktop.printReceipt(saleId, true).then((result) => {
              if (result.ok) toast.success("Data struk dikirim ke antrean printer.");
              else toast.error(result.message ?? "Gagal mengirim struk.");
            }).catch(() => toast.error("Status cetak belum pasti. Periksa printer sebelum mengulang."));
          }}
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

      <Dialog open={open} disablePointerDismissal={busy} onOpenChange={(next, event) => {
        if (submitting.current) { event.cancel(); return; }
        setOpen(next);
      }}>
        <DialogContent showCloseButton={false} initialFocus={cancelRef}>
          <DialogTitle>Batalkan transaksi {number}</DialogTitle>
          <DialogDescription>
            Stok dikembalikan dan jurnal pembalik otomatis dibuat. Tindakan ini tercatat di audit log.
          </DialogDescription>
          <textarea
            disabled={busy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            aria-label="Alasan void (wajib)"
            placeholder="Alasan void (wajib)"
            className="mt-3 w-full rounded-md border border-input bg-background px-2.5 py-2 text-[13px] outline-none focus:border-ring"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              ref={cancelRef}
              disabled={busy}
              onClick={() => setOpen(false)}
              className="h-11 rounded-md border border-border px-4 text-[13px] hover:bg-muted"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={submit}
              className="h-11 rounded-md bg-destructive px-4 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {busy ? "Memproses…" : "Batalkan transaksi"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
