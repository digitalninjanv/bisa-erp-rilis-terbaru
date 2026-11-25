import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

// A-24 T6B — kontrak perilaku service worker terminal POS
// (public/pos-sw.js, scope pendaftaran tepat "/app/pos" — lihat
// komentar kepala berkas itu soal jebakan garis-miring scope).
// SW dimuat ke dalam vm dengan global
// peramban yang dimock (self/caches/fetch) dan peristiwa
// install/activate/fetch disimulasikan, supaya kontrak pengerasan
// PWA terbukti sebagai PERILAKU, bukan sekadar isi berkas:
// - hanya navigasi dokumen /app/pos yang dicegat (network-first,
//   jatuh ke cache saat jaringan gagal);
// - aset statis /_next/static cache-first (immutable ber-hash);
// - POST (Server Action), permintaan RSC, API, dan navigasi modul
//   lain TIDAK PERNAH dicegat — data bisnis tidak pernah disajikan
//   dari cache sebagai data segar;
// - salinan dokumen yang disimpan dibersihkan dari header sesi
//   (Set-Cookie) dan header yang menolak penyimpanan.

const SW_PATH = path.join(__dirname, "..", "..", "public", "pos-sw.js");
const ORIGIN = "http://localhost:3000";
const SHELL_CACHE_ID = "11111111-1111-4111-8111-111111111111";
const SHELL_CACHE_URL = `${ORIGIN}/app/pos?posuid=${SHELL_CACHE_ID}`;

type Handler = (event: never) => void;

class MockCache {
  store = new Map<string, Response>();
  async put(key: string | { url: string }, response: Response) {
    const url = typeof key === "string" ? new URL(key, ORIGIN).toString() : key.url;
    this.store.set(url, response);
  }
  async match(key: string | { url: string }) {
    const url = typeof key === "string" ? new URL(key, ORIGIN).toString() : key.url;
    return this.store.get(url);
  }
  async delete(key: string | { url: string }) {
    const value = typeof key === "string" ? key : key.url;
    return this.store.delete(new URL(value, ORIGIN).toString());
  }
  async keys() {
    return [...this.store.keys()].map((url) => new Request(url));
  }
  async add(url: string) {
    const res = await this.fetchFn(new Request(url));
    if (!res.ok) throw new Error(`cache.add gagal: ${url}`);
    await this.put(url, res);
  }
  constructor(private fetchFn: typeof fetch) {}
}

