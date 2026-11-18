import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/db";
import { member, organization } from "@/db/schema";
import { pairAttemptAllowed, pairAttemptSource, recordPairFailure, resetPairFailures } from "@/lib/pair-throttle";
import { resolveOriginEntitlement } from "@/server/member-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyChoice = { id: string; name: string };

function mergeCookieHeader(current: string, updates: string[]): string {
  const values = new Map<string, string>();
  for (const part of current.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name && rest.length > 0) values.set(name, `${name}=${rest.join("=")}`);
  }
  for (const cookie of updates) {
    const pair = cookie.split(";", 1)[0]?.trim() ?? "";
    const [name, ...rest] = pair.split("=");
    if (!name || rest.length === 0) continue;
    const maxAgeZero = /(?:^|;)\s*max-age=0\s*(?:;|$)/i.test(cookie);
    if (maxAgeZero) values.delete(name);
    else values.set(name, pair);
  }
  return [...values.values()].join("; ");
}

function attachCookies(response: Response, cookies: string[]): Response {
  for (const cookie of cookies) response.headers.append("set-cookie", cookie);
  return response;
}

async function eligibleCompanies(userId: string): Promise<CompanyChoice[]> {
  const rows = await db
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId));
  const eligible: CompanyChoice[] = [];
  for (const row of rows) {
    const entitlement = await resolveOriginEntitlement(row.id, userId);
    if (entitlement?.canSell) eligible.push(row);
  }
  return eligible;
}

function jsonError(message: string, status: number) {
  return Response.json({ ok: false, message }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Native login bridge. Better Auth cookies are kept by the Rust caller
 * in memory while it completes 2FA/company selection, never by WebView
 * storage. This endpoint does not enroll a terminal or issue its token.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError("Asal permintaan tidak diizinkan.", 403);

  const source = pairAttemptSource(request);
  if (!pairAttemptAllowed(source)) return jsonError("Terlalu banyak percobaan masuk. Coba lagi beberapa menit.", 429);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Permintaan masuk tidak valid.", 400);
  }
  if (!body || typeof body !== "object") return jsonError("Permintaan masuk tidak valid.", 400);
  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().slice(0, 320) : "";
  const password = typeof input.password === "string" ? input.password : "";
  const code = typeof input.twoFactorCode === "string" ? input.twoFactorCode.trim() : "";
  const requestedCompanyId = typeof input.companyId === "string" ? input.companyId.trim() : "";
  const existingCookies = request.headers.get("cookie") ?? "";

  try {
    let authCookies: string[] = [];
    let userId: string | null = null;

    if (code) {
      if (!existingCookies) return jsonError("Sesi verifikasi sudah berakhir. Masuk kembali.", 401);
      const result = await auth.api.verifyTOTP({
        returnHeaders: true,
        body: { code, trustDevice: false },
        headers: request.headers,
      });
      authCookies = result.headers.getSetCookie();
      if ("twoFactorRedirect" in result.response && result.response.twoFactorRedirect) {
        recordPairFailure(source);
        return attachCookies(
          Response.json({ ok: true, data: { step: "twoFactor", methods: ["totp"] } }, { headers: { "Cache-Control": "no-store" } }),
          authCookies,
        );
      }
    } else if (existingCookies) {
      // The caller already completed password/2FA and is choosing a company.
      const session = await auth.api.getSession({ headers: request.headers });
      userId = session?.user.id ?? null;
      if (!userId) return jsonError("Sesi masuk sudah berakhir. Masuk kembali.", 401);
    } else {
      if (!email || password.length < 1 || password.length > 128) {
        return jsonError("Email dan kata sandi wajib diisi.", 400);
      }
      const result = await auth.api.signInEmail({
        returnHeaders: true,
        body: { email, password, rememberMe: false },
        headers: request.headers,
      });
      authCookies = result.headers.getSetCookie();
      if ("twoFactorRedirect" in result.response && result.response.twoFactorRedirect) {
        resetPairFailures(source);
        return attachCookies(
          Response.json({ ok: true, data: { step: "twoFactor", methods: ["totp"] } }, { headers: { "Cache-Control": "no-store" } }),
          authCookies,
        );
      }
    }

    const cookie = mergeCookieHeader(existingCookies, authCookies);
    const sessionHeaders = new Headers(request.headers);
    if (cookie) sessionHeaders.set("cookie", cookie);
    const session = await auth.api.getSession({ headers: sessionHeaders });
    userId = session?.user.id ?? userId;
    if (!userId || !session) {
      recordPairFailure(source);
      return jsonError("Email, kata sandi, atau kode verifikasi tidak benar.", 401);
    }

    const companies = await eligibleCompanies(userId);
    if (companies.length === 0) return jsonError("Akun ini belum memiliki akses kasir POS.", 403);
    if (requestedCompanyId && !companies.some((company) => company.id === requestedCompanyId)) {
      return jsonError("Perusahaan tidak tersedia untuk akun kasir ini.", 403);
    }
    resetPairFailures(source);
    return attachCookies(
      Response.json(
        {
          ok: true,
          data: {
            step: "authenticated",
            cashier: { id: session.user.id, name: session.user.name, email: session.user.email },
            companies,
            selectedCompanyId: requestedCompanyId || (companies.length === 1 ? companies[0].id : null),
          },
        },
        { headers: { "Cache-Control": "no-store" } },
      ),
      authCookies,
    );
  } catch {
    recordPairFailure(source);
    // Do not leak whether an account, password, or 2FA code was wrong.
    return jsonError("Email, kata sandi, atau kode verifikasi tidak benar.", 401);
  }
}
