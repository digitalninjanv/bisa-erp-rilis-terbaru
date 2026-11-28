import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { attachments, expenses, journalEntries } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";

export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
] as const;

export type AttachmentEntityType = "journal_entry" | "expense";

export type AttachmentMeta = {
  id: string;
  entityType: string;
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string | null;
  createdAt: Date;
};

function cleanFileName(value: string): string {
  const trimmed = value.trim().replace(/[\\/]/g, "_");
  return (trimmed || "lampiran").slice(0, 160);
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new AppError("VALIDATION", "Isi lampiran tidak valid.");
  }
  const buffer = Buffer.from(normalized, "base64");
  if (buffer.length === 0) throw new AppError("VALIDATION", "Lampiran kosong.");
  return buffer;
}

async function assertEntity(
  tx: Tx,
  companyId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (entityType === "journal_entry") {
    const [row] = await tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.id, entityId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Jurnal tidak ditemukan.");
    return;
  }
  if (entityType === "expense") {
    const [row] = await tx
      .select({ id: expenses.id })
      .from(expenses)
      .where(and(eq(expenses.companyId, companyId), eq(expenses.id, entityId)))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND", "Beban tidak ditemukan.");
    return;
  }
  throw new AppError("VALIDATION", "Jenis dokumen lampiran tidak didukung.");
}

export async function saveAttachment(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    entityType: string;
    entityId: string;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  },
): Promise<AttachmentMeta> {
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new AppError(
      "VALIDATION",
      "Lampiran harus berupa PNG, JPEG, WebP, atau PDF.",
    );
  }
  const buffer = decodeBase64(input.contentBase64);
  if (buffer.length > ATTACHMENT_MAX_BYTES) {
    throw new AppError("VALIDATION", "Ukuran lampiran maksimal 5 MB.");
  }
  await assertEntity(tx, input.companyId, input.entityType, input.entityId);
  const fileName = cleanFileName(input.fileName);
  const [row] = await tx
    .insert(attachments)
    .values({
      companyId: input.companyId,
      entityType: input.entityType,
      entityId: input.entityId,
      fileName,
      mimeType: input.mimeType,
      sizeBytes: buffer.length,
      contentBase64: input.contentBase64.replace(/\s+/g, ""),
      uploadedBy: input.userId,
    })
    .returning({
      id: attachments.id,
      entityType: attachments.entityType,
      entityId: attachments.entityId,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      uploadedBy: attachments.uploadedBy,
      createdAt: attachments.createdAt,
    });
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "attachment.upload",
    entityType: input.entityType,
    entityId: input.entityId,
    after: { attachmentId: row.id, fileName, mimeType: input.mimeType, sizeBytes: buffer.length },
  });
  return row;
}

export async function listAttachments(
  tx: Tx,
  companyId: string,
  entityType: string,
  entityId: string,
): Promise<AttachmentMeta[]> {
  return tx
    .select({
      id: attachments.id,
      entityType: attachments.entityType,
      entityId: attachments.entityId,
      fileName: attachments.fileName,
      mimeType: attachments.mimeType,
      sizeBytes: attachments.sizeBytes,
      uploadedBy: attachments.uploadedBy,
      createdAt: attachments.createdAt,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.companyId, companyId),
        eq(attachments.entityType, entityType),
        eq(attachments.entityId, entityId),
      ),
    )
    .orderBy(desc(attachments.createdAt));
}

export async function getAttachment(tx: Tx, companyId: string, id: string) {
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(eq(attachments.companyId, companyId), eq(attachments.id, id)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Lampiran tidak ditemukan.");
  return row;
}

export async function deleteAttachment(
  tx: Tx,
  input: { companyId: string; userId: string; id: string; canManage: boolean },
): Promise<void> {
  const [row] = await tx
    .select()
    .from(attachments)
    .where(and(eq(attachments.companyId, input.companyId), eq(attachments.id, input.id)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Lampiran tidak ditemukan.");
  if (!input.canManage && row.uploadedBy !== input.userId) {
    throw new AppError("FORBIDDEN", "Lampiran hanya dapat dihapus oleh pengunggah atau pengelola akuntansi.");
  }
  await tx
    .delete(attachments)
    .where(and(eq(attachments.companyId, input.companyId), eq(attachments.id, input.id)));
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "attachment.delete",
    entityType: row.entityType,
    entityId: row.entityId,
    before: { attachmentId: row.id, fileName: row.fileName },
  });
}
