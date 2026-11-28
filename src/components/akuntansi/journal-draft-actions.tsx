"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { CheckCircle2, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  approveJournalDraftAction,
  deleteJournalDraftAction,
  postJournalDraftAction,
  rejectJournalDraftAction,
} from "@/server/actions/accounting/jurnal";

/**
 * Aksi draf jurnal: review lalu posting, atau hapus. Draf tidak
 * menyentuh buku besar sampai diposting.
 */
export function JournalDraftActions({
  entryId,
  number,
  approvalStatus,
  canApprove,
  isMaker,
  approvalNote,
}: {
  entryId: string;
  number: string;
  approvalStatus: string;
  canApprove: boolean;
  isMaker: boolean;
  approvalNote?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"post" | "delete" | "approve" | "reject" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

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

  async function approve() {
    setBusy("approve");
    const result = await approveJournalDraftAction({ entryId });
    setBusy(null);
    setConfirmApprove(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Draf ${number} disetujui dan diposting sebagai ${result.data.number}.`);
    router.push(`/app/akuntansi/jurnal/${result.data.id}`);
    router.refresh();
  }

  async function reject(note: string) {
    setBusy("reject");
    const result = await rejectJournalDraftAction({ entryId, note });
    setBusy(null);
    setConfirmReject(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Draf ${number} ditolak.`);
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

  const pending = approvalStatus === "pending";
  const rejected = approvalStatus === "rejected";
  const canDecide = pending && canApprove && !isMaker;

  return (
    <>
      {pending && !canDecide ? (
        <span className="inline-flex h-8 items-center rounded-md border border-tone-amber/30 bg-tone-amber-soft px-3 text-[11px] font-medium text-tone-amber">
          Menunggu persetujuan{isMaker ? " pengguna lain" : ""}
        </span>
      ) : null}
      {rejected ? (
        <span className="inline-flex h-8 items-center rounded-md border border-destructive/30 bg-destructive/5 px-3 text-[11px] font-medium text-destructive">
          Ditolak
        </span>
      ) : null}
      {canDecide ? (
        <>
          <button
            type="button"
            onClick={() => setConfirmApprove(true)}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <ShieldCheck className="size-3.5" />
            {busy === "approve" ? "Memposting…" : "Setujui & posting"}
          </button>
          <button
            type="button"
            onClick={() => setConfirmReject(true)}
            disabled={busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            <XCircle className="size-3.5" /> Tolak
          </button>
        </>
      ) : !pending && !rejected ? (
        <button
          type="button"
          onClick={() => void post()}
          disabled={busy !== null}
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          <CheckCircle2 className="size-3.5" />
          {busy === "post" ? "Memposting…" : "Posting draf"}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        disabled={busy !== null}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
      >
        <Trash2 className="size-3.5" />
        {busy === "delete" ? "Menghapus…" : "Hapus draf"}
      </button>
      {rejected && approvalNote ? (
        <p className="basis-full text-[11px] text-destructive">Alasan: {approvalNote}</p>
      ) : null}
      <ConfirmDialog
        open={confirmApprove}
        title={`Setujui dan posting ${number}?`}
        description="Jurnal masuk buku besar. Persetujuan tercatat di audit dan tidak dapat dibatalkan dari draf ini."
        confirmLabel="Setujui & posting"
        busy={busy === "approve"}
        onConfirm={() => void approve()}
        onCancel={() => setConfirmApprove(false)}
      />
      <ConfirmDialog
        open={confirmReject}
        title={`Tolak draf ${number}?`}
        description="Draf tetap tersimpan sebagai ditolak agar pembuat dapat melihat alasannya."
        confirmLabel="Tolak draf"
        danger
        busy={busy === "reject"}
        reason={{ label: "Alasan penolakan", minLength: 3 }}
        onConfirm={(note) => void reject(note)}
        onCancel={() => setConfirmReject(false)}
      />
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
