import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-26 Q1 (K-08, kontrak §2.1/§2.4) — ratchet ukuran berkas.
 *
 * Aturan: tidak ada berkas sumber di src/ yang boleh melebihi 800 baris.
 * Berkas yang SUDAH raksasa pada keadaan Q0 (2026-11-06) dibekukan di
 * CEILINGS dengan plafon = ukurannya saat ini; berkas terdaftar yang
 * TUMBUH melewati plafonnya menggagalkan suite, dan berkas BARU yang
 * menembus 800 baris tanpa terdaftar juga menggagalkan suite.
 *
 * Plafon hanya boleh TURUN, tidak pernah naik:
 *  - tahap refactor A-26 (Q2–Q8) yang memecah/mengecilkan berkas
 *    terdaftar WAJIB menurunkan angka plafonnya di perubahan yang sama;
 *  - bila berkas menyusut sampai ≤800 baris, entrinya WAJIB dihapus
 *    dari CEILINGS — test "daftar ratchet tidak basi" menggagalkan
 *    suite selama entri basi tertinggal (pola yang sama dengan
 *    EXCEPTIONS di architecture-read-paths.test.ts).
 * Menaikkan plafon demi meloloskan pertumbuhan adalah pelanggaran
 * ratchet: pecah berkasnya, jangan geser angkanya ke atas.
 *
 * Jumlah baris dihitung sebagai jumlah karakter "\n" (semantik `wc -l`)
 * dari isi berkas di disk — deterministik dan sama untuk semua editor
 * selama berkas diakhiri newline.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const THRESHOLD = 800;

/** Kunci: jalur relatif terhadap src/ (posix). Nilai: plafon baris. */
const CEILINGS: Record<string, number> = {
  // "db/schema.ts" DIHAPUS di A-26 Q2: sudah terpecah per domain ke
  // src/db/schema/*.ts (semua ≤800 baris); schema.ts kini barrel murni.
  // "components/pengaturan/settings-forms.tsx" DIHAPUS di A-26 Q3: sudah
  // terpecah per topik ke src/components/pengaturan/forms/*.tsx (semua
  // ≤800 baris); settings-forms.tsx kini barrel re-export murni.
  // "server/pos/sales.ts" DIHAPUS di A-26 Q8b: dipecah per concern ke
  // sales-create/sales-payments/sales-persist/sales-hold/sales-stock/
  // sales-void di folder server/pos (semua ≤800 baris); ekspor publik
  // tetap lewat barrel server/pos.
  // A-26 Q4 (K-03): actions/{accounting,hr,inventory}.ts SUDAH dipecah
  // per sub-domain ke folder actions/{accounting,hr,inventory}/ (semua
  // pecahan ≤800) — entri plafon berkas asalnya dihapus dari daftar ini.
  // "server/payables.ts" DIHAPUS di A-26 Q8 (P-04/D-02): inti
  // pembayaran bersama diekstrak (executePayablePayment) sehingga
  // berkas menyusut ke 797 baris; duplikasi dua jalur bayar utang hilang.
  // "server/catalog.ts" DIHAPUS di A-26 Q5: sudah terpecah per agregat
  // baca ke src/server/catalog/*.ts (semua ≤500 baris); catalog.ts kini
  // barrel re-export murni.
  // "components/pos/pos-terminal.tsx" DIHAPUS di A-26 Q7 (K-06):
  // dipecah ke folder src/components/pos/terminal/ (hook pencarian,
  // rencana pembayaran, checkout + panel katalog & bar bayar mobile);
  // terminal kini 738 baris dan semua pecahan ≤800 baris.
  // A-26 Q6 (K-10): "server/actions/import.ts" DIHAPUS — dipecah per
  // tahap wizard ke folder server/actions/import/ (semua ≤800 baris);
  // "server/import-masters.ts" kini fasad re-export murni (definisi
  // berpindah ke folder domain src/server/import/, semua ≤800 baris).
  // "server/actions/settings.ts" DIHAPUS di A-26 Q8b: dipecah per
  // topik ke folder server/actions/settings/ (identitas-pajak,
  // pembayaran, kelompok-harga, lokasi, cetak, penomoran, modul,
  // kolom-kustom, operasi-gudang — semua ≤800 baris); pemanggil
  // berpindah mekanis per nama aksi (paritas 21 aksi terverifikasi).
  // "components/akuntansi/hr-panel.tsx" DIHAPUS di A-26 Q7 (K-07):
  // dipecah per fitur ke folder src/components/akuntansi/hr/ (semua
  // ≤800 baris); hr-panel.tsx kini barrel re-export murni.
  // "server/master-data.ts" DIHAPUS di A-26 Q8 (K-10): dipecah per
  // agregat ke src/server/master-data/ (bulk-edit/parties/merge,
  // semua ≤500 baris); master-data.ts kini barrel re-export murni.
  "db/seed.ts": 950, // K-12 — dev-only. Dinilai di A-26 Q8: TIDAK dipecah — satu fungsi seed() menenun id antar keluarga data (akun→peta→produk→stok→saldo awal) sehingga pecahan per keluarga bukan mekanis; risiko regresi baseline demo/e2e tidak sebanding manfaatnya untuk berkas dev-only. Tetap terdaftar & beku. A-27 B5: blok bagan akun (tanam akun + pemetaan + tagging) diekstrak ke db/seed-chart.ts agar tagging PSAK 118 tidak menembus plafon — plafon diturunkan ke ukuran baru 950.
  // "components/akuntansi/quick-entry-modal.tsx" DIHAPUS di A-26 Q7
  // (K-07): dipecah per bagian form ke folder
  // src/components/akuntansi/quick-entry/ (semua ≤800 baris);
  // quick-entry-modal.tsx kini host + orkestrator form 491 baris.
  // "server/inventory/receipts.ts" DIHAPUS di A-26 Q8: voidReceipt
  // berpindah ke inventory/receipt-void.ts (fase bernama); receipts.ts
  // kini 764 baris.
  // "server/supplier-returns/returns.ts" DIHAPUS di A-26 Q8 (K-05):
  // posting & void berpindah ke posting.ts (fase bernama), plafon
  // asal-usul ke provenance.ts; returns.ts kini 328 baris.
  // "components/pos/payment-panel.tsx" DIHAPUS di A-26 Q7 (K-07):
  // dipecah per bagian ke folder src/components/pos/payment/ (semua
  // ≤800 baris); payment-panel.tsx kini orkestrator 474 baris.
  // "components/gudang/import-wizard.tsx" DIHAPUS dari daftar di
  // A-26 Q6: kerangka wizard bersama diekstrak ke
  // src/components/gudang/import/ sehingga berkasnya menyusut ≤800.
  // "server/pos/returns.ts" DIHAPUS dari daftar di A-26 Q8b: baca
  // kredit retur pindah ke returns-credit.ts dan penyelesaian refund
  // ke returns-settlement.ts; returns.ts kini 564 baris.
  // "app/app/akuntansi/(akuntansi)/piutang-utang/page.tsx" DIHAPUS
  // dari daftar di A-26 Q8b (D-11): dua paruh simetris AR/AP diekstrak
  // ke komponen bersama components/akuntansi/piutang-utang-sections.tsx;
  // halaman kini 579 baris.
  // "server/bank-reconciliation.ts" DIHAPUS di A-26 Q8 (K-10):
  // dipecah per concern ke src/server/bank-reconciliation/
  // (accounts/book-lines/statements/matching/reads); berkas asal
  // kini barrel re-export murni.
  // "server/inventory/transfers.ts" DIHAPUS dari daftar di A-26 Q8b:
  // penerimaan transfer pindah ke transfers-receive.ts;
  // transfers.ts kini 345 baris.
  // "components/akuntansi/bank-reconciliation-panel.tsx" DIHAPUS di
  // A-26 Q7 (K-07): form impor mutasi dipindah ke
  // src/components/akuntansi/bank-reconciliation/import-form.tsx dan
  // di-re-export; panel kini 657 baris.
  // "server/inventory/adjustments.ts" DIHAPUS dari daftar di A-26
  // Q8b: posting & keputusan persetujuan pindah ke
  // adjustments-post.ts; adjustments.ts kini 388 baris.
  // "server/opening-balances.ts" DIHAPUS di A-26 Q8 (K-10): dipecah
  // ke src/server/opening-balances/ (documents.ts & payments.ts);
  // berkas asal kini barrel re-export murni.
};

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

