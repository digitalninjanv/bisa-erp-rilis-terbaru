import { performance } from "node:perf_hooks";
import { and, asc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { adminDb, adminSql } from "../src/db/admin";
import { accounts, journalEntries, journalLines } from "../src/db/schema";
import { withCompanyReadOnly } from "../src/db/tenant";
import { getCashFlow } from "../src/server/reports";

/**
 * FIX-ARS Tahap 3 (ARS3-02) — pengukuran sebelum/sesudah agregasi SQL
 * baris lawan arus kas, dapat direproduksi:
 *
 *   pnpm tsx --env-file=.env.local scripts/bench-cashflow.ts
 *
 * Membangun perusahaan fixture sekali-pakai (be47) berisi 40.000 entri
 * jurnal BERKAS (kas) yang ditulis LANGSUNG (SQL), tersebar 24 bulan
 * (2024–2025), dua pola bergilir:
 *   - pola KELUAR (entri ganjil): 1 baris kas + 5 baris lawan atas 4
 *     akun (satu akun beban muncul 2×) lintas kelompok operasi /
 *     investasi / belum-terklasifikasi;
 *   - pola MASUK (entri genap): 1 baris kas + 3 baris lawan atas 2 akun
 *     (pendapatan muncul 2×) lintas operasi / pendanaan.
 * Total 200.000 baris jurnal; rentang yang diukur = tahun 2025
 * (19.870 entri kas, 99.350 baris). Id entri deterministik dari nomor
 * urut (tanpa join saat membangkitkan baris — join number→id atas
 * 200 rb baris terbukti sangat lambat di lingkungan ini).
 * Flag `--reuse`: lewati pembangunan dan pakai dataset be47 yang sudah
 * ada (untuk melanjutkan pengukuran sesudah proses terputus).
 *
 * Yang diukur pada rentang yang sama:
 *   - BARIS LAMA: kueri bentuk lama (semua baris jurnal entri kas,
 *     direplikasi persis) — jumlah baris yang menyeberang ke JS dan
 *     waktu ambilnya;
 *   - BARIS BARU: kueri agregat per (entri × akun lawan) bentuk baru —
 *     jumlah baris dan waktu ambilnya;
 *   - getCashFlow ujung-ke-ujung (fungsi produksi saat skrip dijalankan).
 * Jalankan skrip ini pada kode pra-tahap untuk angka "sebelum" dan
 * sesudah perubahan untuk angka "sesudah"; hitungan baris kedua bentuk
 * kueri tidak bergantung versi kode. Perusahaan fixture dihapus total
 * di akhir; data demo tidak disentuh.
 */

const ORG = "01900000-0000-7000-8000-00000000be47";
const ENTRIES = 40_000;
const YEAR = { from: "2025-01-01", to: "2025-12-31" };

async function wipe() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    for (const table of ["journal_lines", "journal_entries", "account_mappings", "accounts"]) {
      await tx.unsafe(`DELETE FROM ${table} WHERE company_id = $1`, [ORG]);
    }
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
  });
}