function loadSw(fetchImpl: typeof fetch, cacheId: string | null = SHELL_CACHE_ID) {
  const handlers = new Map<string, Handler>();
  const cachesByName = new Map<string, MockCache>();
  const cachesMock = {
    async open(name: string) {
      let cache = cachesByName.get(name);
      if (!cache) {
        cache = new MockCache(fetchImpl);
        cachesByName.set(name, cache);
      }
      return cache;
    },
    async keys() {
      return [...cachesByName.keys()];
    },
    async delete(name: string) {
      return cachesByName.delete(name);
    },
    async match(key: string | { url: string }) {
      for (const cache of cachesByName.values()) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const state = { skipWaiting: false, claimed: false };
  const sandbox: Record<string, unknown> = {
    addEventListener: (type: string, fn: Handler) => handlers.set(type, fn),
    skipWaiting: () => {
      state.skipWaiting = true;
      return Promise.resolve();
    },
    clients: {
      claim: () => {
        state.claimed = true;
        return Promise.resolve();
      },
    },
    caches: cachesMock,
    cookieStore: {
      get: vi.fn(async (options: { name: string; url: string }) => {
        expect(options.name).toBe("pos_shell_cache_id");
        expect(options.url).toBe(`${ORIGIN}/app/pos`);
        return cacheId ? { name: options.name, value: cacheId } : null;
      }),
    },
    location: { origin: ORIGIN },
    fetch: fetchImpl,
    URL,
    Headers,
    Request,
    Response,
    console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SW_PATH, "utf8"), sandbox);
  return { handlers, cachesByName, state };
}

function lifecycleEvent() {
  const waits: Promise<unknown>[] = [];
  return {
    waits,
    waitUntil(p: Promise<unknown>) {
      waits.push(p);
    },
    async settle() {
      await Promise.all(waits);
    },
  };
}

function fetchEvent(request: {
  url: string;
  method?: string;
  mode?: string;
  headers?: Record<string, string>;
}) {
  let responsePromise: Promise<Response> | undefined;
  const event = {
    request: {
      url: request.url,
      method: request.method ?? "GET",
      mode: request.mode ?? "cors",
      headers: new Headers(request.headers ?? {}),
    },
    respondWith(p: Promise<Response>) {
      responsePromise = p;
    },
    waitUntil() {},
    get responded() {
      return responsePromise !== undefined;
    },
    async response() {
      return responsePromise;
    },
  };
  return event;
}

const TERMINAL_HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="/_next/static/css/abc123.css">
<script src="/_next/static/chunks/main-def456.js" async></script>
</head><body><div>Terminal POS</div>
<script src="/_next/static/chunks/app/app/pos/page-789.js" async></script>
</body></html>`;

function htmlResponse(body: string, extraHeaders: Record<string, string> = {}) {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", ...extraHeaders },
  });
}

describe("service worker terminal POS (T6B)", () => {
  it("install: mem-precache aset statis (dokumen ditunda sampai uid sesi tersedia), lalu skipWaiting", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("/app/pos")) return htmlResponse(TERMINAL_HTML);
      if (url.includes("/_next/static/")) return new Response("asset", { status: 200 });
      throw new Error(`fetch tak terduga: ${url}`);
    });
    const { handlers, cachesByName, state } = loadSw(fetchMock as unknown as typeof fetch);
    const event = lifecycleEvent();
    handlers.get("install")!(event as never);
    await event.settle();
    expect(state.skipWaiting).toBe(true);
    const all = [...cachesByName.values()].flatMap((c) => [...c.store.keys()]);
    expect(all).not.toContain(`${ORIGIN}/app/pos`);
    expect(all.some((u) => u.includes("/_next/static/css/abc123.css"))).toBe(true);
    expect(all.some((u) => u.includes("/_next/static/chunks/main-def456.js"))).toBe(true);
    expect(all.some((u) => u.includes("/_next/static/chunks/app/app/pos/page-789.js"))).toBe(true);
  });

  it("activate: menghapus cache versi lama dan mengklaim klien", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(TERMINAL_HTML));
    const { handlers, cachesByName, state } = loadSw(fetchMock as unknown as typeof fetch);
    // Tanam cache versi lama sebelum activate.
    const names = [...cachesByName.keys()];
    expect(names.length).toBe(0);
    const sandboxCaches = cachesByName;
    sandboxCaches.set("bisa-pos-shell-v0", new MockCache(fetchMock as unknown as typeof fetch));
    const event = lifecycleEvent();
    handlers.get("activate")!(event as never);
    await event.settle();
    expect(state.claimed).toBe(true);
    expect([...cachesByName.keys()]).not.toContain("bisa-pos-shell-v0");
  });

  it("navigasi /app/pos online: cache diidentifikasi oleh header server tanpa membaca Cookie request", async () => {
    const fetchMock = vi.fn(async () =>
      htmlResponse(TERMINAL_HTML, {
        "Set-Cookie": "better-auth.session_token=rahasia; HttpOnly",
        "x-pos-shell-cache-id": SHELL_CACHE_ID,
      }),
    );
    const { handlers, cachesByName } = loadSw(fetchMock as unknown as typeof fetch);
    const event = fetchEvent({
      url: `${ORIGIN}/app/pos`,
      mode: "navigate",
    });
    handlers.get("fetch")!(event as never);
    expect(event.responded).toBe(true);
    const res = await event.response();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("Terminal POS");
    const cached = [...cachesByName.values()]
      .flatMap((c) => [...c.store.entries()])
      .find(([url]) => url === SHELL_CACHE_URL);
    expect(cached, "dokumen harus tersimpan dengan ID non-otorisasi dari respons").toBeTruthy();
    expect(cached![1].headers.get("set-cookie")).toBeNull();
    expect(cached![1].headers.get("x-pos-shell-cache-id")).toBeNull();
  });

  it("navigasi /app/pos saat jaringan mati: dokumen dari cache yang membuka terminal", async () => {
    let online = true;
    const fetchMock = vi.fn(async () => {
      if (!online) throw new TypeError("fetch failed");
      return htmlResponse(TERMINAL_HTML, { "x-pos-shell-cache-id": SHELL_CACHE_ID });
    });
    const { handlers } = loadSw(fetchMock as unknown as typeof fetch);
    const first = fetchEvent({
      url: `${ORIGIN}/app/pos`,
      mode: "navigate",
    });
    handlers.get("fetch")!(first as never);
    await first.response();
    online = false;
    const second = fetchEvent({
      url: `${ORIGIN}/app/pos`,
      mode: "navigate",
    });
    handlers.get("fetch")!(second as never);
    const res = await second.response();
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain("Terminal POS");
  });

  it("membuang dokumen kasir ketika sesi ditolak oleh server", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse(TERMINAL_HTML, { "x-pos-shell-cache-id": SHELL_CACHE_ID }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { handlers, cachesByName } = loadSw(fetchMock as typeof fetch);
    const navigate = async () => {
      const event = fetchEvent({
        url: `${ORIGIN}/app/pos`,
        mode: "navigate",
      });
      handlers.get("fetch")!(event as never);
      return event.response();
    };
    expect((await navigate())?.status).toBe(200);
    expect((await navigate())?.status).toBe(401);
    expect([...cachesByName.values()].flatMap((cache) => [...cache.store.keys()])).toEqual([]);
  });

  it("membuang semua shell tersimpan saat autentikasi ditolak tanpa cache cookie", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(htmlResponse(TERMINAL_HTML, { "x-pos-shell-cache-id": SHELL_CACHE_ID }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    const { handlers, cachesByName } = loadSw(fetchMock as typeof fetch, null);
    const navigate = async () => {
      const event = fetchEvent({ url: `${ORIGIN}/app/pos`, mode: "navigate" });
      handlers.get("fetch")!(event as never);
      return event.response();
    };

    expect((await navigate())?.status).toBe(200);
    expect((await navigate())?.status).toBe(401);
    expect([...cachesByName.values()].flatMap((cache) => [...cache.store.keys()])).toEqual([]);
  });

  it("navigasi /app/pos berparameter (?resume=) memperbarui cache uid kanonis", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(TERMINAL_HTML, { "x-pos-shell-cache-id": SHELL_CACHE_ID }));
    const { handlers, cachesByName } = loadSw(fetchMock as unknown as typeof fetch);
    const event = fetchEvent({
      url: `${ORIGIN}/app/pos?resume=abc`,
      mode: "navigate",
    });
    handlers.get("fetch")!(event as never);
    await event.response();
    const all = [...cachesByName.values()].flatMap((c) => [...c.store.keys()]);
    expect(all).toEqual([SHELL_CACHE_URL, `${ORIGIN}/__pos_shell_cache_id`]);
  });

  it("tanpa cookie uid, dokumen tidak disimpan maupun disajikan dari cache", async () => {
    let online = true;
    const fetchMock = vi.fn(async () => {
      if (!online) throw new TypeError("fetch failed");
      return htmlResponse(TERMINAL_HTML);
    });
    const { handlers, cachesByName } = loadSw(fetchMock as unknown as typeof fetch, null);
    const first = fetchEvent({ url: `${ORIGIN}/app/pos`, mode: "navigate" });
    handlers.get("fetch")!(first as never);
    await first.response();
    expect([...cachesByName.values()].flatMap((c) => [...c.store.keys()])).toEqual([]);
    online = false;
    const second = fetchEvent({ url: `${ORIGIN}/app/pos`, mode: "navigate" });
    handlers.get("fetch")!(second as never);
    await expect(second.response()).rejects.toThrow("fetch failed");
  });

  it("POST ke /app/pos (Server Action checkout/sinkron) TIDAK dicegat", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(TERMINAL_HTML));
    const { handlers } = loadSw(fetchMock as unknown as typeof fetch);
    const event = fetchEvent({ url: `${ORIGIN}/app/pos`, method: "POST", mode: "cors" });
    handlers.get("fetch")!(event as never);
    expect(event.responded).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("permintaan RSC (bukan navigasi) ke /app/pos TIDAK dicegat", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(TERMINAL_HTML));
    const { handlers } = loadSw(fetchMock as unknown as typeof fetch);
    const event = fetchEvent({ url: `${ORIGIN}/app/pos?_rsc=xyz`, method: "GET", mode: "cors" });
    handlers.get("fetch")!(event as never);
    expect(event.responded).toBe(false);
  });

  it("navigasi modul lain (/app/gudang) dan API TIDAK dicegat", async () => {
    const fetchMock = vi.fn(async () => htmlResponse(TERMINAL_HTML));
    const { handlers } = loadSw(fetchMock as unknown as typeof fetch);
    for (const req of [
      { url: `${ORIGIN}/app/gudang`, mode: "navigate" },
      { url: `${ORIGIN}/app/pos/riwayat`, mode: "navigate" },
      { url: `${ORIGIN}/api/health`, mode: "cors" },
      { url: `${ORIGIN}/login`, mode: "navigate" },
    ]) {
      const event = fetchEvent(req);
      handlers.get("fetch")!(event as never);
      expect(event.responded, `${req.url} tidak boleh dicegat`).toBe(false);
    }
  });

  it("aset /_next/static cache-first: kunjungan kedua tanpa jaringan", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return new Response("chunk-js", { status: 200, headers: { "Content-Type": "text/javascript" } });
    });
    const { handlers } = loadSw(fetchMock as unknown as typeof fetch);
    const url = `${ORIGIN}/_next/static/chunks/main-def456.js`;
    const first = fetchEvent({ url, mode: "cors" });
    handlers.get("fetch")!(first as never);
    expect(await (await first.response())!.text()).toBe("chunk-js");
    const second = fetchEvent({ url, mode: "cors" });
    handlers.get("fetch")!(second as never);
    expect(await (await second.response())!.text()).toBe("chunk-js");
    expect(calls).toBe(1);
  });
});
