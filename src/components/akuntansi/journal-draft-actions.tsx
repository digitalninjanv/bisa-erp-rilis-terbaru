"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteJournalDraftAction,
  postJournalDraftAction,
} from "@/server/actions/accounting/jurnal";

/**
 * Aksi draf jurnal: review lalu posting, atau hapus. Draf tidak
 * menyentuh buku besar sampai diposting.
 */
export function JournalDraftActions({
  entryId,
  number,
}: {
  entryId: string;
  number: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"post" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function post() {
    setBusy("post");
    const result = await postJournalDraftAction({ entryId });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Draf ${number} diposting sebagai ${result.data.number}.`);
    router.push(`/app/akuntansi/jurnal/${result.data.id}`);
    router.refresh();
  }

  async function remove() {
    setConfirmDelete(false);
    setBusy("delete");
    const result = await deleteJournalDraftAction({ entryId });
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Draf ${number} dihapus.`);
    router.push("/app/akuntansi/jurnal/riwayat");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void post()}
        disabled={busy !== null}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
      >
        <CheckCircle2 className="size-3.5" />
        {busy === "post" ? "Memposting…" : "Posting draf"}
      </button>
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={busy !== null}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Trash2 className="size-3.5" />
        {busy === "delete" ? "Menghapus…" : "Hapus draf"}
      </button>
      <ConfirmDialog
        open={confirmDelete}
        title={`Hapus draf ${number}?`}
        description="Draf belum masuk buku besar. Setelah dihapus, isinya tidak dapat dipulihkan."
        confirmLabel="Hapus draf"
        danger
        busy={busy === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
