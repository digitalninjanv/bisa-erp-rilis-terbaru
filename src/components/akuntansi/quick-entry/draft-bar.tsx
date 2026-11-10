/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import { FilePenLine, Trash2 } from "lucide-react";
import { formatIDR } from "@/lib/money";
import { QUICK_ENTRY_KIND_LABELS, type QuickEntryPayload } from "@/lib/quick-entry";
import type { DraftRow } from "./form-state";

/** Bilah draf tersimpan di kepala form (muat/hapus draf server). */
export function DraftBar(props: {
  drafts: DraftRow[];
  selectedDraftId: string;
  setSelectedDraftId: (id: string) => void;
  applyPayload: (payload: QuickEntryPayload, draftId: string | null) => void;
  removeDraft: (id: string) => Promise<void>;
  editingDraftId: string | null;
}) {
  const { drafts, selectedDraftId, setSelectedDraftId, applyPayload, removeDraft, editingDraftId } = props;
  if (drafts.length === 0) return null;
  return (
        <div className="mb-3 flex flex-wrap items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-2">
          <FilePenLine className="size-3.5 text-muted-foreground" />
          <span className="text-[11px] font-medium">Draf tersimpan</span>
          <select
            value={selectedDraftId}
            onChange={(event) => setSelectedDraftId(event.target.value)}
            className="h-9 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-[11px]"
            aria-label="Pilih draf"
          >
            <option value="">— pilih draf —</option>
            {drafts.map((draft) => (
              <option key={draft.id} value={draft.id}>
                {QUICK_ENTRY_KIND_LABELS[draft.payload.kind] ?? draft.kind} · {draft.payload.date || "tanpa tanggal"}
                {draft.payload.amount ? ` · ${formatIDR(draft.payload.amount)}` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selectedDraftId}
            onClick={() => {
              const draft = drafts.find((row) => row.id === selectedDraftId);
              if (draft) applyPayload(draft.payload, draft.id);
            }}
            className="h-8 rounded border border-border bg-card px-2 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
          >
            Muat
          </button>
          <button
            type="button"
            disabled={!selectedDraftId}
            onClick={() => removeDraft(selectedDraftId)}
            className="grid size-8 place-items-center rounded border border-border bg-card text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            aria-label="Hapus draf terpilih"
          >
            <Trash2 className="size-3.5" />
          </button>
          {editingDraftId ? (
            <span className="w-full text-[11px] text-muted-foreground">
              Sedang melanjutkan draf — Posting akan menghapus draf ini; Simpan Draf memperbaruinya.
            </span>
          ) : null}
        </div>
  );
}
