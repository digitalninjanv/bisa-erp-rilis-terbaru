// A-24 Tahap T4B: bagian dari pemecahan src/server/reports.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/reports.ts.

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  resolveCashFlowGroup,
  resolveSection,
} from "@/lib/accounting";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import {
  accounts,
  journalEntries,
  journalLines,
} from "@/db/schema";
import { listCashBankAccounts, signedBalance } from "@/server/accounting";
import { accountTotalsInRange, cumulativeAccountTotals, previousDay, totalsOf } from "./shared";
import type { CashFlowBucket, Range } from "./shared";

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
};

export async function getTrialBalance(tx: Tx, companyId: string, range: Range): Promise<TrialBalanceRow[]> {
  // FIX-ARS Tahap 2: saldo awal & akhir serta mutasi rentang diturunkan
  // dari total kumulatif hibrida (ringkasan bulanan + bulan parsial),
  // bukan lagi satu agregasi CASE atas seluruh riwayat jurnal.
  const accountRows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
    })
    .from(accounts)
    .where(eq(accounts.companyId, companyId))
    .orderBy(asc(accounts.code));
  const before = await cumulativeAccountTotals(tx, companyId, previousDay(range.from));
  const through = await cumulativeAccountTotals(tx, companyId, range.to);

  return accountRows.map((row) => {
    // The Debit/Kredit movement columns stay raw. The opening and closing
    // balances share ONE sign convention — the account's own normal
    // balance, as in getLedger (AK-P2-09) and listAccountBalances.
    // Closing once derived its sign from the account TYPE instead, which
    // flipped contra accounts (1510, 4010, 4020) against their own
    // opening column in the same row.
    const sign = row.normalBalance === "debit" ? 1 : -1;
    const b = totalsOf(before, row.accountId);
    const t = totalsOf(through, row.accountId);
    return {
      ...row,
      opening: b.debit.minus(b.credit).mul(sign).toNumber(),
      debit: t.debit.minus(b.debit).toNumber(),
      credit: t.credit.minus(b.credit).toNumber(),
      closing: t.debit.minus(t.credit).mul(sign).toNumber(),
    };
  });
}

export type StatementLine = { accountId: string; code: string; name: string; amount: number };

