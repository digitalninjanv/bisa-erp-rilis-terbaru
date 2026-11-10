import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G3 (TBL-01/TBL-02, UX4-01/07/09/10 — Program Perbaikan Gabungan) —
 * pola daftar & tabel satu pintu.
 *
 * Penjaga permanen: permukaan yang sudah dimigrasi TIDAK BOLEH
 * kembali ke pola lama —
 *  1. Ukuran halaman daftar adalah SATU konstanta `LIST_PAGE_SIZE`
 *     di src/lib/pagination.ts; halaman terdaftar mengimpornya,
 *     bukan menulis angka setempat.
 *  2. Aksi baris daftar terdaftar berjalan lewat RowMenu bersama
 *     (⋯); tombol destruktif permanen per baris adalah temuan
 *     UX4-01 yang ditutup tahap ini. Tombol void satu-aksi memakai
 *     prop `asMenu` komponennya sendiri.
 *  3. Daftar yang tumbuh terdaftar mengisi slot `pagination`
 *     DataList dari bacaan server terpaginasi bernama (ARS1-01).
 *  4. Kepadatan daftar utama terdaftar adalah varian bersama
 *     `density="compact"` pada DataList — bukan padding per halaman.
 *  5. Keadaan kosong panel terdaftar memakai EmptyState bersama.
 *
 * Daftar ini SENGAJA hanya memuat titik yang benar-benar dimigrasi
 * di G3; pengecualian tertulis (aksi keputusan workflow, halaman
 * detail, AccountRowActions) tercatat di docs/form-crud/HASIL-G3.md.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function read(rel: string): string {
  const full = path.join(SRC_DIR, rel);
  expect(existsSync(full), `${rel} harus ada`).toBe(true);
  return readFileSync(full, "utf8");
}

/** Halaman daftar yang ukuran halamannya diselaraskan ke LIST_PAGE_SIZE. */
const LIST_PAGE_SIZE_PAGES = [
  "app/app/gudang/produk/page.tsx",
  "app/app/gudang/nilai/page.tsx",
  "app/app/gudang/pemasok/page.tsx",
  "app/app/gudang/reservasi/page.tsx",
  "app/app/gudang/purchase-request/page.tsx",
  "app/app/akuntansi/(akuntansi)/jurnal/page.tsx",
  "app/app/akuntansi/(akuntansi)/rekonsiliasi/page.tsx",
];

/** Komponen aksi baris yang bermigrasi ke RowMenu bersama. */
const ROW_MENU_SURFACES = [
  "components/gudang/partner-forms.tsx",
  "components/pengaturan/forms/gudang-cabang.tsx",
  "components/pengaturan/forms/metode-pembayaran.tsx",
  "components/pengaturan/user-access.tsx",
  "components/pengaturan/group-pricing.tsx",
  "components/akuntansi/hr/master-org.tsx",
  "components/akuntansi/hr/shifts.tsx",
  "components/akuntansi/hr/leave.tsx",
  "components/akuntansi/party-row-actions.tsx",
];

/** Tombol void satu-aksi yang wajib menawarkan varian menu (asMenu). */
const AS_MENU_VOID_BUTTONS = [
  "components/akuntansi/bank-transfer-form.tsx",
  "components/akuntansi/payroll-panel.tsx",
  "components/akuntansi/loan-panel.tsx",
  "components/akuntansi/advance-panel.tsx",
  "components/akuntansi/payment-form.tsx",
];

/** Daftar utama terukur UX4-09 yang memakai density compact bersama. */
const COMPACT_DENSITY_SURFACES = [
  "app/app/gudang/produk/page.tsx",
  "app/app/gudang/nilai/page.tsx",
  "app/app/gudang/pergerakan/page.tsx",
  "app/app/gudang/pemasok/page.tsx",
  "app/app/akuntansi/(akuntansi)/akun/page.tsx",
  "app/app/akuntansi/(akuntansi)/jurnal/page.tsx",
  "app/app/akuntansi/(hr)/payroll/page.tsx",
  "components/akuntansi/period-manager.tsx",
];

