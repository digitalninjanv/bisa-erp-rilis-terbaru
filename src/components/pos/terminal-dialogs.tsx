import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { formatIDR } from "@/lib/money";
import type { StoredCart } from "@/components/pos/use-cart-persistence";
import type { ResumeData } from "@/components/pos/use-held-sales";

// FIX-ARS Tahap 5 (ARS2-01): dialog terminal — JSX dipindah apa adanya
// dari PosTerminal; keduanya dirender bersyarat oleh komponen induk
// persis seperti sebelumnya.
export function HoldDialog(props: {
  holdLabel: string;
  setHoldLabel: Dispatch<SetStateAction<string>>;
  setHoldOpen: Dispatch<SetStateAction<boolean>>;
  hold: () => Promise<void>;
}) {
  const { holdLabel, setHoldLabel, setHoldOpen, hold } = props;
  const [busy, setBusy] = useState(false);

  async function submitHold() {
    if (busy) return;
    setBusy(true);
    try {
      await hold();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        setHoldOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, setHoldOpen]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) setHoldOpen(false);
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tahan pesanan"
        className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl"
      >
        <h3 className="text-sm font-semibold">Tahan pesanan</h3>
        <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
          Simpan keranjang agar bisa dilanjutkan nanti. Stok belum berkurang sampai pembayaran selesai.
        </p>
        <input
          autoFocus
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
      </div>
    </div>
  );
}

export function ResumeDialog(props: {
  resumeOffer: { data: ResumeData; stored: StoredCart };
  resumeHolding: boolean;
  resumeHoldActiveFirst: () => Promise<void>;
  applyResume: (data: ResumeData) => void;
  resumeCancel: () => void;
}) {
  const { resumeOffer, resumeHolding, resumeHoldActiveFirst, applyResume, resumeCancel } = props;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !resumeHolding) {
        resumeCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resumeHolding, resumeCancel]);

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !resumeHolding) resumeCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-dialog-title"
        className="w-full max-w-sm rounded-xl border border-border bg-card p-4 shadow-xl"
      >
        <h3 id="resume-dialog-title" className="text-sm font-semibold">
          Keranjang aktif belum kosong
        </h3>
        <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
          Keranjang saat ini berisi {resumeOffer.stored.cart.length} produk. Pesanan ditahan
          yang dipilih (total tersimpan {formatIDR(resumeOffer.data.heldTotal)}) akan
          menggantikannya — pilih cara melanjutkan agar pekerjaan yang sedang berjalan tidak
          hilang.
        </p>
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
            onClick={resumeCancel}
            disabled={resumeHolding}
            className="h-9 w-full rounded-md px-3 text-[12px] text-muted-foreground hover:bg-muted disabled:opacity-50"
          >
            Batal — tetap di keranjang aktif
          </button>
        </div>
      </div>
    </div>
  );
}