export async function getIncomeStatement(tx: Tx, companyId: string, range: Range) {
  // Left join from the chart of accounts (AK-P2-07): every postable P&L
  // account is returned, valued 0 when it has no posted movement in range.
  // The current and prior-year calls therefore share one account universe,
  // so an account that only moved last year still appears in the comparison
  // (0 on the current side) instead of silently dropping out of the detail
  // rows while remaining inside the prior-year total. The posted + date
  // conditions live in the entry join so non-posted or out-of-range lines
  // contribute 0 via the CASE sums (AK-P2-02).
  // FIX-ARS Tahap 2: mutasi rentang per akun dari total hibrida
  // (accountTotalsInRange), alam semesta akunnya tetap dari bagan akun.
  const accountRows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
      section: accounts.section,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.companyId, companyId),
        eq(accounts.isPostable, true),
        inArray(accounts.type, ["revenue", "cogs", "expense"]),
      ),
    )
    .orderBy(asc(accounts.code));
  const rangeTotals = await accountTotalsInRange(tx, companyId, range.from, range.to);
  const rows = accountRows.map((row) => {
    const totals = totalsOf(rangeTotals, row.accountId);
    return { ...row, debit: toDb(totals.debit), credit: toDb(totals.credit) };
  });

  // Sign convention is per SECTION, never per account normalBalance:
  // income sections (revenue, other_income) value an account as
  // credit − debit, cost sections (cogs, operating_expense, other_expense)
  // as debit − credit. Contra accounts therefore fall out negative on
  // their own — 4010 Diskon Penjualan and 4020 Retur Penjualan carry a
  // debit normal balance inside the revenue section, so valuing them by
  // normalBalance (as this once did) ADDED them to revenue instead of
  // subtracting them, inflating net profit and unbalancing the balance
  // sheet whenever a discount or return journal was posted.
  // AK-P3-04: amounts and totals accumulate in Decimal (the SQL sums arrive
  // as numeric strings); each line/total crosses back to number once, from
  // its exact Decimal value.
  const sumDec = (list: { dec: Decimal }[]) =>
    list.reduce((acc, l) => acc.plus(l.dec), d(0));
  const withSection = rows.map((row) => {
    const section = resolveSection(row);
    const dec =
      section === "revenue" || section === "other_income"
        ? d(row.credit).minus(row.debit)
        : d(row.debit).minus(row.credit);
    const line: StatementLine = {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount: dec.toNumber(),
    };
    return { ...line, section, dec };
  });
  const revenue = withSection.filter((r) => r.section === "revenue");
  const otherIncome = withSection.filter((r) => r.section === "other_income");
  const cogs = withSection.filter((r) => r.section === "cogs");
  const operatingExpense = withSection.filter((r) => r.section === "operating_expense");
  const otherExpense = withSection.filter((r) => r.section === "other_expense");
  const expense = withSection.filter((r) => r.section === "operating_expense" || r.section === "other_expense");

  const totalRevenueDec = sumDec(revenue);
  const totalOtherIncomeDec = sumDec(otherIncome);
  const totalCogsDec = sumDec(cogs);
  const totalOperatingExpenseDec = sumDec(operatingExpense);
  const totalOtherExpenseDec = sumDec(otherExpense);
  const totalExpenseDec = totalOperatingExpenseDec.plus(totalOtherExpenseDec);
  const grossProfitDec = totalRevenueDec.minus(totalCogsDec);
  const operatingProfitDec = grossProfitDec.minus(totalOperatingExpenseDec);
  const netProfitDec = operatingProfitDec.plus(totalOtherIncomeDec).minus(totalOtherExpenseDec);
  const totalRevenue = totalRevenueDec.toNumber();
  const totalOtherIncome = totalOtherIncomeDec.toNumber();
  const totalCogs = totalCogsDec.toNumber();
  const totalOperatingExpense = totalOperatingExpenseDec.toNumber();
  const totalOtherExpense = totalOtherExpenseDec.toNumber();
  const totalExpense = totalExpenseDec.toNumber();
  const grossProfit = grossProfitDec.toNumber();
  const operatingProfit = operatingProfitDec.toNumber();
  const netProfit = netProfitDec.toNumber();

  const strip = (list: typeof withSection): StatementLine[] =>
    list.map(({ accountId, code, name, amount }) => ({ accountId, code, name, amount }));
  return {
    revenue: strip(revenue),
    otherIncome: strip(otherIncome),
    cogs: strip(cogs),
    operatingExpense: strip(operatingExpense),
    otherExpense: strip(otherExpense),
    expense: strip(expense),
    totalRevenue,
    totalOtherIncome,
    totalCogs,
    totalOperatingExpense,
    totalOtherExpense,
    totalExpense,
    grossProfit,
    operatingProfit,
    netProfit,
  };
}

