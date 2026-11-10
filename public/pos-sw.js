// A-24 T6B — Service worker terminal POS (pengerasan PWA terbatas).
//
// Berkas ini dilayani sebagai /pos-sw.js dan didaftarkan dengan
// scope TEPAT "/app/pos" oleh halaman terminal (hanya bila saklar
// offline perusahaan menyala — src/components/pwa/pos-service-worker.tsx).
// Penempatan di akar & scope tanpa garis-miring-akhir BUKAN selera:
// pencocokan scope peramban adalah pencocokan awalan string, jadi
// scope "/app/pos/" TIDAK PERNAH mengendalikan halaman terminal yang
// beralamat tepat "/app/pos" (terbukti empiris saat T6B — worker
// terdaftar & aktif tetapi nol halaman terkendali). Skrip di akar
// boleh mendaftar scope yang lebih sempit dari direktorinya.
// Konsekuensi prefix yang diterima sadar: rute hipotetis berawalan
// "/app/pos" (mis. "/app/posisi") ikut tercakup scope — tidak ada
// rute seperti itu, dan penangan fetch di bawah toh hanya menjawab
// dokumen terminal persis & aset statis; sisanya diteruskan.
//
// Kontrak cache (keputusan RENCANA T6B — jangan dilonggarkan):
// - HANYA dokumen terminal /app/pos dan aset statisnya yang di-cache.
//   Dokumen diperlakukan persis seperti model snapshot terminal:
//   network-first (jawaban jaringan selalu menang & memperbarui
//   cache); salinan cache hanya disajikan bila jaringan GAGAL —
//   tidak pernah sebagai "data segar".
// - Aset /_next/static/* bernama hash (immutable) cache-first.
// - Semua permintaan lain TIDAK dicegat sama sekali: POST Server
//   Action (checkout, sinkron antrean), permintaan RSC, API, dan
//   navigasi halaman lain berjalan langsung ke jaringan seperti
//   service worker tidak ada. Data bisnis tidak pernah di-cache.
// - Salinan yang disimpan dibersihkan dari Set-Cookie & header yang
//   menolak penyimpanan (halaman dinamis membawa no-store; Cache API
//   adalah simpanan eksplisit shell, bukan cache HTTP).
//
// Service worker hanya terdaftar pada secure context (HTTPS atau
// localhost) — batas itu ditegakkan peramban, bukan kode ini; pada
// http://IP LAN komponen pendaftar diam (feature detection).

const CACHE_NAME = "bisa-pos-shell-v1";
const CACHE_PREFIX = "bisa-pos-shell-";
const SHELL_PATH = "/app/pos";
const STATIC_PREFIX = "/_next/static/";
const META_PATHS = new Set(["/manifest.webmanifest", "/favicon.ico"]);
const ICON_PATTERN = /^\/icon-\d+\.png$/;

function isTerminalPath(pathname) {
  return pathname === SHELL_PATH || pathname === SHELL_PATH + "/";
}

// Salinan aman-simpan dari sebuah respons: badan yang sama, header
// sesi & penolak-cache dibuang. Dipakai untuk dokumen maupun aset.
async function cacheableCopy(response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.delete("cache-control");
  headers.delete("vary");
  const body = await response.clone().arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // Precache upaya-terbaik: dokumen terminal + aset statis yang
      // dirujuk HTML-nya, supaya reload pertama sesudah pendaftaran
      // pun sudah bisa dilayani cache. Kegagalan di sini tidak fatal
      // — pemanasan runtime pada kunjungan online menutup sisanya.
      try {
        const cache = await caches.open(CACHE_NAME);
        const res = await fetch(SHELL_PATH, { credentials: "include" });
        if (res && res.ok && !res.redirected) {
          const copy = await cacheableCopy(res);
          const html = await copy.clone().text();
          await cache.put(SHELL_PATH, copy);
          const assets = new Set();
          for (const match of html.matchAll(/\/_next\/static\/[A-Za-z0-9_\-./%]+/g)) {
            assets.add(match[0]);
          }
          await Promise.allSettled(
            [...assets].map(async (assetUrl) => {
              const asset = await fetch(assetUrl);
              if (asset && asset.ok) {
                await cache.put(assetUrl, await cacheableCopy(asset));
              }
            }),
          );
        }
      } catch {
        // Sengaja diam: precache gagal ≠ pendaftaran gagal.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// Dokumen terminal: jaringan dulu (segar + perbarui cache); cache
// hanya bila jaringan melempar (server mati / koneksi putus).
async function terminalDocument(request, cache) {
  try {
    const fresh = await fetch(request);
    // Respons hasil pengalihan (mis. sesi berakhir → /login) tidak
    // pernah disimpan sebagai shell terminal.
    if (fresh.ok && !fresh.redirected) {
      await cache.put(SHELL_PATH, await cacheableCopy(fresh));
    }
    return fresh;
  } catch (error) {
    const cached = await cache.match(SHELL_PATH);
    if (cached) return cached;
    throw error;
  }
}

// Aset immutable & metadata statis: cache dulu, jaringan bila kosong.
async function cacheFirst(request, cache) {
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const fresh = await fetch(request);
  if (fresh.ok) {
    await cache.put(request.url, await cacheableCopy(fresh));
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    if (!isTerminalPath(url.pathname)) return;
    event.respondWith(
      (async () => terminalDocument(request, await caches.open(CACHE_NAME)))(),
    );
    return;
  }

  if (
    url.pathname.startsWith(STATIC_PREFIX) ||
    META_PATHS.has(url.pathname) ||
    ICON_PATTERN.test(url.pathname)
  ) {
    event.respondWith(
      (async () => cacheFirst(request, await caches.open(CACHE_NAME)))(),
    );
  }
  // Sisanya tidak dicegat: perilaku peramban bawaan (jaringan).
});
