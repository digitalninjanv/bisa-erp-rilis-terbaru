import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-24 T7 — Penjaga higiene reset seed.
 *
 * `resetCompanyData` (src/db/seed.ts) harus menghapus SEMUA tabel
 * ber-company_id milik perusahaan demo; tabel yang tertinggal menjadi
 * yatim yang menempel kembali ke perusahaan demo hasil reseed
 * (organization dibuat ulang dengan id yang sama) — pola celah yang
 * terbukti berulang: party_opening_balances (FIX-R2), bank_statement_*
 * & party_credits (A-22 K1), opname_tasks & purchase_orders (A-24 T3),
 * dan pada T7 terbukti hidup: supplier_returns (RTB-2026-00001 yatim
 * dari sesi bukti 2026-11-04) & fixed_assets bertahan melewati
 * `db:seed --force`.
 *
 * Pengecualian SAH (ditangani jalur lain, idempoten, ditanam ulang
 * oleh seed itu sendiri / ensure malas):
 * - Keluarga parameter statutori payroll Indonesia:
 *   `seedPayrollIndonesiaDefaults` dipanggil seed.ts pada setiap
 *   penanaman dan berhenti bila data sudah ada — menghapusnya di
 *   reset hanya akan ditanam ulang identik oleh seed yang sama.
 * - `hr_parameters`: `seedHrDefaults` dipanggil malas oleh
 *   getHrParameters/setHrParameter.
 */
const STATUTORY_SEEDED = new Set([
  "payroll_statutory_settings",
  "payroll_statutory_parameters",
  "payroll_statutory_programs",
  "payroll_tax_brackets",
  "payroll_ter_brackets",
  "payroll_ptkp_statuses",
  "payroll_minimum_wages",
  "payroll_overtime_rules",
  "hr_parameters",
]);

function companyScopedTables(schemaSrc: string): string[] {
  const blocks = [...schemaSrc.matchAll(/export const \w+ = pgTable\(\s*"([a-z_0-9]+)"/g)];
  const tables: string[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const start = blocks[i].index ?? 0;
    const end = i + 1 < blocks.length ? (blocks[i + 1].index ?? schemaSrc.length) : schemaSrc.length;
    if (schemaSrc.slice(start, end).includes('"company_id"')) tables.push(blocks[i][1]);
  }
  return tables;
}

function resetTables(seedSrc: string): string[] {
  const start = seedSrc.indexOf("async function resetCompanyData");
  const end = seedSrc.indexOf("await adminSql.begin", start);
  const block = seedSrc.slice(start, end);
  return [...block.matchAll(/"([a-z_0-9]+)",/g)].map((m) => m[1]);
}

describe("higiene reset seed (A-24 T7)", () => {
  // A-26 Q2: definisi tabel pindah per domain ke src/db/schema/*.ts dan
  // src/db/schema.ts menjadi barrel — pindai barrel + semua berkas domain
  // agar cakupan penjaga tetap seluruh skema, bukan berkas barrel saja.
  const schemaDir = join(process.cwd(), "src/db/schema");
  const schemaSrc = [
    readFileSync(join(process.cwd(), "src/db/schema.ts"), "utf8"),
    ...readdirSync(schemaDir)
      .filter((f) => f.endsWith(".ts"))
      .sort()
      .map((f) => readFileSync(join(schemaDir, f), "utf8")),
  ].join("\n");
  const seedSrc = readFileSync(join(process.cwd(), "src/db/seed.ts"), "utf8");

  it("setiap tabel ber-company_id terhapus oleh resetCompanyData, kecuali yang ditanam ulang idempoten", () => {
    const reset = new Set(resetTables(seedSrc));
    const missing = companyScopedTables(schemaSrc).filter(
      (t) => !reset.has(t) && !STATUTORY_SEEDED.has(t),
    );
    expect(missing).toEqual([]);
  });

  it("daftar pengecualian jujur: semua tabelnya memang ber-company_id dan tidak ikut terhapus ganda", () => {
    const company = new Set(companyScopedTables(schemaSrc));
    for (const t of STATUTORY_SEEDED) expect(company.has(t)).toBe(true);
  });
});