export async function getBalanceSheet(tx: Tx, companyId: string, asOf: string) {
  // FIX-ARS Tahap 2: saldo kumulatif per akun s.d. asOf dari total
  // hibrida (cumulativeAccountTotals), bukan agregasi CASE atas
  // seluruh riwayat jurnal.
  const accountRows = await tx
    .select({
      accountId: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      normalBalance: accounts.normalBalance,
      section: accounts.section,
    })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), inArray(accounts.type, ["asset", "liability", "equity"])))
    .orderBy(asc(accounts.code));
  const cumulative = await cumulativeAccountTotals(tx, companyId, asOf);
  const rows = accountRows.map((row) => {
    const totals = totalsOf(cumulative, row.accountId);
    return { ...row, debit: toDb(totals.debit), credit: toDb(totals.credit) };
  });

  // AK-P2-07: keep every account that has any posted movement up to asOf,
  // even when its balance settled to exactly zero — dropping zero balances
  // would hide accounts that only carry a balance in the prior-year
  // comparison column. Accounts with no movement at all stay hidden.
  const withBalance = rows
    .filter((row) => !d(row.debit).isZero() || !d(row.credit).isZero())
    .map((row) => ({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      type: row.type,
      section: resolveSection(row),
      amount: (row.type === "asset"
        ? d(row.debit).minus(row.credit)
        : d(row.credit).minus(row.debit)
      ).toNumber(),
    }));

  const profit = await getIncomeStatement(tx, companyId, { from: "1900-01-01", to: asOf });
  const currentAssets = withBalance.filter((r) => r.section === "current_asset");
  const nonCurrentAssets = withBalance.filter((r) => r.section === "non_current_asset");
  const currentLiabilities = withBalance.filter((r) => r.section === "current_liability");
  const nonCurrentLiabilities = withBalance.filter((r) => r.section === "non_current_liability");
  const equity = withBalance.filter((r) => r.section === "equity");
  const assets = withBalance.filter((r) => r.type === "asset");
  const liabilities = withBalance.filter((r) => r.type === "liability");

  // AK-P3-04: section totals accumulate in Decimal like the income
  // statement they reconcile against.
  const sumAmounts = (list: { amount: number }[]) =>
    list.reduce((acc, r) => acc.plus(r.amount), d(0));
  const totalCurrentAssetsDec = sumAmounts(currentAssets);
  const totalNonCurrentAssetsDec = sumAmounts(nonCurrentAssets);
  const totalCurrentLiabilitiesDec = sumAmounts(currentLiabilities);
  const totalNonCurrentLiabilitiesDec = sumAmounts(nonCurrentLiabilities);
  const totalAssetsDec = totalCurrentAssetsDec.plus(totalNonCurrentAssetsDec);
  const totalLiabilitiesDec = totalCurrentLiabilitiesDec.plus(totalNonCurrentLiabilitiesDec);
  const totalEquityDec = sumAmounts(equity).plus(profit.netProfit);

  return {
    assets,
    liabilities,
    equity,
    currentAssets,
    nonCurrentAssets,
    currentLiabilities,
    nonCurrentLiabilities,
    totalAssets: totalAssetsDec.toNumber(),
    totalCurrentAssets: totalCurrentAssetsDec.toNumber(),
    totalNonCurrentAssets: totalNonCurrentAssetsDec.toNumber(),
    totalLiabilities: totalLiabilitiesDec.toNumber(),
    totalCurrentLiabilities: totalCurrentLiabilitiesDec.toNumber(),
    totalNonCurrentLiabilities: totalNonCurrentLiabilitiesDec.toNumber(),
    totalEquity: totalEquityDec.toNumber(),
    netProfit: profit.netProfit,
    balanced: totalAssetsDec.minus(totalLiabilitiesDec).minus(totalEquityDec).abs().lt("0.01"),
  };
}

