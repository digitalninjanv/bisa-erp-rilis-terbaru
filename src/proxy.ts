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

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const policy = contentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
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
