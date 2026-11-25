import { NextResponse, type NextRequest } from "next/server";

/**
 * SEC-013 — CSP dengan nonce per request untuk dokumen HTML.
 *
 * Nonce dibuat di sini, dikirim sebagai header request agar Next
 * menyisipkannya ke skrip framework/route, dan dipasang juga pada
 * response. `strict-dynamic` membuat chunk yang dimuat skrip ber-nonce
 * tetap tepercaya tanpa mendaftar setiap URL. `style-src` masih
 * 'unsafe-inline' karena Tailwind/recharts menyuntik <style>; temuan
 * SEC-013 spesifik `script-src`, yang kini tidak lagi 'unsafe-inline'.
 *
 * API dan aset statis tidak perlu CSP dokumen; keduanya dikecualikan
 * agar tidak menambah biaya per request gambar/JS.
 */
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    IS_DEVELOPMENT
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    // Style inline dipertahankan TANPA nonce: menurut CSP3 kehadiran
    // nonce membuat 'unsafe-inline' diabaikan, dan itu memblokir lebar
    // kolom <col style> serta style dinamis Tailwind/recharts. SEC-013
    // hanya meminta script-src tanpa 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    IS_DEVELOPMENT ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join("; ");
}

async function posShellUid(request: NextRequest): Promise<string | null> {
  const session = request.cookies
    .getAll()
    .find((cookie) => cookie.name.includes("session_token"));
  if (!session?.value) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(session.value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export async function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const policy = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);

  // Cookie hash sesi tetap HttpOnly. Service worker tidak dapat membaca
  // header Cookie pada FetchEvent, jadi shell memakai ID acak khusus cache
  // yang tidak pernah menjadi bukti autentikasi dan dibaca via Cookie Store.
  const isPosPath =
    request.nextUrl.pathname === "/app/pos" ||
    request.nextUrl.pathname.startsWith("/app/pos/");
  if (isPosPath || request.nextUrl.pathname === "/login") {
    const uid = await posShellUid(request);
    if (uid && isPosPath) {
      const existingSessionUid = request.cookies.get("pos_shell_uid")?.value;
      const existingCacheId = request.cookies.get("pos_shell_cache_id")?.value;
      const cacheIdIsValid = Boolean(existingCacheId && /^[0-9a-f-]{36}$/i.test(existingCacheId));
      const cacheId = existingSessionUid === uid && cacheIdIsValid
        ? existingCacheId!
        : crypto.randomUUID();
      response.cookies.set("pos_shell_uid", uid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/app/pos",
      });
      response.cookies.set("pos_shell_cache_id", cacheId, {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/app/pos",
      });
      response.headers.set("x-pos-shell-cache-id", cacheId);
    } else {
      response.cookies.set("pos_shell_uid", "", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/app/pos",
        maxAge: 0,
      });
      response.cookies.set("pos_shell_cache_id", "", {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/app/pos",
        maxAge: 0,
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Dokumen HTML saja: API, aset Next, favicon, dan prefetch tidak
    // memerlukan nonce dan tidak boleh menambah latensi.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