export async function getCashFlow(tx: Tx, companyId: string, range: Range) {
  // A-28 Tahap 3 (H-AKT-02): subjek kas laporan ini adalah himpunan
  // KELAS kas/bank (listCashBankAccounts — cash|bank|clearing,
  // postable, aktif), definisi yang sama dengan dashboard, kartu
  // ringkasan akuntansi, dan halaman Kas & bank. Sebelumnya subjeknya
  // hanya akun yang ditunjuk pemetaan cash/bank/qris, sehingga mutasi
  // bank kedua dst. tidak pernah muncul di arus kas walau saldonya
  // masuk neraca. Pemetaan tetap penunjuk akun bawaan operasional
  // (kas sesi POS dsb.), bukan definisi kas laporan.
  const cashBankAccounts = await listCashBankAccounts(tx, companyId);
  const cashAccountIds = new Set(cashBankAccounts.map((row) => row.id));
  const openingTotals = await cumulativeAccountTotals(tx, companyId, previousDay(range.from));
  const opening = cashBankAccounts
    .reduce((acc, row) => {
      const totals = totalsOf(openingTotals, row.id);
      return acc.plus(signedBalance(row.type, totals.debit, totals.credit));
    }, d(0))
    .toNumber();

  // Posted cash movements in range, one row per journal entry (AK-P2-02).
  const cashLines =
    cashAccountIds.size === 0
      ? []
      : await tx
          .select({
            entryId: journalEntries.id,
            sourceType: journalEntries.sourceType,
            inflow: sql<string>`coalesce(sum(${journalLines.debit}), 0)`,
            outflow: sql<string>`coalesce(sum(${journalLines.credit}), 0)`,
          })
          .from(journalLines)
          .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
          .where(
            and(
              eq(journalLines.companyId, companyId),
              inArray(journalLines.accountId, [...cashAccountIds]),
              eq(journalEntries.status, "posted"),
              gte(journalEntries.date, range.from),
              lte(journalEntries.date, range.to),
            ),
          )
          .groupBy(journalEntries.id, journalEntries.sourceType);

  // AK-P2-08: the group of a cash movement comes from its counter-accounts —
  // each account's configurable cash_flow_group (fallback: aturan tipe di
  // resolveCashFlowGroup) — never from the journal's sourceType string.
  const entryIds = cashLines.map((row) => row.entryId);

  // FIX-ARS Tahap 3 (ARS3-02): baris lawan tidak lagi dimuat per baris
  // jurnal. SQL mengagregasi per (entri × akun lawan) — sum debit &
  // sum kredit — sehingga yang menyeberang ke JS adalah satu baris per
  // entri×akun, bukan per baris jurnal: memori turun dari O(total baris
  // jurnal dalam rentang) menjadi O(entri × akun lawan). Semantik
  // identik dengan muatan per baris lama:
  //   - efek kelompok di attributeEntry adalah Σ(credit − debit) atas
  //     baris-baris kelompok itu; penjumlahan Decimal eksak dan
  //     komutatif, jadi pengelompokan ulang per akun tidak mengubah
  //     total kelompok satu sen pun;
  //   - urutan kemunculan pertama tiap akun dipertahankan lewat
  //     orderBy (entryId, min(lineNo)) — urutan yang sama seperti baris
  //     mentah terurut lineNo — sehingga urutan penyisipan kelompok ke
  //     peta efek, dan pemenang sisa pembulatan saat efek seri, tidak
  //     berubah.
  // Baris akun kas sendiri disisihkan di SQL (notInArray), bukan di JS.
  // Id entri berasal dari kueri cashLines di atas (sudah terambil,
  // tanpa kueri tambahan) dan dikirim berpotong 10.000: batas parameter
  // bind PostgreSQL (65.535) tidak tertabrak pada rentang sangat besar,
  // dan satu entri tidak pernah terbelah antar-potongan sehingga
  // urutan per entrinya utuh. Bentuk subkueri IN pernah diukur dan
  // ditolak: perencana menjalankannya sebagai semi-join nested-loop
  // per baris (160 rb probe indeks pada dataset bench 40 rb entri);
  // bentuk inArray atas id yang sudah terambil memakai jalur indeks
  // entry_id dan terukur ±3× lebih cepat pada dataset yang sama.
  // Bukti kesetaraan: tests/integration/fix-ars-tahap3-cashflow-sql.test.ts
  // (referensi independen cara lama atas fixture yang sama) dan
  // pengukuran scripts/bench-cashflow.ts.
  const COUNTER_CHUNK_SIZE = 10_000;
  type CounterAggregate = {
    entryId: string;
    accountId: string;
    type: string;
    code: string;
    cashFlowGroup: string | null;
    debit: string;
    credit: string;
  };
  const counterLines: CounterAggregate[] = [];
  for (let start = 0; start < entryIds.length; start += COUNTER_CHUNK_SIZE) {
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
          eq(journalLines.companyId, companyId),
          notInArray(journalLines.accountId, [...cashAccountIds]),
          inArray(journalLines.entryId, entryIds.slice(start, start + COUNTER_CHUNK_SIZE)),
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
    counterLines.push(...rows);
  }

  const countersByEntry = new Map<string, CounterAggregate[]>();
  for (const line of counterLines) {
    const list = countersByEntry.get(line.entryId) ?? [];
    list.push(line);
    countersByEntry.set(line.entryId, list);
  }

  // FIX-R2 Tahap 3 (AK2-03): klasifikasi kini PER BARIS LAWAN, bukan satu
  // kelompok pemenang untuk satu jurnal utuh (aturan lama membuang porsi
  // beban operasi Rp10 jt ke investasi hanya karena baris peralatan
  // Rp90 jt lebih besar). Untuk satu entri:
  //   - efek kas tiap baris lawan = kredit − debit baris itu;
  //   - hanya baris lawan yang SEARAH dengan mutasi kas neto entri yang
  //     menjelaskan arus kasnya — baris lawan berlawanan arah adalah
  //     komponen non-kas jurnal majemuk (mis. porsi pembelian yang
  //     diutang, atau persediaan pada jurnal pembuka) dan tidak
  //     menciptakan arus kas;
  //   - mutasi kas neto entri dibagikan ke kelompok-kelompok searah
  //     secara proporsional terhadap |efek| kelompoknya, dengan sisa
  //     pembagian Decimal diberikan ke kelompok terbesar agar jumlah
  //     per entri selalu PERSIS mutasi kasnya (ikatan
  //     opening + net = closing tidak pernah pecah oleh klasifikasi).
  // Akun lawan yang kelompoknya tidak ter-resolusi (fallback tipe
  // mengembalikan null — akun aset tanpa penanda) masuk kelompok
  // "unclassified" (Belum terklasifikasi) yang TAMPIL sebagai kelompok
  // tersendiri, bukan dibuang diam-diam ke operasi.
  const attributeEntry = (entryId: string, cashNet: Decimal): Map<CashFlowBucket, Decimal> => {
    const attributed = new Map<CashFlowBucket, Decimal>();
    if (cashNet.isZero()) return attributed;
    const effects = new Map<CashFlowBucket, Decimal>();
    for (const line of countersByEntry.get(entryId) ?? []) {
      const group: CashFlowBucket = resolveCashFlowGroup(line) ?? "unclassified";
      const effect = d(line.credit).minus(d(line.debit));
      effects.set(group, (effects.get(group) ?? d(0)).plus(effect));
    }
    const aligned = [...effects.entries()].filter(
      ([, effect]) => !effect.isZero() && effect.isPositive() === cashNet.isPositive(),
    );
    if (aligned.length === 0) return attributed;
    const totalAligned = aligned.reduce((acc, [, effect]) => acc.plus(effect.abs()), d(0));
    // Kelompok terbesar menerima sisa persisnya (cashNet − Σ kelompok
    // lain), sehingga pembulatan proporsional tidak pernah menggeser
    // total entri satu sen pun.
    aligned.sort((a, b) => b[1].abs().comparedTo(a[1].abs()));
    let othersTotal = d(0);
    for (const [group, effect] of aligned.slice(1)) {
      const share = cashNet.mul(effect.abs()).div(totalAligned).toDecimalPlaces(4);
      attributed.set(group, share);
      othersTotal = othersTotal.plus(share);
    }
    attributed.set(aligned[0][0], cashNet.minus(othersTotal));
    return attributed;
  };

  // AK-P3-04: group totals and buckets accumulate in Decimal.
  const groups: Record<CashFlowBucket, Decimal> = {
    operating: d(0),
    investing: d(0),
    financing: d(0),
    unclassified: d(0),
  };
  const buckets = new Map<
    string,
    { sourceType: string; group: CashFlowBucket; inflow: Decimal; outflow: Decimal }
  >();
  for (const line of cashLines) {
    const cashNet = d(line.inflow).minus(d(line.outflow));
    for (const [group, share] of attributeEntry(line.entryId, cashNet)) {
      groups[group] = groups[group].plus(share);
      const key = `${line.sourceType}|${group}`;
      const bucket = buckets.get(key) ?? { sourceType: line.sourceType, group, inflow: d(0), outflow: d(0) };
      if (share.isPositive()) bucket.inflow = bucket.inflow.plus(share);
      else bucket.outflow = bucket.outflow.plus(share.abs());
      buckets.set(key, bucket);
    }
  }
  const rows = [...buckets.values()]
    .sort((a, b) => a.sourceType.localeCompare(b.sourceType) || a.group.localeCompare(b.group))
    .map((bucket) => ({
      sourceType: bucket.sourceType,
      group: bucket.group,
      inflow: bucket.inflow.toNumber(),
      outflow: bucket.outflow.toNumber(),
      net: bucket.inflow.minus(bucket.outflow).toNumber(),
    }));

  const netDec = groups.operating.plus(groups.investing).plus(groups.financing).plus(groups.unclassified);
  return {
    opening,
    rows,
    groups: {
      operating: groups.operating.toNumber(),
      investing: groups.investing.toNumber(),
      financing: groups.financing.toNumber(),
      unclassified: groups.unclassified.toNumber(),
    },
    net: netDec.toNumber(),
    closing: d(opening).plus(netDec).toNumber(),
  };
}

