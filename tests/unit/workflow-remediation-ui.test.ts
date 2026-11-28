import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kontrak sumber untuk remediasi peta workflow: wiring UI yang mudah
 * hilang lagi tanpa browser. Perilaku domain tetap diuji di integration.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (relative: string) => readFileSync(path.join(ROOT, "src", relative), "utf8");

describe("remediasi wiring UI", () => {
  it("halaman Payroll Indonesia kembali merender form, bukan redirect", () => {
    const page = source("app/app/pengaturan/payroll-indonesia/page.tsx");
    expect(page).not.toContain("redirect(\"/app/pengaturan\")");
    expect(page).toContain("PayrollIndonesiaSettingsForm");
    expect(page).toContain("getPayrollIndonesiaSettingsData");
  });

  it("panel tutup buku menyediakan pembalikan jurnal penutup", () => {
    const panel = source("components/akuntansi/year-end-closing-panel.tsx");
    expect(panel).toContain("reverseYearEndClosingAction");
    expect(panel).toContain("Balik jurnal penutup");
  });

  it("tab Pemetaan akun disaring dengan accounting.manage", () => {
    const page = source("app/app/pengaturan/page.tsx");
    expect(page).toContain('row.key !== "akun" || can(ctx, "accounting.manage")');
  });

  it("quote offline POS membawa priceRules kelompok", () => {
    const page = source("app/app/pos/page.tsx");
    const terminal = source("components/pos/pos-terminal.tsx");
    expect(page).toContain("customerGroupPrices");
    expect(page).toContain("priceRules: priceRulesByGroup.get(group.id)");
    expect(terminal).toContain("priceRules: g?.priceRules");
  });

  it("company switcher tampil di mobile", () => {
    const switcher = source("components/shell/company-switcher.tsx");
    expect(switcher).not.toContain("hidden items-center sm:flex");
    expect(switcher).toContain("max-w-[120px]");
  });

  it("halaman Beban memakai daftar + void, bukan redirect", () => {
    const page = source("app/app/akuntansi/(akuntansi)/beban/page.tsx");
    expect(page).not.toContain("redirect(");
    expect(page).toContain("listExpenses");
    expect(page).toContain("ExpenseVoidButton");
  });

  it("pembayaran terakhir piutang/utang merender tombol void", () => {
    const page = source("app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx");
    expect(page).toContain("listRecentPartyPayments");
    expect(page).toContain("PartyPaymentVoidButton");
  });

  it("wizard payroll mengirim opsi server dan override kasbon", () => {
    const wizard = source("components/akuntansi/payroll-wizard.tsx");
    expect(wizard).toContain("acknowledgeMinWage");
    expect(wizard).toContain("finalPeriod");
    expect(wizard).toContain("advanceDeductions");
  });

  it("form karyawan menyimpan joinedAt dan field statutori", () => {
    const panel = source("components/akuntansi/payroll-panel.tsx");
    expect(panel).toContain("joinedAt");
    expect(panel).toContain("Data statutori, kontrak & struktur organisasi");
    expect(panel).toContain("ptkpStatus");
    expect(panel).toContain("jkkRiskClass");
  });

  it("setup produksi punya route dan action dengan gerbang database kosong", () => {
    expect(existsSync(path.join(ROOT, "src/app/setup/page.tsx"))).toBe(true);
    const action = source("server/actions/setup.ts");
    expect(action).toContain("assertDatabaseEmpty");
    expect(action).toContain("BISA_SETUP_TOKEN");
  });

  it("impor memakai gerbang modul gudang", () => {
    for (const file of [
      "server/actions/import/commit.ts",
      "server/actions/import/analyze.ts",
      "server/actions/import/rows.ts",
      "app/api/import/parse/route.ts",
    ]) {
      expect(source(file)).toContain('requirePermissionInModule("import.manage", "gudang")');
    }
  });

  it("2FA web punya halaman verifikasi dan pengaturan akun", () => {
    expect(existsSync(path.join(ROOT, "src/app/two-factor/page.tsx"))).toBe(true);
    expect(existsSync(path.join(ROOT, "src/app/app/keamanan/page.tsx"))).toBe(true);
    expect(source("lib/auth-client.ts")).toContain('new URL("/two-factor", window.location.origin)');
  });
});
