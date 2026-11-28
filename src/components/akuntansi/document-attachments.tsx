"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Image as ImageIcon, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { deleteAttachmentAction } from "@/server/actions/attachments";
import { formatDateTime } from "@/lib/format";

export type AttachmentRow = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: Date | string;
};

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function DocumentAttachments({
  entityType,
  entityId,
  attachments,
  currentUserId,
  canDelete,
}: {
  entityType: "journal_entry" | "expense";
  entityId: string;
  attachments: AttachmentRow[];
  currentUserId: string;
  canDelete: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AttachmentRow | null>(null);

  async function upload() {
    if (!selected) {
      toast.error("Pilih berkas lampiran terlebih dahulu.");
      return;
    }
    if (selected.size > 5 * 1024 * 1024) {
      toast.error("Ukuran lampiran maksimal 5 MB.");
      return;
    }
    setUploading(true);
    const body = new FormData();
    body.set("entityType", entityType);
    body.set("entityId", entityId);
    body.set("file", selected);
    const response = await fetch("/api/attachments", { method: "POST", body });
    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string }
      | null;
    setUploading(false);
    if (!response.ok || !payload?.ok) {
      toast.error(payload?.error ?? "Lampiran gagal diunggah.");
      return;
    }
    toast.success("Lampiran diunggah.");
    setSelected(null);
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  async function remove(row: AttachmentRow) {
    setDeleting(row.id);
    const result = await deleteAttachmentAction({ id: row.id });
    setDeleting(null);
    setConfirmDelete(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Lampiran dihapus.");
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Paperclip className="size-3.5 text-muted-foreground" /> Lampiran bukti
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Invoice, kuitansi, atau bukti transfer. PNG/JPEG/WebP/PDF, maksimal 5 MB.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[11px] font-medium transition-colors hover:bg-muted">
            <Upload className="size-3.5" /> Pilih berkas
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="sr-only"
              onChange={(event) => setSelected(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            type="button"
            onClick={() => void upload()}
            disabled={!selected || uploading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-40"
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {uploading ? "Mengunggah…" : "Unggah"}
          </button>
        </div>
      </div>

      {attachments.length === 0 ? (
        <p className="px-4 py-4 text-[11px] text-muted-foreground">Belum ada lampiran.</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {attachments.map((row) => {
            const Icon = row.mimeType.startsWith("image/") ? ImageIcon : FileText;
            const canRemove = canDelete || row.uploadedBy === currentUserId;
            return (
              <li key={row.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-medium">{row.fileName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {sizeLabel(row.sizeBytes)} · {formatDateTime(row.createdAt)}
                  </p>
                </div>
                <a
                  href={`/api/attachments/${row.id}`}
                  className="inline-flex h-8 items-center rounded border border-border bg-card px-2 text-[11px] font-medium transition-colors hover:bg-muted"
                >
                  Unduh
                </a>
                {canRemove ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(row)}
                    disabled={deleting === row.id}
                    className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                  >
                    <Trash2 className="size-3" /> Hapus
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Hapus lampiran ${confirmDelete?.fileName ?? ""}?`}
        description="Lampiran dihapus dari dokumen ini. Tindakan tercatat di audit."
        confirmLabel="Hapus lampiran"
        danger
        busy={deleting !== null}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
