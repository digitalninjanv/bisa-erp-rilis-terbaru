import { requireAuth } from "@/lib/session";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_DETAIL_FIELDS = 32;
const MAX_DETAIL_VALUE_LENGTH = 256;
const RESERVED_FIELDS = new Set(["companyId", "userId", "event"]);

function scalarDetails(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value).slice(0, MAX_DETAIL_FIELDS)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,39}$/.test(key)) continue;
    if (RESERVED_FIELDS.has(key)) continue;
    if (item === null || typeof item === "boolean") result[key] = item;
    else if (typeof item === "string") result[key] = item.slice(0, MAX_DETAIL_VALUE_LENGTH);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }
  return result;
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Body JSON kosong.");

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Body melebihi batas telemetry POS.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth();
  } catch {
    return new Response(null, { status: 401 });
  }

  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return Response.json({ ok: false }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ ok: false }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ ok: false }, { status: 413 });
    return Response.json({ ok: false }, { status: 400 });
  }
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const event = typeof payload.event === "string" ? payload.event.trim().slice(0, 80) || "unknown" : "unknown";
  log.info("pos.client_event", {
    ...scalarDetails(payload.details),
    companyId: ctx.company.id,
    userId: ctx.user.id,
    event,
  });
  return Response.json({ ok: true });
}
