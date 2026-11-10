/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import { Save } from "lucide-react";

/** Kaki form: Batal / Simpan Draf / Posting. */
export function FormFooter(props: {
  onClose: () => void;
  saveDraft: () => Promise<void>;
  submit: () => Promise<void>;
  busyPost: boolean;
  busyDraft: boolean;
}) {
  const { onClose, saveDraft, submit, busyPost, busyDraft } = props;
  return (
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <p className="mr-auto hidden text-[11px] text-muted-foreground sm:block">
          Tekan N untuk membuka input cepat dari halaman Akuntansi mana pun.
        </p>
        <button
          type="button"
          onClick={onClose}
          disabled={busyPost || busyDraft}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={saveDraft}
          disabled={busyPost || busyDraft}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[12px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          <Save className="size-3.5" /> {busyDraft ? "Menyimpan…" : "Simpan Draf"}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busyPost || busyDraft}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {busyPost ? "Memposting…" : "✓ Posting"}
        </button>
      </div>
  );
}
