import { performance } from "node:perf_hooks";
import { sql } from "drizzle-orm";
import { adminDb, adminSql } from "../src/db/admin";
import { accounts } from "../src/db/schema";
import { withCompanyReadOnly } from "../src/db/tenant";
import { getAccountingSummary, getBalanceSheet, getTrialBalance, mappedBalance } from "../src/server/reports";

/**
 * FIX-ARS Tahap 2 (ARS3-01) — pengukuran sebelum/sesudah ringkasan saldo
 * bulanan, dapat direproduksi:
 *
 *   pnpm tsx --env-file=.env.local scripts/bench-monthly-balances.ts
 *
 * Membangun perusahaan fixture sekali-pakai (be46) berisi jurnal besar
 * yang ditulis LANGSUNG (SQL), lalu mengisi account_monthly_balances
 * dengan agregat backfill yang sama seperti migrasi 0046 — persis
 * keadaan perusahaan lama sesudah migrasi. "Sebelum" diukur dengan SQL
 * agregat penuh yang mereplikasi persis kueri laporan sebelum tahap ini
 * (satu-satunya biaya yang berubah adalah pola agregasinya; fungsi lama
 * menjalankan SQL yang sama lewat Drizzle). "Sesudah" diukur dengan
 * memanggil fungsi laporan yang sebenarnya. Kesetaraan hasil kedua
 * metode pada dataset ini juga diperiksa. Perusahaan fixture dihapus
 * total di akhir; data demo tidak disentuh.
 */

const ORG = "01900000-0000-7000-8000-00000000be46";
const ENTRIES = 60_000; // × 2 baris = 120.000 baris jurnal, 24 bulan (2024–2025)

async function wipe() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    for (const table of [
      "journal_lines",
      "journal_entries",
      "account_monthly_balances",
      "account_mappings",
      "accounts",
      "fiscal_periods",
      "document_sequences",
    ]) {
      await tx.unsafe(`DELETE FROM ${table} WHERE company_id = $1`, [ORG]);
    }
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
  });
}

async function generate() {
  await wipe();
  await adminDb.execute(sql`
    INSERT INTO organization (id, name, slug, created_at)
    VALUES (${ORG}, 'Bench ARS2', 'bench-ars2', now())
  `);
  const accRows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "1100", name: "Piutang", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "1300", name: "Persediaan", type: "asset", normalBalance: "debit", section: "current_asset" },
      { companyId: ORG, code: "3000", name: "Modal", type: "equity", normalBalance: "credit", section: "equity" },
      { companyId: ORG, code: "4000", name: "Pendapatan", type: "revenue", normalBalance: "credit", section: "revenue" },
      { companyId: ORG, code: "6000", name: "Beban Operasional", type: "expense", normalBalance: "debit", section: "operating_expense" },
    ])
    .returning({ id: accounts.id, code: accounts.code });
  const byCode = Object.fromEntries(accRows.map((r) => [r.code, r.id]));
  await adminDb.execute(sql`
    INSERT INTO account_mappings (company_id, key, account_id) VALUES
      (${ORG}, 'cash', ${byCode["1000"]}::uuid),
      (${ORG}, 'receivable', ${byCode["1100"]}::uuid),
      (${ORG}, 'inventory', ${byCode["1300"]}::uuid)
  `);

  // Jurnal sintetis seimbang: pola bergilir (kas/pendapatan),
  // (beban/kas), (piutang/pendapatan) tersebar merata 24 bulan.
  await adminSql.begin(async (tx) => {
    await tx.unsafe(`
      CREATE TEMP TABLE bench_gen ON COMMIT DROP AS
      SELECT g,
             'B46-' || lpad(g::text, 8, '0') AS number,
             (DATE '2024-01-01' + ((g - 1) % 730)) AS date,
             (10000 + (g % 90) * 1000)::numeric(19,4) AS amount,
             (CASE g % 3
               WHEN 0 THEN '${byCode["1000"]}' WHEN 1 THEN '${byCode["6000"]}' ELSE '${byCode["1100"]}'
             END)::uuid AS debit_account,
             (CASE g % 3
               WHEN 0 THEN '${byCode["4000"]}' WHEN 1 THEN '${byCode["1000"]}' ELSE '${byCode["4000"]}'
             END)::uuid AS credit_account
      FROM generate_series(1, ${ENTRIES}) AS g
    `);
    await tx.unsafe(`
      INSERT INTO journal_entries (company_id, number, date, description, source_type, status, posted_at)
      SELECT '${ORG}', number, date, 'Jurnal benchmark ARS tahap 2', 'manual', 'posted', now()
      FROM bench_gen
    `);
    await tx.unsafe(`
      INSERT INTO journal_lines (company_id, entry_id, account_id, debit, credit, description, line_no)
      SELECT '${ORG}', je.id, bg.debit_account, bg.amount, 0, 'Baris debit', 1
      FROM bench_gen bg JOIN journal_entries je ON je.number = bg.number AND je.company_id = '${ORG}'
      UNION ALL
      SELECT '${ORG}', je.id, bg.credit_account, 0, bg.amount, 'Baris kredit', 2
      FROM bench_gen bg JOIN journal_entries je ON je.number = bg.number AND je.company_id = '${ORG}'
    `);
    // Backfill ringkasan — statement yang sama seperti migrasi 0046.
    await tx.unsafe(`
      INSERT INTO "account_monthly_balances" ("company_id", "account_id", "year_month", "total_debit", "total_credit")
      SELECT jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM'), sum(jl."debit"), sum(jl."credit")
      FROM "journal_lines" jl
      INNER JOIN "journal_entries" je ON je."id" = jl."entry_id"
      WHERE je."status" = 'posted' AND jl."company_id" = '${ORG}'
      GROUP BY jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM')
      ON CONFLICT ("company_id", "account_id", "year_month") DO UPDATE SET
        "total_debit" = EXCLUDED."total_debit",
        "total_credit" = EXCLUDED."total_credit"
    `);
  });
  return byCode;
}

