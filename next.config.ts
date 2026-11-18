import type { NextConfig } from "next";

// AUD-014 (Audit Produksi A4): header keamanan global non-CSP.
// SEC-013: CSP dokumen dipindah ke src/proxy.ts karena memerlukan nonce
// per request; header di sini tidak lagi memasang CSP agar tidak ada
// dua kebijakan yang saling bertentangan.

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
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
  // Badge dev Next.js menutupi kontrol bawah-layar POS (bar bayar mobile
  // dan menu pengguna). Error kompilasi/runtime tetap tampil normal.
  devIndicators: false,
  // Keep disposable verification builds separate from a running local app.
  distDir: process.env.BISA_TEST_BUILD === "1" ? ".next-remediation" : ".next",
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
  // Runtime backup manifests live outside the release; never package DB dumps or local secrets.
  outputFileTracingExcludes: { "/*": ["./backups/**/*", "./.env*"] },
  // ERP pages are request-time and tenant-scoped. Caching stays opt-in per query.
  cacheComponents: false,
  // `pnpm build` runs the same TypeScript gate after Next generates route
  // types; keeping it out of the Turbopack build avoids overlapping peaks.
  typescript: { ignoreBuildErrors: true },
  // Dev only: discard inactive compiled pages to keep navigation across the
  // ERP's many routes from retaining every page module in the dev server.
  onDemandEntries: {
    maxInactiveAge: 25_000,
    pagesBufferLength: 2,
  },
  // Mitigasi memory leak Turbopack dev (Next 16.4.5):
  // - GC + memory eviction membuang pekerjaan yang tidak terjangkau.
  // - nonaktifkan Server Fast Refresh yang menyebabkan pertumbuhan RAM
  //   tak terbatas pada sesi panjang (#91396, #81161).
  experimental: {
    // Ada 101 route App Router; muat entry per permintaan agar proses
    // produksi tidak menahan seluruh modul halaman sejak server mulai.
    // Kunjungan pertama ke route yang jarang dipakai dapat sedikit lebih lambat.
    preloadEntriesOnStart: false,
    turbopackGc: true,
    turbopackMemoryEviction: "full",
    turbopackServerFastRefresh: false,
  },
  turbopack: {
    // Batasi Turbopack ke direktori aplikasi agar tidak memindai pohon
    // yang lebih luas (monorepo/parent) dan menahan cache yang tidak perlu.
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
