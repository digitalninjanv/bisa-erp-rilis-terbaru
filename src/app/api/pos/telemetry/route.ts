import { requireAuth } from "@/lib/session";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function scalarDetails(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_.-]{0,40}$/.test(key)) continue;
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      result[key] = item;
    }
  }
  return result;
}

export async function POST(request: Request) {
  let ctx: Awaited<ReturnType<typeof requireAuth>>;
  try {
    ctx = await requireAuth();
  } catch {
    return new Response(null, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }
  const payload = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const event = typeof payload.event === "string" ? payload.event.slice(0, 80) : "unknown";
  log.info("pos.client_event", {
    companyId: ctx.company.id,
    userId: ctx.user.id,
    event,
    ...scalarDetails(payload.details),
  });
  return Response.json({ ok: true });
}
