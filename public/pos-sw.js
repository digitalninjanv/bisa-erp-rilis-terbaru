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

const CACHE_NAME = "bisa-pos-shell-v3";
const CACHE_PREFIX = "bisa-pos-shell-";
const SHELL_PATH = "/app/pos";
const SHELL_CACHE_ID_COOKIE = "pos_shell_cache_id";
const SHELL_CACHE_ID_HEADER = "x-pos-shell-cache-id";
const SHELL_CACHE_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const SHELL_CACHE_ID_META = "/__pos_shell_cache_id";
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
  headers.delete(SHELL_CACHE_ID_HEADER);
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
          const cacheId = res.headers.get(SHELL_CACHE_ID_HEADER);
          if (cacheId && SHELL_CACHE_ID_PATTERN.test(cacheId)) {
            const key = shellCacheKey(cacheId);
            await cache.put(key, copy.clone());
            await rememberShellCacheId(cache, cacheId);
            await deleteOtherShellDocuments(cache, key);
          }
          const html = await copy.clone().text();
          // Dokumen disimpan per cache ID dari header respons install;
          // runtime navigation memperbaruinya dengan salinan jaringan.
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

async function shellCacheIdFromCookieStore() {
  if (!self.cookieStore || typeof self.cookieStore.get !== "function") return null;
  try {
    const cookie = await self.cookieStore.get({
      name: SHELL_CACHE_ID_COOKIE,
      url: new URL(SHELL_PATH, self.location.origin).href,
    });
    return cookie && SHELL_CACHE_ID_PATTERN.test(cookie.value) ? cookie.value : null;
  } catch {
    return null;
  }
}

function shellCacheKey(cacheId) {
  return `${SHELL_PATH}?posuid=${encodeURIComponent(cacheId)}`;
}

async function rememberShellCacheId(cache, cacheId) {
  if (!cacheId || !SHELL_CACHE_ID_PATTERN.test(cacheId)) return;
  await cache.put(SHELL_CACHE_ID_META, new Response(cacheId));
}

async function shellCacheIdFromCache(cache) {
  const stored = await cache.match(SHELL_CACHE_ID_META);
  if (!stored) return null;
  const value = (await stored.text()).trim();
  return SHELL_CACHE_ID_PATTERN.test(value) ? value : null;
}

async function deleteOtherShellDocuments(cache, keepKey) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((key) => {
        const url = new URL(key.url);
        return url.pathname === SHELL_PATH && url.toString() !== new URL(keepKey, self.location.origin).toString();
      })
      .map((key) => cache.delete(key)),
  );
}

async function deleteShellDocuments(cache) {
  const keys = await cache.keys();
  await Promise.all(
    keys
      .filter((key) => new URL(key.url).pathname === SHELL_PATH)
      .map((key) => cache.delete(key)),
  );
}

// Dokumen terminal: jaringan dulu (segar + perbarui cache); cache
// hanya bila jaringan melempar (server mati / koneksi putus) DAN ID
// cache non-otorisasi masih cocok. Cookie sesi tetap HttpOnly dan tidak
// dibaca dari FetchEvent.request.headers (Cookie adalah header terlarang).
async function terminalDocument(request, cache) {
  const requestCacheId = (await shellCacheIdFromCookieStore()) ?? (await shellCacheIdFromCache(cache));
  const requestKey = requestCacheId ? shellCacheKey(requestCacheId) : null;
  try {
    const fresh = await fetch(request);
    // Respons hasil pengalihan (mis. sesi berakhir → /login) tidak
    // pernah disimpan sebagai shell terminal.
    if (fresh.ok && !fresh.redirected) {
      const responseCacheId = fresh.headers.get(SHELL_CACHE_ID_HEADER);
      if (responseCacheId && SHELL_CACHE_ID_PATTERN.test(responseCacheId)) {
        const key = shellCacheKey(responseCacheId);
        await cache.put(key, await cacheableCopy(fresh));
        await rememberShellCacheId(cache, responseCacheId);
        await deleteOtherShellDocuments(cache, key);
      }
    } else if (fresh.redirected || fresh.status === 401 || fresh.status === 403) {
      await deleteShellDocuments(cache).catch(() => undefined);
      await cache.delete(SHELL_CACHE_ID_META).catch(() => undefined);
    }
    return fresh;
  } catch (error) {
    const cached = requestKey ? await cache.match(requestKey) : null;
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

self.addEventListener("message", (event) => {
  const cacheId = event.data && event.data.type === "pos-shell-cache-id" ? event.data.cacheId : null;
  if (!cacheId || !SHELL_CACHE_ID_PATTERN.test(cacheId)) return;
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => rememberShellCacheId(cache, cacheId)),
  );
});

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