describe("G3 pola daftar & tabel satu pintu", () => {
  it("LIST_PAGE_SIZE adalah konstanta tunggal bernilai 40 di lib/pagination", () => {
    expect(read("lib/pagination.ts")).toContain("export const LIST_PAGE_SIZE = 40");
  });

  it("halaman daftar terdaftar mengimpor LIST_PAGE_SIZE", () => {
    for (const rel of LIST_PAGE_SIZE_PAGES) {
      expect(read(rel), `${rel} harus mengimpor LIST_PAGE_SIZE`).toContain("LIST_PAGE_SIZE");
    }
  });

  it("komponen aksi baris terdaftar memakai RowMenu bersama", () => {
    for (const rel of ROW_MENU_SURFACES) {
      expect(read(rel), `${rel} harus mengimpor RowMenu bersama`).toContain(
        'from "@/components/blocks/row-menu"',
      );
    }
  });

  it("daftar pihak tidak lagi mengekspor PartnerRowActions tombol-permanen", () => {
    const partnerForms = read("components/gudang/partner-forms.tsx");
    expect(partnerForms).toContain("SupplierRowActions");
    expect(partnerForms).toContain("CustomerRowActions");
    expect(partnerForms).not.toContain("PartnerRowActions");
  });

  it("daftar dokumen stok memakai StockDocumentRowActions, bukan tombol void terbuka", () => {
    expect(read("components/gudang/void-buttons.tsx")).toContain("StockDocumentRowActions");
    for (const rel of [
      "app/app/gudang/opname/page.tsx",
      "app/app/gudang/penyesuaian/page.tsx",
      "app/app/gudang/transfer/page.tsx",
    ]) {
      const page = read(rel);
      expect(page, `${rel} harus memakai StockDocumentRowActions`).toContain(
        "StockDocumentRowActions",
      );
      expect(page, `${rel} tidak boleh lagi memakai StockDocumentVoidButton`).not.toContain(
        "StockDocumentVoidButton",
      );
    }
  });

  it("tombol void satu-aksi terdaftar menawarkan varian asMenu", () => {
    for (const rel of AS_MENU_VOID_BUTTONS) {
      expect(read(rel), `${rel} harus mendukung asMenu`).toContain("asMenu");
    }
  });

  it("bacaan server terpaginasi bernama tersedia untuk daftar yang tumbuh", () => {
    const parties = read("server/catalog/parties.ts");
    expect(parties).toContain("listSuppliersPage");
    expect(parties).toContain("listCustomersPage");
    const purchaseRequests = read("server/purchase-requests.ts");
    expect(purchaseRequests).toContain("listPurchaseRequestsPage");
    expect(purchaseRequests).toContain("countPurchaseRequestsByStatus");
    const reservations = read("server/reservations.ts");
    expect(reservations).toContain("listReservationsPage");
    expect(reservations).toContain("countReservationsSummary");
  });

  it("daftar reservasi & PR mengisi slot pagination DataList", () => {
    for (const rel of ["app/app/gudang/reservasi/page.tsx", "app/app/gudang/purchase-request/page.tsx"]) {
      expect(read(rel), `${rel} harus merender Pagination`).toContain("<Pagination");
    }
  });

  it("kepadatan compact adalah varian DataList + aturan terlingkup di globals.css", () => {
    expect(read("components/blocks/data-list.tsx")).toContain('density?: "comfortable" | "compact"');
    expect(read("app/globals.css")).toContain(".data-list--compact");
    for (const rel of COMPACT_DENSITY_SURFACES) {
      expect(read(rel), `${rel} harus memakai density="compact"`).toContain('density="compact"');
    }
  });

  it("keadaan kosong panel terdaftar memakai EmptyState compact bersama", () => {
    const home = read("app/app/page.tsx");
    expect(home).toContain('size="compact"');
    expect(home).toContain("Belum ada transaksi.");
    const terminal = read("app/app/pos/terminal/page.tsx");
    expect(terminal.match(/size="compact"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
