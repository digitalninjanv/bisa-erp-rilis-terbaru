import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { formatIDR } from "@/lib/money";
import type { StoredCart } from "@/components/pos/use-cart-persistence";
import type { ResumeData } from "@/components/pos/use-held-sales";
import { CheckoutSuccessModal, type CompletedSaleInfo } from "@/components/pos/terminal/checkout-success-modal";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

export function CheckoutRecoveryDialog(props: {
  open: boolean;
  busy: boolean;
  error: string | null;
  canRetry: boolean;
  retry: () => void;
  discard: () => void;
  returnFocus: RefObject<HTMLInputElement | null>;
}) {
  const retryRef = useRef<HTMLButtonElement>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  return (
    <>
      <Dialog open={props.open} disablePointerDismissal onOpenChange={(_, event) => event.cancel()}>
        <DialogContent className="pos-terminal-surface" showCloseButton={false} initialFocus={retryRef} finalFocus={props.returnFocus}>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href="/app/pos/riwayat" target="_blank" rel="noopener noreferrer" className="text-sm underline">
              Buka riwayat transaksi
            </a>
            <button
              type="button"
              disabled={props.busy}
              onClick={() => setConfirmDiscard(true)}
              className="text-sm text-muted-foreground underline underline-offset-2 hover:text-destructive"
            >
              Batalkan percobaan
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="Batalkan percobaan pembayaran?"
        description="Lakukan ini hanya setelah memastikan transaksi tidak ada di riwayat. Setelah dibatalkan, transaksi berikutnya memakai kunci baru."
        confirmLabel="Ya, batalkan percobaan"
        cancelLabel="Kembali"
        danger
        busy={props.busy}
        onConfirm={() => {
          setConfirmDiscard(false);
          props.discard();
        }}
        onCancel={() => setConfirmDiscard(false)}
      />
    </>
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
      <DialogContent className="pos-terminal-surface" showCloseButton={false} initialFocus={inputRef} finalFocus={props.returnFocus}>
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
          className="mt-3 h-11 w-full rounded-md border border-input bg-background px-3 text-[13px] outline-none focus:border-ring"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setHoldOpen(false)}
            disabled={busy}
            className="h-11 rounded-md border border-border px-4 text-[13px] hover:bg-muted"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void submitHold()}
            disabled={busy}
            className="h-11 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:cursor-wait disabled:opacity-60"
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
      <DialogContent className="pos-terminal-surface" showCloseButton={false} initialFocus={cancelRef} finalFocus={props.returnFocus}>
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
            className="h-11 w-full rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {resumeHolding
              ? "Menahan keranjang aktif…"
              : "Tahan keranjang aktif, lalu lanjutkan"}
          </button>
          <button
            type="button"
            onClick={() => applyResume(resumeOffer.data)}
            disabled={resumeHolding}
            className="h-11 w-full rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted disabled:opacity-50"
          >
            Ganti keranjang aktif
          </button>
          <button
            type="button"
            ref={cancelRef}
            onClick={resumeCancel}
            disabled={resumeHolding}
            className="h-11 w-full rounded-md px-3 text-[13px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Batal — tetap di keranjang aktif
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PosTerminalModals(props: {
  holdOpen: boolean;
  holdLabel: string;
  setHoldLabel: Dispatch<SetStateAction<string>>;
  setHoldOpen: Dispatch<SetStateAction<boolean>>;
  hold: () => Promise<void>;
  resumeOffer: { data: ResumeData; stored: StoredCart } | null;
  resumeHolding: boolean;
  resumeHoldActiveFirst: () => Promise<void>;
  applyResume: (data: ResumeData) => void;
  resumeCancel: () => void;
  completedSale: CompletedSaleInfo | null;
  setCompletedSale: (sale: CompletedSaleInfo | null) => void;
  canReprint: boolean;
  companyId: string;
  userId: string;
  pendingCheckout: unknown;
  recoveryError: string | null;
  submitting: boolean;
  retryPendingCheckout: () => void;
  discardPendingCheckout: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
  mobileCartOpen: boolean;
}) {
  const {
    holdOpen, holdLabel, setHoldLabel, setHoldOpen, hold,
    resumeOffer, resumeHolding, resumeHoldActiveFirst, applyResume, resumeCancel,
    completedSale, setCompletedSale, canReprint, companyId, userId,
    pendingCheckout, recoveryError, submitting, retryPendingCheckout, discardPendingCheckout,
    searchRef, mobileCartOpen,
  } = props;

  return (
    <>
      {holdOpen ? (
        <HoldDialog
          holdLabel={holdLabel}
          setHoldLabel={setHoldLabel}
          setHoldOpen={setHoldOpen}
          hold={hold}
          returnFocus={mobileCartOpen ? undefined : searchRef}
        />
      ) : null}

      {resumeOffer ? (
        <ResumeDialog
          resumeOffer={resumeOffer}
          resumeHolding={resumeHolding}
          resumeHoldActiveFirst={resumeHoldActiveFirst}
          applyResume={applyResume}
          resumeCancel={resumeCancel}
          returnFocus={mobileCartOpen ? undefined : searchRef}
        />
      ) : null}

      <CheckoutSuccessModal
        key={completedSale?.id ?? "no-sale"}
        sale={completedSale}
        canReprint={canReprint}
        companyId={companyId}
        userId={userId}
        onDismiss={() => {
          setCompletedSale(null);
          searchRef.current?.focus();
        }}
      />
      <CheckoutRecoveryDialog
        open={Boolean(pendingCheckout) || Boolean(recoveryError)}
        busy={submitting}
        error={recoveryError}
        canRetry={Boolean(pendingCheckout)}
        retry={() => void retryPendingCheckout()}
        discard={discardPendingCheckout}
        returnFocus={searchRef}
      />
    </>
  );
}
