import { describe, expect, it } from "vitest";
import { SETTINGS_NAV, settingsActiveHref } from "@/lib/settings-nav";

/**
 * A-24 T1 (SIS-11): nav cangkang netral Pengaturan. Kontrak: item tab
 * menunjuk query ?tab= yang benar-benar ada di halaman pengaturan,
 * item halaman menunjuk rute pengaturan yang ada, dan penentuan item
 * aktif eksak (tab bawaan = umum).
 */
describe("SETTINGS_NAV (SIS-11)", () => {
  it("memuat seksi pengaturan dan rute pengguna yang masuk navigasi", () => {
    const hrefs = SETTINGS_NAV.map((item) => item.href);
    expect(hrefs).toContain("/app/pengaturan?tab=umum");
    expect(hrefs).toContain("/app/pengaturan?tab=pembayaran");
    expect(hrefs).toContain("/app/pengaturan?tab=lokasi");
    expect(hrefs).toContain("/app/pengaturan?tab=cetak");
    expect(hrefs).toContain("/app/pengaturan?tab=modul");
    expect(hrefs).toContain("/app/pengaturan/pengguna");
    expect(hrefs).toContain("/app/pengaturan/payroll-indonesia");
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("item tab berpagar settings.manage; pengguna berpagar users.manage", () => {
    for (const item of SETTINGS_NAV) {
      if (item.href.startsWith("/app/pengaturan?")) {
        expect(item.permission).toBe("settings.manage");
      }
    }
    expect(SETTINGS_NAV.find((item) => item.href === "/app/pengaturan/pengguna")?.permission).toBe(
      "users.manage",
    );
    expect(SETTINGS_NAV.find((item) => item.href === "/app/pengaturan/payroll-indonesia")?.permission).toBe(
      "settings.manage",
    );

  });

  it("berkelompok (kepala grup tampil di sidebar)", () => {
    expect(new Set(SETTINGS_NAV.map((item) => item.group)).size).toBeGreaterThan(1);
  });
});

describe("settingsActiveHref (SIS-11)", () => {
  it("tab eksplisit menandai item tab itu", () => {
    expect(settingsActiveHref("/app/pengaturan", "pembayaran")).toBe(
      "/app/pengaturan?tab=pembayaran",
    );
  });

  it("tanpa parameter tab → Umum aktif (tab bawaan halaman)", () => {
    expect(settingsActiveHref("/app/pengaturan", null)).toBe("/app/pengaturan?tab=umum");
    expect(settingsActiveHref("/app/pengaturan", undefined)).toBe("/app/pengaturan?tab=umum");
  });

  it("tab tak dikenal → Umum (halaman sendiri jatuh ke umum)", () => {
    expect(settingsActiveHref("/app/pengaturan", "ngawur")).toBe("/app/pengaturan?tab=umum");
  });

  it("halaman anak menandai itemnya sendiri, termasuk turunan", () => {
    expect(settingsActiveHref("/app/pengaturan/pengguna", null)).toBe(
      "/app/pengaturan/pengguna",
    );
    expect(settingsActiveHref("/app/pengaturan/payroll-indonesia", null)).toBe(
      "/app/pengaturan/payroll-indonesia",
    );
  });

  it("di luar pengaturan → tidak ada yang aktif", () => {
    expect(settingsActiveHref("/app/gudang", null)).toBeNull();
  });
});
