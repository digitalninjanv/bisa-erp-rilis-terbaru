import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-26 Q9 (K-09, kontrak §1.3) — pembeku penulis tabel bersama.
 *
 * Kontrak kepemilikan tulis ada di docs/MODULE_BOUNDARIES.md §6:
 * 22 tabel ditulis lebih dari satu domain/berkas secara sah
 * (penyelesaian pembayaran bersama, gabung pihak, klaim idempotensi
 * satu-transaksi, pola pastikan-ada, dst.). Test ini membekukan
 * himpunan berkas penulis per tabel itu PERSIS seperti kontraknya:
 *
 *  - berkas baru mulai menulis tabel bersama → suite GAGAL;
 *  - berkas berhenti menulis tabel bersama → suite GAGAL (anti basi);
 *  - tabel lain berubah menjadi ditulis ≥2 domain → suite GAGAL.
 *
 * Mengubah himpunan penulis secara sah = memperbarui §6
 * MODULE_BOUNDARIES.md DAN peta FROZEN di berkas ini dalam perubahan
 * yang sama, dengan alasan tertulis di dokumen.
 *
 * Metode pindai (disadari batasnya, sama dengan yang dipakai menyusun
 * kontrak): pola sintaktis `.insert/.update/.delete(<namaTabel>)`
 * atas seluruh src/. Semua tulis Drizzle di repo memakai pola ini
 * (terverifikasi Q9: tidak ada tulis lewat `schema.<tabel>` atau SQL
 * mentah di luar seed). `src/db/seed.ts` dikecualikan — ia menulis
 * semua tabel saat bootstrap demo, bukan jalur produksi. Pengecualian
 * yang sama berlaku untuk `src/db/seed-chart.ts` (A-27 B5): modul itu
 * adalah potongan bootstrap seed yang sama (blok bagan akun yang
 * diekstrak dari seed.ts demi ratchet ukuran), hanya dipanggil seed,
 * bukan jalur produksi. Pengecualian yang sama berlaku untuk
 * `src/db/seed-packaging.ts` (Satuan Kemasan S1, 2026-11-08): potongan
 * bootstrap seed yang sama kelasnya (penanam kemasan demo yang
 * diekstrak dari seed.ts demi ratchet ukuran), hanya dipanggil seed.
 * Penulis produksi tunggal `product_packagings` adalah
 * `server/catalog/packaging.ts` — satu pemilik, bukan tabel bersama,
 * jadi tidak masuk peta FROZEN §6. Bila suatu hari ada jalur tulis di
 * luar pola ini, kontrak §6-lah yang menilai, bukan test ini.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/**
 * Peta beku: nama variabel tabel skema → daftar berkas penulis
 * (relatif terhadap src/, terurut). Sumber kebenarannya adalah tabel
 * di MODULE_BOUNDARIES.md §6 — kedua tempat berubah bersama.
 */
