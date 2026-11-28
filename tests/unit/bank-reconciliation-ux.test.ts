import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (relative: string) => readFileSync(path.join(ROOT, "src", relative), "utf8");

describe("UX rekonsiliasi bank", () => {
  it("form impor meminta saldo akhir koran dan tanggal cut-off", () => {
    const form = source("components/akuntansi/bank-reconciliation/import-form.tsx");
    expect(form).toContain("Saldo akhir rekening koran");
    expect(form).toContain("statementEndingBalance");
    expect(form).toContain("statementEndDate");
  });

  it("halaman menampilkan status rekonsiliasi dan riwayat impor yang bisa ditutup/dihapus", () => {
    const page = source("app/app/akuntansi/(akuntansi)/rekonsiliasi/page.tsx");
    expect(page).toContain("Status rekonsiliasi terakhir");
    expect(page).toContain("Riwayat impor mutasi");
    expect(page).toContain("getBookBalanceAsOf");
    expect(page).toContain("ImportStatementActions");
    const actions = source("components/akuntansi/bank-reconciliation/import-actions.tsx");
    expect(actions).toContain("markStatementImportReconciledAction");
    expect(actions).toContain("deleteStatementImportAction");
  });
});