function lineCount(file: string): number {
  return (readFileSync(file, "utf8").match(/\n/g) ?? []).length;
}

const relative = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join("/");

describe("arsitektur: ratchet ukuran berkas (A-26 Q1)", () => {
  const files = listSourceFiles(SRC_DIR);
  const sizes = new Map(files.map((file) => [relative(file), lineCount(file)]));

  it("menemukan berkas sumber untuk dipindai", () => {
    expect(files.length).toBeGreaterThan(400);
  });

  it("tidak ada berkas raksasa baru di luar daftar ratchet", () => {
    const violations: string[] = [];
    for (const [rel, lines] of sizes) {
      if (lines > THRESHOLD && !(rel in CEILINGS)) {
        violations.push(`${rel}: ${lines} baris (> ${THRESHOLD}) — pecah berkasnya atau daftarkan dgn alasan`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("berkas terdaftar tidak melebihi plafon bekunya", () => {
    const violations: string[] = [];
    for (const [rel, ceiling] of Object.entries(CEILINGS)) {
      const lines = sizes.get(rel);
      if (lines !== undefined && lines > ceiling) {
        violations.push(`${rel}: ${lines} baris > plafon ${ceiling} — plafon tidak boleh naik; pecah berkasnya`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("daftar ratchet tidak basi", () => {
    for (const rel of Object.keys(CEILINGS)) {
      const full = path.join(SRC_DIR, rel);
      expect(existsSync(full), `entri ratchet basi (berkas hilang): ${rel}`).toBe(true);
      const lines = sizes.get(rel) ?? 0;
      expect(
        lines,
        `entri ratchet basi (sudah ≤${THRESHOLD} baris, hapus dari CEILINGS): ${rel}`,
      ).toBeGreaterThan(THRESHOLD);
    }
  });
});