const FROZEN: Record<string, string[]> = {
  // R3 K-2 (2026-11-08): pola pastikan-akun-sistem terpusat di
  // server/system-accounts.ts — fixed-assets/payment-deductions/
  // payroll-indonesia tidak lagi menulis accounts/accountMappings
  // langsung (fixed-assets tetap menulis accounts untuk penandaan
  // kontra A-27 B5). Alasan lengkap: MODULE_BOUNDARIES §6.
  accountMappings: [
    "server/accounting.ts",
    "server/actions/accounting/akun-pemetaan.ts",
    "server/coa-migration.ts",
    "server/import/commit.ts",
    "server/system-accounts.ts",
  ],
  accounts: [
    "server/accounting.ts",
    "server/actions/accounting/akun-pemetaan.ts",
    "server/coa-migration.ts",
    "server/fixed-assets.ts",
    "server/import/commit.ts",
    "server/system-accounts.ts",
  ],
  categories: [
    "server/actions/import/commit-phases.ts",
    "server/actions/inventory/taksonomi.ts",
    "server/import/commit.ts",
  ],
  customers: [
    "server/actions/inventory/pihak.ts",
    "server/actions/pos.ts",
    "server/actions/settings/kelompok-harga.ts",
    "server/import/commit.ts",
  ],
  expenses: [
    "server/expenses.ts",
    "server/master-data/merge.ts",
    "server/party-writeoffs.ts",
    "server/payables.ts",
  ],
  idempotencyKeys: ["server/idempotency.ts", "server/pos/receivables.ts", "server/pos/sales-create.ts"],
  partyCredits: ["server/master-data/merge.ts", "server/party-credits.ts"],
  partyOpeningBalances: [
    "server/master-data/merge.ts",
    "server/opening-balances/documents.ts",
    "server/opening-balances/payments.ts",
    "server/party-writeoffs.ts",
    "server/supplier-returns/payables.ts",
  ],
  partyPayments: [
    "server/actions/pos.ts",
    "server/master-data/merge.ts",
    "server/opening-balances/payments.ts",
    "server/party-writeoffs.ts",
    "server/payables.ts",
    "server/pos/receivables.ts",
    "server/pos/sales-void.ts",
  ],
  payrollMinimumWages: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  payrollPtkpStatuses: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  payrollStatutoryParameters: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  payrollStatutoryPrograms: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  payrollStatutorySettings: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  payrollTerBrackets: ["server/actions/payroll-indonesia.ts", "server/payroll-indonesia.ts"],
  products: [
    "server/actions/import/commit-phases.ts",
    "server/actions/inventory/produk.ts",
    "server/inventory/movements.ts",
    "server/inventory/receipt-prices.ts",
    "server/master-data/bulk-edit.ts",
    "server/master-data/merge.ts",
  ],
  purchaseAdvances: ["server/master-data/merge.ts", "server/purchase-advances.ts"],
  purchaseOrders: ["server/master-data/merge.ts", "server/purchasing.ts"],
  sales: [
    "server/actions/pos.ts",
    "server/master-data/merge.ts",
    "server/party-writeoffs.ts",
    "server/pos/receivables.ts",
    "server/pos/returns.ts",
    "server/pos/sales-hold.ts",
    "server/pos/sales-persist.ts",
    "server/pos/sales-void.ts",
  ],
  stockDocuments: [
    "server/inventory/adjustments-post.ts",
    "server/inventory/adjustments.ts",
    "server/inventory/documents.ts",
    "server/inventory/opname.ts",
    "server/inventory/transfers-receive.ts",
    "server/inventory/transfers.ts",
    "server/master-data/merge.ts",
  ],
  stockOnHand: [
    "server/actions/inventory/produk.ts",
    "server/actions/settings/lokasi.ts",
    "server/batches.ts",
    "server/inventory/movements.ts",
    "server/reservations.ts",
  ],
  stockReceipts: [
    "server/inventory/receipt-void.ts",
    "server/inventory/receipts.ts",
    "server/master-data/merge.ts",
    "server/party-writeoffs.ts",
    "server/payables.ts",
    "server/supplier-returns/payables.ts",
  ],
  supplierReturns: [
    "server/master-data/merge.ts",
    "server/supplier-returns/posting.ts",
    "server/supplier-returns/resolutions.ts",
    "server/supplier-returns/returns.ts",
  ],
  suppliers: [
    "server/actions/import/commit-phases.ts",
    "server/actions/inventory/pihak.ts",
    "server/import/commit.ts",
  ],
  units: [
    "server/actions/import/commit-phases.ts",
    "server/actions/inventory/taksonomi.ts",
    "server/import/commit.ts",
  ],
};

