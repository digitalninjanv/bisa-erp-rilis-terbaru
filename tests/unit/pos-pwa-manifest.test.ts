import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

// A-24 T6B — manifest PWA terminal & kabel registrasi service worker.
// Manifest mengikuti konvensi file App Router Next (src/app/manifest.ts
// → /manifest.webmanifest, tertaut otomatis oleh Next). Registrasi SW
// hanya boleh terjadi dari halaman terminal, tergating saklar offline
// perusahaan, dengan scope tepat "/app/pos".

const ROOT = path.join(__dirname, "..", "..");

describe("manifest PWA terminal POS (T6B)", () => {
  const m = manifest();

  it("menunjuk terminal sebagai start_url dalam scope /app/pos", () => {
    expect(m.start_url).toBe("/app/pos");
    // Scope tanpa garis miring akhir: start_url harus berada di dalam
    // scope, dan registrasi SW memakai "/app/pos" yang sama.
    expect(m.scope).toBe("/app/pos");
    expect(m.display).toBe("standalone");
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
  });

  it("ikon 192 & 512 PNG benar-benar ada di public/", () => {
    const icons = m.icons ?? [];
    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      const file = path.join(ROOT, "public", icon.src.replace(/^\//, ""));
      expect(fs.existsSync(file), `${icon.src} harus ada di public/`).toBe(true);
      // Tanda tangan PNG.
      const head = fs.readFileSync(file).subarray(0, 4);
      expect([...head]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });
});

describe("kabel registrasi service worker (T6B)", () => {
  const component = fs.readFileSync(
    path.join(ROOT, "src", "components", "pwa", "pos-service-worker.tsx"),
    "utf8",
  );
  const page = fs.readFileSync(path.join(ROOT, "src", "app", "app", "pos", "page.tsx"), "utf8");

  it("komponen registrasi menunjuk pos-sw.js & membatasi scope tepat ke /app/pos", () => {
    expect(component).toContain('"/pos-sw.js"');
    // Scope TANPA garis miring akhir — "/app/pos/" tidak akan pernah
    // mengendalikan halaman beralamat tepat "/app/pos" (pencocokan
    // awalan string peramban; terbukti empiris di T6B).
    expect(component).toContain('scope: "/app/pos"');
    expect(component).not.toContain('scope: "/app/pos/"');
    // Peramban tanpa dukungan / konteks tidak aman: diam, bukan error.
    expect(component).toContain('"serviceWorker" in navigator');
  });

  it("halaman terminal memasang registrasi tergating saklar pos_offline_enabled", () => {
    expect(page).toContain("PosServiceWorker");
    expect(page).toContain("posOfflineEnabled");
  });
});
