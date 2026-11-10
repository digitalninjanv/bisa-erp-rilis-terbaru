"use client";

import { useRouter } from "next/navigation";
import { FilePenLine, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteQuickEntryDraftAction } from "@/server/actions/quick-entry";
import { formatIDR } from "@/lib/money";
import { QUICK_ENTRY_KIND_LABELS, type QuickEntryKind, type QuickEntryPayload } from "@/lib/quick-entry";

/**
 * A-12 (D-23): jembatan antara pemicu (tombol Beranda, panel Input
 * Cepat, seksi draf) dan host modal yang terpasang di layout Akuntansi.
 * Komunikasi lewat CustomEvent window agar pemicu tidak perlu tahu
 * keadaan modal.
 */
export const QUICK_ENTRY_OPEN_EVENT = "bisa:quick-entry-open";

export type QuickEntryOpenDetail = {
  kind?: QuickEntryKind;
  draftId?: string;
};

export function openQuickEntry(detail: QuickEntryOpenDetail = {}) {
  window.dispatchEvent(new CustomEvent<QuickEntryOpenDetail>(QUICK_ENTRY_OPEN_EVENT, { detail }));
}

export function QuickEntryButton() {
  return (
    <button
      type="button"
      onClick={() => openQuickEntry()}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
    >
      <Plus className="size-3.5" /> Catat Transaksi
      <kbd className="rounded bg-primary-foreground/20 px-1 text-[11px] font-semibold">N</kbd>
    </button>
  );
}

export type QuickEntryDraftSummary = {
  id: string;
  kind: string;
  payload: QuickEntryPayload;
  updatedAt: string;
};

/** Seksi kecil di Beranda Akuntansi — hanya dirender bila ada draf. */
export function QuickEntryDraftsSection({ drafts }: { drafts: QuickEntryDraftSummary[] }) {
  const router = useRouter();
  if (drafts.length === 0) return null;

  async function remove(id: string) {
    const result = await deleteQuickEntryDraftAction({ id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Draf dihapus.");
    router.refresh();
  }

  return (
    <section className="mb-3 rounded-lg border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <FilePenLine className="size-4 text-primary" />
        <div>
          <h2 className="text-[13px] font-semibold">Draf Catat Transaksi ({drafts.length})</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Entri cepat yang belum diposting — lanjutkan untuk menyelesaikan atau mempostingnya.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-border/70">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <span className="text-[12px] font-medium">
              {QUICK_ENTRY_KIND_LABELS[draft.payload.kind] ?? draft.kind}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {draft.payload.date || "tanpa tanggal"}
              {draft.payload.amount ? ` · ${formatIDR(draft.payload.amount)}` : ""}
              {draft.payload.notes ? ` · ${draft.payload.notes}` : ""}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => openQuickEntry({ draftId: draft.id })}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium transition-colors hover:bg-muted"
              >
                <Play className="size-3" /> Lanjutkan
              </button>
              <button
                type="button"
                onClick={() => remove(draft.id)}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="size-3" /> Hapus
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