export async function getEquityStatement(tx: Tx, companyId: string, range: Range) {
  // FIX-ARS Tahap 2: saldo awal & mutasi akun ekuitas dari total
  // hibrida (kumulatif sebelum rentang + total rentang), menggantikan
  // dua agregasi CASE atas seluruh riwayat jurnal.
  const equityAccounts = await tx
    .select({ accountId: accounts.id, code: accounts.code, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.type, "equity")))
    .orderBy(asc(accounts.code));
  const beforeTotals = await cumulativeAccountTotals(tx, companyId, previousDay(range.from));
  const rangeTotals = await accountTotalsInRange(tx, companyId, range.from, range.to);
  const openingRows = equityAccounts.map((account) => {
    const totals = totalsOf(beforeTotals, account.accountId);
    return { ...account, opening: toDb(totals.credit.minus(totals.debit)) };
  });
  const movementRows = equityAccounts.map((account) => {
    const totals = totalsOf(rangeTotals, account.accountId);
    return { ...account, credit: toDb(totals.credit), debit: toDb(totals.debit) };
  });
  const [profit, priorProfit] = await Promise.all([
    getIncomeStatement(tx, companyId, range),
    // FIX-P1 (AK2-02): laba akumulasi SELURUH periode sebelum rentang.
    // Neraca menyajikan ekuitas sebagai akun ekuitas + laba sejak awal
    // waktu, jadi tanpa komponen ini saldo awal/akhir laporan ini
    // selalu kurang sebesar laba akumulasi sebelumnya untuk rentang
    // mana pun yang tidak dimulai dari awal waktu.
    getIncomeStatement(tx, companyId, { from: "1900-01-01", to: previousDay(range.from) }),
  ]);

  const movement = new Map(movementRows.map((row) => [row.accountId, row]));
  const accountRows = openingRows.map((row) => {
    const move = movement.get(row.accountId);
    const addition = d(move?.credit ?? 0);
    const reduction = d(move?.debit ?? 0);
    const opening = d(row.opening);
    return {
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      opening: opening.toNumber(),
      addition: addition.toNumber(),
      reduction: reduction.toNumber(),
      closing: opening.plus(addition).minus(reduction).toNumber(),
    };
  });

  // FIX-P1 (AK2-02): laba akumulasi sebelum rentang tampil sebagai
  // baris tersendiri agar total awal/akhir laporan ini SELALU sama
  // dengan ekuitas neraca pada tanggal yang sama (neraca: akun ekuitas
  // + laba 1900→tanggal). Baris hanya muncul bila akumulasinya bukan
  // nol, sehingga rentang sejak awal waktu tampil persis seperti
  // sebelumnya. Laba rentang berjalan tetap baris "Laba periode
  // berjalan" tersendiri lewat netProfit di bawah.
  const rows = d(priorProfit.netProfit).isZero()
    ? accountRows
    : [
        ...accountRows,
        {
          accountId: "retained-earnings",
          code: "",
          name: "Laba ditahan (akumulasi periode sebelumnya)",
          opening: priorProfit.netProfit,
          addition: 0,
          reduction: 0,
          closing: priorProfit.netProfit,
        },
      ];

  return {
    rows,
    netProfit: profit.netProfit,
    totalOpening: rows.reduce((acc, r) => acc.plus(r.opening), d(0)).toNumber(),
    totalClosing: rows
      .reduce((acc, r) => acc.plus(r.closing), d(0))
      .plus(profit.netProfit)
      .toNumber(),
  };
}
