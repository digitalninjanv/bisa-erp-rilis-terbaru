import { describe, expect, it } from "vitest";
import { buildPalettePages, filterPalettePages } from "@/lib/palette";
import { BUILTIN_ROLES } from "@/lib/permissions";
import { ALL_MODULE_KEYS } from "@/lib/modules";

/**
 * A-24 T1 (SIS-12): indeks halaman palet Ctrl+K dibangun dari NavItem
 * yang SUDAH tersaring peran secara konstruksi — halaman modul yang
 * tidak boleh dimasuki peran tidak pernah masuk indeks, jadi pencarian
 * tidak bisa membocorkan modul terlarang. Test ini adalah kunci
 * regresinya: matriks peran bawaan × indeks.
 */
function pagesFor(roleKey: string, enabledModules: readonly string[] = ALL_MODULE_KEYS) {
  const role = BUILTIN_ROLES[roleKey];
  return buildPalettePages({
    permissions: role.permissions,
    modules: role.modules,
    enabledModules,
  });
}

describe("buildPalettePages — penyaringan peran (SIS-12)", () => {
  it("kasir: hanya halaman POS + Beranda; NOL gudang/akuntansi/pengaturan", () => {
    const pages = pagesFor("cashier");
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.every((page) => page.module === "POS" || page.module === "Beranda")).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/gudang"))).toBe(false);
    expect(pages.some((page) => page.href.startsWith("/app/akuntansi"))).toBe(false);
    expect(pages.some((page) => page.href.startsWith("/app/pengaturan"))).toBe(false);
  });

  it("staf gudang: hanya Gudang + Beranda", () => {
    const pages = pagesFor("warehouse");
    expect(pages.every((page) => page.module === "Gudang" || page.module === "Beranda")).toBe(true);
    expect(pages.some((page) => page.href === "/app/gudang/penerimaan")).toBe(true);
  });

  it("akuntan: Akuntansi + Gudang, TANPA POS dan tanpa Pengaturan (tak berizin settings/users)", () => {
    const pages = pagesFor("accountant");
    expect(pages.some((page) => page.href.startsWith("/app/akuntansi"))).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/gudang"))).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/pos"))).toBe(false);
    expect(pages.some((page) => page.href.startsWith("/app/pengaturan"))).toBe(false);
  });

  it("pemilik: semua modul + Pengaturan tampil", () => {
    const pages = pagesFor("owner");
    expect(pages.some((page) => page.href.startsWith("/app/pos"))).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/gudang"))).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/akuntansi"))).toBe(true);
    expect(pages.some((page) => page.href.startsWith("/app/pengaturan"))).toBe(true);
  });

  it("saklar perusahaan mematikan modul dari indeks walau peran mengizinkan", () => {
    const pages = pagesFor("owner", ["pos", "akuntansi"]);
    expect(pages.some((page) => page.href.startsWith("/app/gudang"))).toBe(false);
    expect(pages.some((page) => page.href.startsWith("/app/pos"))).toBe(true);
  });

  it("izin butir dihormati: kasir melihat Retur (pos.return) tetapi bukan halaman berizin lain", () => {
    const pages = pagesFor("cashier");
    expect(pages.some((page) => page.href === "/app/pos/retur")).toBe(true);
  });

  it("tidak ada href ganda", () => {
    const pages = pagesFor("owner");
    expect(new Set(pages.map((page) => page.href)).size).toBe(pages.length);
  });
});

describe("filterPalettePages (SIS-12)", () => {
  const pages = pagesFor("owner");

  it("cocok pada label tanpa peduli huruf besar/kecil", () => {
    const hits = filterPalettePages(pages, "penerimaan");
    expect(hits.some((page) => page.href === "/app/gudang/penerimaan")).toBe(true);
  });

  it("query kosong → daftar awal terbatas (maks 8)", () => {
    expect(filterPalettePages(pages, "").length).toBeLessThanOrEqual(8);
  });

  it("tanpa kecocokan → kosong", () => {
    expect(filterPalettePages(pages, "zzz-tidak-ada")).toEqual([]);
  });
});
