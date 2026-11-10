import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BookOpen, Landmark } from "lucide-react";
import { SidebarFrame, SidebarCollapsedContext } from "@/components/shell/sidebar-frame";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { SettingsLayout } from "@/components/blocks/settings-layout";
import { parseSidebarCollapsedCookie } from "@/lib/sidebar-pref";
import { SETTINGS_NAV, settingsActiveHref } from "@/lib/settings-nav";
import { allStatementGroupsEmpty, isStatementGroupEmpty } from "@/lib/report-visibility";

/**
 * Validasi UI/UX Putaran 2 (V-01/V-02/V-06) — kontrak render yang
 * bisa dibuktikan tanpa browser:
 * - V-01: nav mode ciut merender tautan ikon-saja setinggi 44px
 *   dengan aria-label (label teks TIDAK dirender sebagai teks) dan
 *   lencana hitungan tetap tampil menempel ikon; bingkai membaca
 *   preferensi cookie di server (render pertama = mode akhir).
 * - Tooltip label pada mode ciut dirender Base UI secara malas
 *   (portal saat hover), jadi tidak muncul di markup statis —
 *   yang dibuktikan di sini adalah pemicu tooltip-nya: tautan
 *   ikon dengan aria-label penuh.
 * - V-02: SETTINGS_NAV lengkap 12 item (tidak ada item yatim
 *   sesudah daftar dalam-konten dibuang) dan SettingsLayout tanpa
 *   nav tidak merender daftar kedua, bilah simpan tetap ada.
 * - V-06: definisi "semua kelompok hampa" untuk keadaan kosong
 *   ringkas laporan.
 * Elemen ber-children dibangun dengan jsx() runtime — pola yang
 * sama dengan tests/integration/print-settings.test.ts (suite ini
 * hanya memuat berkas .ts).
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/akuntansi/kas-bank",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NAV_ITEMS = [
  { label: "Kas & bank", href: "/app/akuntansi/kas-bank", icon: Landmark },
  { label: "Buku besar", href: "/app/akuntansi/buku-besar", icon: BookOpen },
];
const BADGES = { "/app/akuntansi/kas-bank": { count: 3, tone: "amber" as const } };

describe("V-01 — sidebar mode ciut", () => {
  it("preferensi cookie: hanya nilai \"1\" yang berarti ciut", () => {
    expect(parseSidebarCollapsedCookie("1")).toBe(true);
    expect(parseSidebarCollapsedCookie("0")).toBe(false);
    expect(parseSidebarCollapsedCookie(undefined)).toBe(false);
    expect(parseSidebarCollapsedCookie("yes")).toBe(false);
    expect(parseSidebarCollapsedCookie("")).toBe(false);
  });

  it("bingkai merender mode akhir sejak render server (tanpa kedip)", () => {
    const collapsed = renderToStaticMarkup(
      jsx(SidebarFrame, {
        defaultCollapsed: true,
        hasPreference: true,
        footer: jsx("div", { children: "kaki" }),
        children: jsx("div", { children: "isi" }),
      }),
    );
    expect(collapsed).toContain('data-collapsed="true"');
    expect(collapsed).toContain("w-16");
    // Tombol pada mode ciut menawarkan melebarkan kembali.
    expect(collapsed).toContain('aria-label="Lebarkan sidebar"');
    expect(collapsed).toContain('aria-expanded="false"');

    const expanded = renderToStaticMarkup(
      jsx(SidebarFrame, {
        defaultCollapsed: false,
        hasPreference: true,
        footer: jsx("div", { children: "kaki" }),
        children: jsx("div", { children: "isi" }),
      }),
    );
    // React tidak menulis atribut data bernilai false — mode
    // kembang ditandai oleh TIDAK adanya penanda ciut + lebar penuh.
    expect(expanded).not.toContain('data-collapsed="true"');
    expect(expanded).toContain("Ciutkan sidebar");
    expect(expanded).toContain('aria-expanded="true"');
  });

  it("nav ciut: ikon-saja 44px, label hanya di aria-label, lencana tampil", () => {
    const html = renderToStaticMarkup(
      jsx(SidebarCollapsedContext.Provider, {
        value: true,
        children: createElement(SidebarNav, { items: NAV_ITEMS, badges: BADGES }),
      }),
    );
    // Target sentuh penuh (V-05) & nama aksesibel per item.
    expect(html).toContain("h-11");
    expect(html).toContain('aria-label="Buku besar"');
    // Label TIDAK dirender sebagai teks terlihat pada mode ciut.
    expect(html).not.toContain(">Buku besar<");
    // Lencana antrean tetap terlihat sebagai angka menempel ikon.
    expect(html).toContain(">3<");
    // Item aktif tetap tertanda untuk teknologi bantu.
    expect(html).toContain('aria-current="page"');
  });

  it("nav kembang: label teks tampil seperti sebelumnya", () => {
    const html = renderToStaticMarkup(
      jsx(SidebarCollapsedContext.Provider, {
        value: false,
        children: createElement(SidebarNav, { items: NAV_ITEMS, badges: BADGES }),
      }),
    );
    expect(html).toContain(">Buku besar<");
    // Lencana kembang = pil angka di ujung baris, seperti sebelumnya.
    expect(html).toContain(">3<");
  });
});

describe("V-02 — navigasi pengaturan satu pintu", () => {
  it("SETTINGS_NAV lengkap: 12 item, label & tujuan persis seperti sebelum daftar ganda dibuang", () => {
    expect(SETTINGS_NAV.map((item) => item.label)).toEqual([
      "Umum",
      "Pengguna & peran",
      "Payroll Indonesia",
      "Cetak",
      "Penomoran",
      "Metode pembayaran",
      "Kelompok harga",
      "Gudang & cabang",
      "Pemetaan akun",
      "Modul",
      "Kolom kustom",
      "Status sistem",
    ]);
    expect(SETTINGS_NAV.map((item) => item.href)).toEqual([
      "/app/pengaturan?tab=umum",
      "/app/pengaturan/pengguna",
      "/app/pengaturan/payroll-indonesia",
      "/app/pengaturan?tab=cetak",
      "/app/pengaturan?tab=nomor",
      "/app/pengaturan?tab=pembayaran",
      "/app/pengaturan?tab=grup",
      "/app/pengaturan?tab=lokasi",
      "/app/pengaturan?tab=akun",
      "/app/pengaturan?tab=modul",
      "/app/pengaturan?tab=kolom",
      "/app/pengaturan/status",
    ]);
    // Penanda aktif sidebar untuk rute & tab lama tetap sampai.
    expect(settingsActiveHref("/app/pengaturan/status", null)).toBe("/app/pengaturan/status");
    expect(settingsActiveHref("/app/pengaturan/pengguna", null)).toBe("/app/pengaturan/pengguna");
    expect(settingsActiveHref("/app/pengaturan/payroll-indonesia", null)).toBe(
      "/app/pengaturan/payroll-indonesia",
    );
    expect(settingsActiveHref("/app/pengaturan", "cetak")).toBe("/app/pengaturan?tab=cetak");
    expect(settingsActiveHref("/app/pengaturan", "nota")).toBe("/app/pengaturan?tab=cetak");
    expect(settingsActiveHref("/app/pengaturan", null)).toBe("/app/pengaturan?tab=umum");
  });

  it("SettingsLayout tanpa nav: tidak ada daftar kedua, bilah simpan tetap", () => {
    const html = renderToStaticMarkup(
      jsx(SettingsLayout, { children: jsx("p", { children: "Isi pengaturan" }) }),
    );
    expect(html).not.toContain('aria-label="Seksi pengaturan"');
    expect(html).not.toContain("lg:grid-cols-[220px_minmax(0,1fr)]");
    expect(html).toContain("Isi pengaturan");
    expect(html).toContain("Semua perubahan tersimpan");
  });

  it("SettingsLayout dengan nav (hub HR) tetap merender daftar seksinya", () => {
    const html = renderToStaticMarkup(
      jsx(SettingsLayout, {
        nav: [
          { id: "departemen", label: "Departemen" },
          { id: "jabatan", label: "Jabatan" },
        ],
        activeId: "departemen",
        children: jsx("p", { children: "Isi HR" }),
      }),
    );
    expect(html).toContain('aria-label="Seksi pengaturan"');
    expect(html).toContain('href="#departemen"');
  });
});

describe("V-06 — keadaan kosong ringkas laporan", () => {
  const zero = (accountId: string) => ({ accountId, amount: 0 });

  it("semua kelompok hampa (nol di kedua periode + saringan aktif) → ringkas", () => {
    const groups = [
      { current: [zero("a")], prior: [zero("a")] },
      { current: [], prior: [] },
    ];
    expect(allStatementGroupsEmpty(groups, true)).toBe(true);
    expect(isStatementGroupEmpty([zero("a")], [zero("a")], true)).toBe(true);
  });

  it("satu mutasi di kelompok mana pun → struktur kelompok tampil", () => {
    const groups = [
      { current: [zero("a")], prior: [zero("a")] },
      { current: [{ accountId: "b", amount: 5 }], prior: [zero("b")] },
    ];
    expect(allStatementGroupsEmpty(groups, true)).toBe(false);
  });

  it("mutasi hanya di periode pembanding juga membuat kelompok tidak hampa", () => {
    const groups = [{ current: [zero("a")], prior: [{ accountId: "a", amount: 7 }] }];
    expect(allStatementGroupsEmpty(groups, true)).toBe(false);
  });

  it("tanpa saringan akun nol, baris nol tetap baris tampak → tidak hampa", () => {
    const groups = [{ current: [zero("a")], prior: [zero("a")] }];
    expect(allStatementGroupsEmpty(groups, false)).toBe(false);
  });
});
