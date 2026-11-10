import type { NextConfig } from "next";

// AUD-014 (Audit Produksi A4): header keamanan global. CSP disusun
// konservatif terhadap permukaan aplikasi yang nyata:
// - script 'unsafe-inline': App Router men-stream skrip inline
//   (self.__next_f) — tanpa infrastruktur nonce, menghilangkannya
//   mematahkan hidrasi.
// - style 'unsafe-inline': Tailwind + suntikan <style> recharts.
// - img data:/blob:: gambar QRIS perusahaan disimpan sebagai data URL;
//   pratinjau unggahan memakai blob URL.
// - font 'self': next/font meng-self-host berkas font saat build.
// Tidak ada websocket dan tidak ada sumber eksternal runtime lain di
// aplikasi, jadi connect-src cukup 'self'. HSTS diabaikan peramban
// pada HTTP polos (dev lokal) dan berlaku pada deployment HTTPS.
// Turbopack/React dev memakai eval() untuk rekonstruksi callstack & HMR.
// CSP produksi tetap tanpa 'unsafe-eval'; hanya development yang dilonggarkan
// agar terminal browser tidak dipenuhi error dan React DevTools tetap hidup.
const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      IS_DEVELOPMENT
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      // Dev: HMR/React refresh memakai WebSocket ke host yang sama.
      // Sebagian browser tidak mencocokkan ws:// dengan 'self', dan
      // kegagalan itu membuat halaman dev memuat ulang terus.
      IS_DEVELOPMENT ? "connect-src 'self' ws: wss:" : "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'self'",
    ].join("; "),
  },
];

// Tunnel publik (mis. Cloudflare Quick Tunnel) memakai hostname acak.
// Nilainya diberikan lewat ALLOWED_DEV_ORIGINS saat menjalankan dev
// server, dipisah koma, tanpa skema/port.
const EXTRA_DEV_ORIGINS = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // Dev-only: browser bisa membuka aplikasi lewat localhost, 127.0.0.1,
  // atau IP LAN (mis. dari perangkat lain). Next memblokir /_next/hmr
  // sebagai cross-origin bila hostname tidak terdaftar, dan halaman dev
  // lalu tampak "reload terus". Entri hanya hostname, tanpa skema/port.
  allowedDevOrigins: ["127.0.0.1", "192.168.0.244", "192.168.*.*", ...EXTRA_DEV_ORIGINS],
  // A-24 T6B: service worker terminal POS tidak boleh tersimpan di
  // cache HTTP — peramban harus selalu mengambil versi terbarunya
  // (pola yang dianjurkan panduan PWA Next untuk berkas worker).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        source: "/pos-sw.js",
        headers: [
          { key: "Content-Type", value: "text/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
  // A-24 T5: standalone output is the single release artifact for both
  // production install paths (Docker image and systemd tarball). Per the
  // self-hosting guide in node_modules/next/dist/docs, the build emits
  // .next/standalone with a minimal server.js; deploy tooling copies
  // public/ and .next/static into it. `next start` keeps working.
  output: "standalone",
  // ERP pages are request-time and tenant-scoped. Caching stays opt-in per query.
  cacheComponents: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
