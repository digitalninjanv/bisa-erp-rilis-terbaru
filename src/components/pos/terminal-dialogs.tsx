import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { formatIDR } from "@/lib/money";
import type { StoredCart } from "@/components/pos/use-cart-persistence";
import type { ResumeData } from "@/components/pos/use-held-sales";

export function CheckoutRecoveryDialog(props: {
  open: boolean;
  busy: boolean;
  error: string | null;
  canRetry: boolean;
  retry: () => void;
  returnFocus: RefObject<HTMLInputElement | null>;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={props.open} disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
      <DialogContent showCloseButton={false} initialFocus={retryRef} finalFocus={props.returnFocus}>
        <DialogTitle>Pembayaran belum terkonfirmasi</DialogTitle>
        <DialogDescription>
          Periksa pembayaran sebelumnya sebelum melayani transaksi berikutnya. Pemeriksaan ini
          melanjutkan pembayaran yang sama dan tidak membuat pembayaran kedua.
        </DialogDescription>
        {props.error ? <p role="alert" className="text-sm text-destructive">{props.error}</p> : null}
        <button ref={retryRef} type="button" disabled={props.busy || !props.canRetry} onClick={props.retry}
          className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {props.busy ? "Memeriksa pembayaran…" : "Periksa pembayaran"}
        </button>
        <a href="/app/pos/riwayat" target="_blank" rel="noopener noreferrer" className="text-sm underline">
          Buka riwayat transaksi
        </a>
      </DialogContent>
    </Dialog>
  );
}

export function HoldDialog(props: {
  holdLabel: string;
  setHoldLabel: Dispatch<SetStateAction<string>>;
  setHoldOpen: Dispatch<SetStateAction<boolean>>;
  hold: () => Promise<void>;
  returnFocus?: RefObject<HTMLInputElement | null>;
}) {
  const { holdLabel, setHoldLabel, setHoldOpen, hold } = props;
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submitHold() {
    if (busy) return;
    setBusy(true);
    try {
      await hold();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open disablePointerDismissal={busy} onOpenChange={(open) => { if (!open && !busy) setHoldOpen(false); }}>
      <DialogContent showCloseButton={false} initialFocus={inputRef} finalFocus={props.returnFocus}>
        <DialogTitle>Tahan pesanan</DialogTitle>
        <DialogDescription>
          Simpan keranjang agar bisa dilanjutkan nanti. Stok belum berkurang sampai pembayaran selesai.
        </DialogDescription>
        <input
          ref={inputRef}
          value={holdLabel}
          onChange={(event) => setHoldLabel(event.target.value)}
          disabled={busy}
          placeholder="Nama pesanan (opsional)"
          aria-label="Label pesanan ditahan"
          className="mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus:border-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setHoldOpen(false)}
            disabled={busy}
            className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void submitHold()}
            disabled={busy}
            className="h-8 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground disabled:cursor-wait disabled:opacity-60"
          >
            {busy ? "Menyimpan…" : "Simpan pesanan"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ResumeDialog(props: {
  resumeOffer: { data: ResumeData; stored: StoredCart };
  resumeHolding: boolean;
  resumeHoldActiveFirst: () => Promise<void>;
  applyResume: (data: ResumeData) => void;
  resumeCancel: () => void;
  returnFocus?: RefObject<HTMLInputElement | null>;
}) {
  const { resumeOffer, resumeHolding, resumeHoldActiveFirst, applyResume, resumeCancel } = props;

  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open disablePointerDismissal={resumeHolding} onOpenChange={(open) => { if (!open && !resumeHolding) resumeCancel(); }}>
      <DialogContent showCloseButton={false} initialFocus={cancelRef} finalFocus={props.returnFocus}>
        <DialogTitle>Keranjang aktif belum kosong</DialogTitle>
        <DialogDescription>
          Keranjang saat ini berisi {resumeOffer.stored.cart.length} produk. Pesanan ditahan
          yang dipilih (total tersimpan {formatIDR(resumeOffer.data.heldTotal)}) akan
          menggantikannya — pilih cara melanjutkan agar pekerjaan yang sedang berjalan tidak
          hilang.
        </DialogDescription>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={resumeHoldActiveFirst}
            disabled={resumeHolding}
            className="h-9 w-full rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {resumeHolding
              ? "Menahan keranjang aktif…"
              : "Tahan keranjang aktif, lalu lanjutkan"}
          </button>
          <button
            type="button"
            onClick={() => applyResume(resumeOffer.data)}
            disabled={resumeHolding}
            className="h-9 w-full rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
          >
            Ganti keranjang aktif
          </button>
          <button
            type="button"
            ref={cancelRef}
            onClick={resumeCancel}
            disabled={resumeHolding}
            className="h-9 w-full rounded-md px-3 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Batal — tetap di keranjang aktif
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
