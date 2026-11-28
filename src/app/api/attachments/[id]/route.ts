import { withApiError } from "@/lib/api-error";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermission } from "@/lib/session";
import { getAttachment } from "@/server/attachments";

export const runtime = "nodejs";

async function GETHandler(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requirePermission("accounting.view");
  const row = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getAttachment(tx, ctx.company.id, id),
  );
  const bytes = Buffer.from(row.contentBase64, "base64");
  const encoded = encodeURIComponent(row.fileName);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = withApiError(GETHandler);