/** Domain pemilik berkas (relatif src/) — cermin MODULE_BOUNDARIES §2. */
function domainOf(rel: string): string {
  if (rel === "server/actions/payroll-indonesia.ts") return "HR";
  if (rel.startsWith("server/pos/") || rel === "server/pos.ts" || rel === "server/pos-offline.ts" || rel.startsWith("server/actions/pos")) return "POS";
  if (rel.startsWith("server/inventory/") || ["server/reservations.ts", "server/serials.ts", "server/batches.ts"].includes(rel) || rel.startsWith("server/actions/inventory/")) return "Gudang";
  if (rel.startsWith("server/supplier-returns/") || rel === "server/purchasing.ts" || rel === "server/purchase-requests.ts") return "Pembelian";
  if (rel.startsWith("server/hr/") || rel === "server/hr.ts" || rel === "server/payroll-indonesia.ts" || rel.startsWith("server/employee-") || rel === "server/reimbursements.ts" || rel.startsWith("server/actions/hr/")) return "HR";
  if (rel.startsWith("server/import/") || rel.startsWith("server/import-") || rel.startsWith("server/actions/import/") || rel === "app/api/import/parse/route.ts") return "Impor";
  if (
    rel.startsWith("server/catalog/") || rel === "server/catalog.ts" ||
    rel.startsWith("server/master-data/") || rel === "server/master-data.ts" ||
    rel.startsWith("server/actions/settings/") || rel === "server/actions/users.ts" ||
    rel === "server/member-permissions.ts" || rel === "server/sequences.ts" ||
    rel === "server/idempotency.ts" || rel === "server/audit.ts" || rel === "server/palette.ts"
  ) return "Platform";
  return "Akuntansi";
}

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join("/");

const WRITE_PATTERN = /\.(?:insert|update|delete)\(\s*(\w+)\s*\)/g;

function scanWriters(): Map<string, Set<string>> {
  const schemaDir = path.join(SRC_DIR, "db", "schema");
  const tableNames = new Set<string>();
  for (const file of listSourceFiles(schemaDir)) {
    for (const match of readFileSync(file, "utf8").matchAll(/export const (\w+) = pgTable\(/g)) {
      tableNames.add(match[1]);
    }
  }
  const writers = new Map<string, Set<string>>();
  for (const file of listSourceFiles(SRC_DIR)) {
    const rel = relative(file);
    if (rel.startsWith("db/schema") || rel.startsWith("db/migrations") || rel === "db/seed.ts" || rel === "db/seed-chart.ts" || rel === "db/seed-packaging.ts") continue;
    for (const match of readFileSync(file, "utf8").matchAll(WRITE_PATTERN)) {
      if (!tableNames.has(match[1])) continue;
      if (!writers.has(match[1])) writers.set(match[1], new Set());
      writers.get(match[1])!.add(rel);
    }
  }
  return writers;
}

describe("arsitektur: kepemilikan tulis tabel bersama (A-26 Q9)", () => {
  const writers = scanWriters();

  it("menemukan tabel & penulis untuk dipindai", () => {
    expect(writers.size).toBeGreaterThan(90);
    for (const table of Object.keys(FROZEN)) {
      expect(writers.has(table), `tabel kontrak tidak ditemukan di pindaian: ${table}`).toBe(true);
    }
  });

  it("himpunan penulis tabel bersama persis seperti kontrak MODULE_BOUNDARIES §6", () => {
    const violations: string[] = [];
    for (const [table, frozenFiles] of Object.entries(FROZEN)) {
      const actual = [...(writers.get(table) ?? [])].sort();
      const frozen = [...frozenFiles].sort();
      const added = actual.filter((file) => !frozen.includes(file));
      const removed = frozen.filter((file) => !actual.includes(file));
      for (const file of added) {
        violations.push(`${table}: penulis BARU ${file} — perbarui MODULE_BOUNDARIES §6 & peta ini dgn alasan, atau tulis lewat domain pemiliknya`);
      }
      for (const file of removed) {
        violations.push(`${table}: penulis beku sudah tidak menulis: ${file} — hapus dari MODULE_BOUNDARIES §6 & peta ini`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("tidak ada tabel lain yang menjadi ditulis ≥2 domain di luar kontrak", () => {
    const violations: string[] = [];
    for (const [table, files] of writers) {
      if (table in FROZEN) continue;
      const domains = new Set([...files].map(domainOf));
      if (domains.size >= 2) {
        violations.push(`${table}: ditulis ${domains.size} domain (${[...domains].join(", ")}) tanpa kontrak — tambahkan ke MODULE_BOUNDARIES §6 & FROZEN, atau satukan penulisnya`);
      }
    }
    expect(violations).toEqual([]);
  });
});