async function median(fn: () => Promise<unknown>, runs = 5): Promise<number> {
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

const YEAR = { from: "2025-01-01", to: "2025-12-31" };

async function main() {
  console.log(`Membangun dataset: ${ENTRIES} entri / ${ENTRIES * 2} baris jurnal, 24 bulan…`);
  const genStart = performance.now();
  const byCode = await generate();
  console.log(`Dataset terbangun dalam ${((performance.now() - genStart) / 1000).toFixed(1)} dtk.`);

  const counts = await adminDb.execute(sql`
    select (select count(*) from journal_entries where company_id = ${ORG}) as entries,
           (select count(*) from journal_lines where company_id = ${ORG}) as lines,
           (select count(*) from account_monthly_balances where company_id = ${ORG}) as summary_rows
  `);
  console.log("Dataset:", JSON.stringify(counts[0]));

  /* --- Metode LAMA: SQL agregat penuh (replikasi kueri pra-tahap) --- */
  const oldTrialBalance = () =>
    withCompanyReadOnly(ORG, (tx) =>
      tx.execute(sql`
        select a.id,
               coalesce(sum(case when je.date < ${YEAR.from} then jl.debit - jl.credit else 0 end), 0) as opening,
               coalesce(sum(case when je.date >= ${YEAR.from} and je.date <= ${YEAR.to} then jl.debit else 0 end), 0) as debit,
               coalesce(sum(case when je.date >= ${YEAR.from} and je.date <= ${YEAR.to} then jl.credit else 0 end), 0) as credit,
               coalesce(sum(case when je.date <= ${YEAR.to} then jl.debit - jl.credit else 0 end), 0) as closing
        from accounts a
        left join journal_lines jl on jl.account_id = a.id
        left join journal_entries je on jl.entry_id = je.id and je.status = 'posted'
        where a.company_id = ${ORG}
        group by a.id
      `),
    );
  const oldMappedBalance = () =>
    withCompanyReadOnly(ORG, (tx) =>
      tx.execute(sql`
        select coalesce(sum(jl.debit - jl.credit), 0) as balance
        from journal_lines jl
        join journal_entries je on jl.entry_id = je.id
        join account_mappings am on am.company_id = ${ORG} and am.account_id = jl.account_id
        where jl.company_id = ${ORG} and je.status = 'posted' and am.key in ('cash')
      `),
    );

  /* --- Metode BARU: fungsi laporan sebenarnya --- */
  const newTrialBalance = () => withCompanyReadOnly(ORG, (tx) => getTrialBalance(tx, ORG, YEAR));
  const newBalanceSheet = () => withCompanyReadOnly(ORG, (tx) => getBalanceSheet(tx, ORG, YEAR.to));
  const newSummary = () => withCompanyReadOnly(ORG, (tx) => getAccountingSummary(tx, ORG, YEAR));
  const newMappedBalance = () => withCompanyReadOnly(ORG, (tx) => mappedBalance(tx, ORG, ["cash"]));

  // Pemeriksaan kesetaraan pada dataset besar ini sebelum mengukur.
  const [oldTb, newTb, oldMb, newMb] = await Promise.all([
    oldTrialBalance(),
    newTrialBalance(),
    oldMappedBalance(),
    newMappedBalance(),
  ]);
  const oldCashClosing = (oldTb as unknown as { id: string; closing: string }[]).find(
    (row) => row.id === byCode["1000"],
  )?.closing;
  const newCashClosing = newTb.find((row) => row.accountId === byCode["1000"])?.closing;
  const oldMbValue = (oldMb as unknown as { balance: string }[])[0]?.balance;
  console.log(
    `Kesetaraan dataset besar: closing kas lama=${oldCashClosing} baru=${newCashClosing?.toFixed(4)}; ` +
      `mappedBalance(cash) lama=${oldMbValue} baru=${newMb.toFixed(4)}`,
  );
  if (
    oldCashClosing === undefined ||
    newCashClosing === undefined ||
    Math.abs(Number(oldCashClosing) - newCashClosing) > 0.0001 ||
    oldMbValue === undefined ||
    Math.abs(Number(oldMbValue) - newMb) > 0.0001
  ) {
    throw new Error("KESETARAAN GAGAL pada dataset besar — pengukuran dibatalkan.");
  }

  const rows: [string, number][] = [];
  rows.push(["LAMA neraca saldo 12 bulan (SQL agregat penuh)", await median(oldTrialBalance)]);
  rows.push(["BARU neraca saldo 12 bulan (getTrialBalance hibrida)", await median(newTrialBalance)]);
  rows.push(["BARU neraca posisi (getBalanceSheet hibrida)", await median(newBalanceSheet)]);
  rows.push(["BARU ringkasan akuntansi (getAccountingSummary)", await median(newSummary)]);
  rows.push(["LAMA mappedBalance kas (SQL agregat penuh)", await median(oldMappedBalance)]);
  rows.push(["BARU mappedBalance kas (hibrida)", await median(newMappedBalance)]);

  console.log("\nMedian 5 larian (sesudah 1 pemanasan), ms:");
  for (const [label, ms] of rows) console.log(`  ${label.padEnd(58)} ${ms.toFixed(1)}`);

  await wipe();
  console.log("\nPerusahaan fixture be46 dihapus total.");
}

main()
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error(error);
    await wipe().catch(() => undefined);
    process.exit(1);
  });