async function generate() {
  await wipe();
  await adminDb.execute(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${ORG}, 'Bench ARS3', 'bench-ars3', now())
  `);
  const accRows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "1100", name: "Bank", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "1500", name: "Aset Tetap", type: "asset", normalBalance: "debit", section: "non_current_asset", cashFlowGroup: "investing" },
      { companyId: ORG, code: "1999", name: "Aset Lain-lain", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "3000", name: "Modal", type: "equity", normalBalance: "credit", section: "equity", cashFlowGroup: "financing" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit", section: "revenue", cashFlowGroup: "operating" },
      { companyId: ORG, code: "6010", name: "Beban Sewa", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
      { companyId: ORG, code: "6020", name: "Beban Gaji", type: "expense", normalBalance: "debit", section: "operating_expense", cashFlowGroup: "operating" },
    ])
    .returning({ id: accounts.id, code: accounts.code });
  const byCode = Object.fromEntries(accRows.map((r) => [r.code, r.id]));
  await adminDb.execute(sql`
    INSERT INTO account_mappings (company_id, key, account_id) VALUES
      (${ORG}, 'cash', ${byCode["1000"]}::uuid),
      (${ORG}, 'bank', ${byCode["1100"]}::uuid)
  `);

  await adminSql.begin(async (tx) => {
    await tx.unsafe(`
      CREATE TEMP TABLE bench_gen ON COMMIT DROP AS
      SELECT g,
             (lpad(to_hex(g), 32, '0'))::uuid AS entry_id,
             'B47-' || lpad(g::text, 8, '0') AS number,
             (DATE '2024-01-01' + ((g - 1) % 730)) AS date,
             (g % 2) AS pattern,
             (1000 + (g % 7) * 137)::numeric(19,4) AS a1,
             (2000 + (g % 5) * 100)::numeric(19,4) AS a2,
             (3000 + (g % 11) * 10)::numeric(19,4) AS a3,
             5000::numeric(19,4) AS a4,
             1500::numeric(19,4) AS a5,
             (4000 + (g % 7) * 100)::numeric(19,4) AS b1,
             6000::numeric(19,4) AS b2,
             2500::numeric(19,4) AS b3
      FROM generate_series(1, ${ENTRIES}) AS g
    `);
    await tx.unsafe(`
      INSERT INTO journal_entries (id, company_id, number, date, description, source_type, status, posted_at)
      SELECT entry_id, '${ORG}', number, date, 'Jurnal benchmark ARS tahap 3',
             CASE WHEN pattern = 1 THEN 'expense' ELSE 'sale' END, 'posted', now()
      FROM bench_gen
    `);
    // Baris jurnal langsung dari bench_gen (entry_id deterministik —
    // tanpa join ke journal_entries).
    await tx.unsafe(`
      INSERT INTO journal_lines (company_id, entry_id, account_id, debit, credit, description, line_no)
      SELECT '${ORG}', bg.entry_id, bg.acc, bg.debit, bg.credit, 'Baris benchmark', bg.line_no
      FROM (
        SELECT entry_id, 1 AS line_no, '${byCode["6010"]}'::uuid AS acc, a1 AS debit, 0::numeric AS credit FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 2, '${byCode["6010"]}'::uuid, a2, 0 FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 3, '${byCode["6020"]}'::uuid, a3, 0 FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 4, '${byCode["1500"]}'::uuid, a4, 0 FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 5, '${byCode["1999"]}'::uuid, a5, 0 FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 6, '${byCode["1000"]}'::uuid, 0, a1 + a2 + a3 + a4 + a5 FROM bench_gen WHERE pattern = 1
        UNION ALL SELECT entry_id, 1, '${byCode["1000"]}'::uuid, b1 + b2 + b3, 0 FROM bench_gen WHERE pattern = 0
        UNION ALL SELECT entry_id, 2, '${byCode["4000"]}'::uuid, 0, b1 FROM bench_gen WHERE pattern = 0
        UNION ALL SELECT entry_id, 3, '${byCode["4000"]}'::uuid, 0, b2 FROM bench_gen WHERE pattern = 0
        UNION ALL SELECT entry_id, 4, '${byCode["3000"]}'::uuid, 0, b3 FROM bench_gen WHERE pattern = 0
      ) bg
    `);
  });
  return byCode;
}

async function median(fn: () => Promise<unknown>, runs: number): Promise<number> {
  await fn(); // pemanasan
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

async function loadByCode(): Promise<Record<string, string>> {
  const rows = await adminDb
    .select({ id: accounts.id, code: accounts.code })
    .from(accounts)
    .where(eq(accounts.companyId, ORG));
  return Object.fromEntries(rows.map((r) => [r.code, r.id]));
}

async function main() {
  const reuse = process.argv.includes("--reuse");
  let byCode: Record<string, string>;
  if (reuse) {
    console.log("Memakai dataset be47 yang sudah ada (--reuse).");
    byCode = await loadByCode();
  } else {
    console.log(`Membangun dataset: ${ENTRIES} entri jurnal berkas, 24 bulan…`);
    const genStart = performance.now();
    byCode = await generate();
    console.log(`Dataset terbangun dalam ${((performance.now() - genStart) / 1000).toFixed(1)} dtk.`);
  }

  const counts = await adminDb.execute(sql`
    select (select count(*) from journal_entries where company_id = ${ORG}) as entries,
           (select count(*) from journal_lines where company_id = ${ORG}) as lines,
           (select count(*) from journal_entries where company_id = ${ORG} and date >= ${YEAR.from} and date <= ${YEAR.to}) as entries_2025
  `);
  console.log("Dataset:", JSON.stringify(counts[0]));

  const cashAccountIds = [byCode["1000"], byCode["1100"]];

  /* --- Bentuk LAMA: semua baris jurnal entri kas, per baris --- */
  const oldShape = () =>
    withCompanyReadOnly(ORG, async (tx) => {
      const cashLines = await tx
        .select({ entryId: journalEntries.id })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ORG),
            inArray(journalLines.accountId, cashAccountIds),
            eq(journalEntries.status, "posted"),
            gte(journalEntries.date, YEAR.from),
            lte(journalEntries.date, YEAR.to),
          ),
        )
        .groupBy(journalEntries.id);
      const entryIds = cashLines.map((row) => row.entryId);
      if (entryIds.length === 0) return 0;
      const rows = await tx
        .select({
          entryId: journalLines.entryId,
          accountId: journalLines.accountId,
          type: accounts.type,
          code: accounts.code,
          cashFlowGroup: accounts.cashFlowGroup,
          debit: journalLines.debit,
          credit: journalLines.credit,
        })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(and(eq(journalLines.companyId, ORG), inArray(journalLines.entryId, entryIds)))
        .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));
      return rows.length;
    });

  /* --- Bentuk BARU: agregat per (entri × akun lawan), inArray atas id
         entri yang sudah terambil — persis bentuk produksi final
         (potongan 10.000 dilewati di sini; hitungan baris & bentuk
         agregatnya sama). --- */
  const newShape = () =>
    withCompanyReadOnly(ORG, async (tx) => {
      const cashLines = await tx
        .select({ entryId: journalEntries.id })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ORG),
            inArray(journalLines.accountId, cashAccountIds),
            eq(journalEntries.status, "posted"),
            gte(journalEntries.date, YEAR.from),
            lte(journalEntries.date, YEAR.to),
          ),
        )
        .groupBy(journalEntries.id);
      const entryIds = cashLines.map((row) => row.entryId);
      if (entryIds.length === 0) return 0;
      const rows = await tx
        .select({
          entryId: journalLines.entryId,
          accountId: journalLines.accountId,
          type: accounts.type,
          code: accounts.code,
          cashFlowGroup: accounts.cashFlowGroup,
          debit: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
          credit: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(
          and(
            eq(journalLines.companyId, ORG),
            notInArray(journalLines.accountId, cashAccountIds),
            inArray(journalLines.entryId, entryIds),
          ),
        )
        .groupBy(
          journalLines.entryId,
          journalLines.accountId,
          accounts.type,
          accounts.code,
          accounts.cashFlowGroup,
        )
        .orderBy(asc(journalLines.entryId), asc(sql`min(${journalLines.lineNo})`));
      return rows.length;
    });

  const oldRows = await oldShape();
  const newRows = await newShape();
  console.log(`\nBaris menyeberang ke JS (rentang 2025): LAMA=${oldRows} BARU=${newRows}`);

  const cashFlowRun = () => withCompanyReadOnly(ORG, (tx) => getCashFlow(tx, ORG, YEAR));
  const flow = await cashFlowRun();
  console.log(
    `getCashFlow 2025: opening=${flow.opening} net=${flow.net} closing=${flow.closing} ` +
      `groups=${JSON.stringify(flow.groups)} rows=${flow.rows.length}`,
  );
  console.log(
    `Ikatan opening + net = closing: ${Math.abs(flow.opening + flow.net - flow.closing) < 0.0001 ? "PERSIS" : "PECAR"}`,
  );

  console.log("\nMedian waktu (sesudah 1 pemanasan), ms:");
  console.log(`  ${"Kueri lawan BENTUK LAMA (ambil semua baris)".padEnd(52)} ${(await median(oldShape, 3)).toFixed(1)}`);
  console.log(`  ${"Kueri lawan BENTUK BARU (agregat SQL)".padEnd(52)} ${(await median(newShape, 5)).toFixed(1)}`);
  console.log(`  ${"getCashFlow ujung-ke-ujung (kode saat ini)".padEnd(52)} ${(await median(cashFlowRun, 5)).toFixed(1)}`);

  await wipe();
  console.log("\nPerusahaan fixture be47 dihapus total.");
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await wipe().catch(() => undefined);
    process.exit(1);
  });
