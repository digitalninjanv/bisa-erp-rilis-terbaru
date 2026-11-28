import { NextRequest } from "next/server";
import { withApiError } from "@/lib/api-error";
import { AppError } from "@/lib/errors";
import { withCompany } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { ATTACHMENT_MAX_BYTES, saveAttachment } from "@/server/attachments";

export const runtime = "nodejs";

async function POSTHandler(request: NextRequest) {
  const ctx = await requirePermission("accounting.post");
  const form = await request.formData();
  const file = form.get("file");
  const entityType = String(form.get("entityType") ?? "");
  const entityId = String(form.get("entityId") ?? "");
  if (!(file instanceof File)) {
    throw new AppError("VALIDATION", "Pilih berkas lampiran terlebih dahulu.");
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    throw new AppError("VALIDATION", "Ukuran lampiran maksimal 5 MB.");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) throw new AppError("VALIDATION", "Lampiran kosong.");
  const data = await withCompany(ctx.company.id, (tx) =>
    saveAttachment(tx, {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      entityType,
      entityId,
      fileName: file.name,
      mimeType: file.type,
      contentBase64: buffer.toString("base64"),
    }),
  );
  return Response.json({ ok: true, data });
}

export const POST = withApiError(POSTHandler);
