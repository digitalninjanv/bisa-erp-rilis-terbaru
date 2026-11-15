import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountMappings, accounts, companySettings, journalEntries, journalLines } from "@/db/schema";
import { ensureFiscalPeriods, postJournal, reverseJournalEntry } from "@/server/accounting";
import { getCashFlow, mappedBalance, type CashFlowBucket } from "@/server/reports";
import { resolveCashFlowGroup } from "@/lib/accounting";
import { d, Decimal } from "@/lib/money";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-ARS Tahap 3 (ARS3-02) — agregasi baris lawan arus kas di SQL.
//
// Kontrak yang dibuktikan berkas ini: getCashFlow TIDAK lagi memuat
// seluruh baris jurnal lawan ke memori. Baris lawan diagregasi di SQL
// per (entri × akun lawan) — sum debit/kredit + urutan kemunculan
// pertama akun (min lineNo) — dan hanya agregat itu yang menyeberang
// ke JS; resolusi kelompok (resolveCashFlowGroup) dan atribusi
// proporsional per entri tetap di JS atas agregat.
//
// Pembuktian kesetaraan: referenceCashFlow() di bawah menghitung ulang
// hasil dengan CARA LAMA yang independen — memuat baris jurnal mentah
// terurut (entryId, lineNo) dan mengatribusi PER BARIS — atas fixture
// yang sama. Hasil produksi harus identik secara kanonis (semua uang
// dibandingkan sebagai string 4 desimal) untuk setiap skenario, dan
// ikatan opening + net = closing harus persis. Setiap skenario juga
// membawa ekspektasi hitung-tangan agar kebenaran absolutnya terjangkar,
// bukan hanya kesetaraan dua implementasi.
//
// Perusahaan fixture KHUSUS berkas ini (fa01), transaksi rollback per
// test; data demo tidak disentuh.

const ORG_ID = "01900000-0000-7000-8000-00000000fa01";
const USER_ID = "user-uji-fix-ars-tahap3";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: ORG_ID },
    user: { id: USER_ID },
    role: "owner",
  });
  return { requirePermission, requirePermissionInModule: requirePermission };
});

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

// [kode, nama, tipe, saldo normal, section, cash_flow_group eksplisit]
const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit", string | null, string | null]> = [
  ["1000", "Kas", "asset", "debit", "current_asset", null],
  ["1100", "Bank BCA", "asset", "debit", "current_asset", null],
  ["1110", "QRIS Clearing", "asset", "debit", "current_asset", null],
  ["1200", "Piutang Usaha", "asset", "debit", "current_asset", "operating"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit", "current_asset", "operating"],
  ["1500", "Aset Tetap", "asset", "debit", "non_current_asset", "investing"],
  // Tanpa section & tanpa cash_flow_group → resolusi null → "unclassified".
  ["1999", "Aset Lain-lain", "asset", "debit", null, null],
  ["2000", "Utang Usaha", "liability", "credit", "current_liability", "operating"],
  ["2100", "Utang Bank", "liability", "credit", "non_current_liability", "financing"],
  ["3000", "Modal Pemilik", "equity", "credit", "equity", "financing"],
  ["4000", "Penjualan", "revenue", "credit", "revenue", "operating"],
  ["6010", "Beban Sewa", "expense", "debit", "operating_expense", "operating"],
  ["6020", "Beban Gaji", "expense", "debit", "operating_expense", "operating"],
  ["6030", "Beban Listrik", "expense", "debit", "operating_expense", "operating"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
};

// A-28 Tahap 3 (H-AKT-02): subjek kas produksi kini himpunan KELAS
// kas/bank, bukan pemetaan. Akun kas fixture diberi kelas yang sama
// dengan penunjukan pemetaannya agar himpunan kelas == himpunan
// pemetaan pada fixture ini — kesetaraan yang dibuktikan berkas ini
// (agregasi SQL vs per-baris) tidak berubah cakupannya.
const CASH_BANK_KIND_BY_CODE: Record<string, string> = {
  "1000": "cash",
  "1100": "bank",
  "1110": "clearing",
};

async function ensureFixtureCompany() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_ID))
      .limit(1);
    if (existing) return;

    await tx.insert(companySettings).values({
      companyId: ORG_ID,
      legalName: "Uji FIX-ARS Tahap 3",
      roundingMode: "none",
      taxRate: "0",
      taxEnabled: false,
      // Skenario sengaja menggerakkan kas dari nol; penjaga saldo
      // negatif bukan subjek berkas ini.
      cashNegativePolicy: "allow",
    });

    const accountRows = await tx
      .insert(accounts)
      .values(
        ACCOUNT_SEEDS.map(([code, name, type, normalBalance, section, cashFlowGroup]) => ({
          companyId: ORG_ID,
          code,
          name,
          type,
          normalBalance,
          section,
          cashFlowGroup,
          cashBankKind: CASH_BANK_KIND_BY_CODE[code] ?? null,
        })),
      )
      .returning();
    const acc = new Map(accountRows.map((row) => [row.code, row.id]));
    await tx.insert(accountMappings).values(
      Object.entries(MAPPING_SEEDS).map(([key, code]) => ({
        companyId: ORG_ID,
        key,
        accountId: acc.get(code)!,
      })),
    );
    // Semua skenario berkas ini bertanggal 2027; materialisasi periode
    // eksplisit agar posting tidak bergantung jendela lazy tahun
    // berjalan/berikutnya.
    await ensureFiscalPeriods(tx, ORG_ID, 2027);
  });
}

beforeAll(ensureFixtureCompany);

async function accountIdByCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada di fixture`);
  return row.id;
}

async function post(
  tx: Tx,
  input: {
    date: string;
    description: string;
    sourceType: string;
    lines: Array<{ code: string; debit?: string; credit?: string }>;
  },
) {
  const lines = await Promise.all(
    input.lines.map(async (line) => ({
      accountId: await accountIdByCode(tx, line.code),
      debit: line.debit,
      credit: line.credit,
    })),
  );
  return postJournal(tx, {
    companyId: ORG_ID,
    date: input.date,
    description: input.description,
    sourceType: input.sourceType,
    createdBy: USER_ID,
    lines,
  });
}

/* ------------------------------------------------------------------ */
/* Implementasi referensi — CARA LAMA (per baris jurnal)               */
/* ------------------------------------------------------------------ */

type CashFlowResult = Awaited<ReturnType<typeof getCashFlow>>;
type Range = { from: string; to: string };

function previousDay(date: string): string {
  const dt = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * Menghitung arus kas persis seperti implementasi produksi SEBELUM
 * tahap ini: seluruh baris jurnal lawan dimuat mentah (terurut entryId,
 * lineNo) dan efek kelompok diakumulasi PER BARIS di JS. Satu-satunya
 * yang dibagi dengan produksi adalah mappedBalance untuk saldo awal —
 * komponen Tahap 2 yang tidak diubah tahap ini.
 */
async function referenceCashFlow(tx: Tx, range: Range): Promise<CashFlowResult> {
  const cashKeys = ["cash", "bank", "qris"];
  const opening = await mappedBalance(tx, ORG_ID, cashKeys, { to: previousDay(range.from) });

  const mappingRows = await tx
    .select({ accountId: accountMappings.accountId })
    .from(accountMappings)
    .where(and(eq(accountMappings.companyId, ORG_ID), inArray(accountMappings.key, cashKeys)));
  const cashAccountIds = new Set(mappingRows.map((row) => row.accountId));

  const entries = await tx
    .select({ id: journalEntries.id, sourceType: journalEntries.sourceType })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.status, "posted"),
        gte(journalEntries.date, range.from),
        lte(journalEntries.date, range.to),
      ),
    );
  const entryIds = entries.map((entry) => entry.id);
  const sourceTypeByEntry = new Map(entries.map((entry) => [entry.id, entry.sourceType]));

  const rawLines =
    entryIds.length === 0
      ? []
      : await tx
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
          .where(and(eq(journalLines.companyId, ORG_ID), inArray(journalLines.entryId, entryIds)))
          .orderBy(asc(journalLines.entryId), asc(journalLines.lineNo));

  const cashNetByEntry = new Map<string, Decimal>();
  const countersByEntry = new Map<string, typeof rawLines>();
  for (const line of rawLines) {
    if (cashAccountIds.has(line.accountId)) {
      const current = cashNetByEntry.get(line.entryId) ?? d(0);
      cashNetByEntry.set(line.entryId, current.plus(d(line.debit).minus(d(line.credit))));
    } else {
      const list = countersByEntry.get(line.entryId) ?? [];
      list.push(line);
      countersByEntry.set(line.entryId, list);
    }
  }

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
  for (const [entryId, cashNet] of cashNetByEntry) {
    const sourceType = sourceTypeByEntry.get(entryId)!;
    for (const [group, share] of attributeEntry(entryId, cashNet)) {
      groups[group] = groups[group].plus(share);
      const key = `${sourceType}|${group}`;
      const bucket = buckets.get(key) ?? { sourceType, group, inflow: d(0), outflow: d(0) };
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

/* ------------------------------------------------------------------ */
/* Perbandingan kanonis                                                */
/* ------------------------------------------------------------------ */

function canonical(flow: CashFlowResult) {
  return {
    opening: d(flow.opening).toFixed(4),
    net: d(flow.net).toFixed(4),
    closing: d(flow.closing).toFixed(4),
    groups: {
      operating: d(flow.groups.operating).toFixed(4),
      investing: d(flow.groups.investing).toFixed(4),
      financing: d(flow.groups.financing).toFixed(4),
      unclassified: d(flow.groups.unclassified).toFixed(4),
    },
    rows: flow.rows.map((row) => ({
      sourceType: row.sourceType,
      group: row.group,
      inflow: d(row.inflow).toFixed(4),
      outflow: d(row.outflow).toFixed(4),
      net: d(row.net).toFixed(4),
    })),
  };
}

async function expectCashFlowEqual(tx: Tx, range: Range): Promise<CashFlowResult> {
  const actual = await getCashFlow(tx, ORG_ID, range);
  const expected = await referenceCashFlow(tx, range);
  expect(canonical(actual)).toEqual(canonical(expected));
  // Ikatan akuntansi arus kas: opening + net = closing, persis.
  expect(d(actual.opening).plus(d(actual.net)).toFixed(4)).toBe(d(actual.closing).toFixed(4));
  return actual;
}

/* ------------------------------------------------------------------ */
/* Skenario                                                            */
/* ------------------------------------------------------------------ */

describe("ARS3-02 — getCashFlow teragregasi SQL == referensi per baris", () => {
  it("entri kas sederhana: penjualan tunai satu lawan", async () => {
    await rollbackTransaction(async (tx) => {
      await post(tx, {
        date: "2027-01-10",
        description: "Penjualan tunai",
        sourceType: "sale",
        lines: [
          { code: "1000", debit: "5000000" },
          { code: "4000", credit: "5000000" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-01-01", to: "2027-01-31" });
      expect(flow.groups.operating).toBe(5000000);
      expect(flow.groups.investing).toBe(0);
      expect(flow.net).toBe(5000000);
      expect(flow.rows).toEqual([
        { sourceType: "sale", group: "operating", inflow: 5000000, outflow: 0, net: 5000000 },
      ]);
    });
  });

  it("multi-lawan lintas kelompok: proporsi berdesimal berulang + sisa ke kelompok terbesar + lawan tak searah tersisih", async () => {
    await rollbackTransaction(async (tx) => {
      // Kas keluar 100. Lawan searah: sewa (operasi) efek −100 dan aset
      // tetap (investasi) efek −200 → total searah 300; bagian operasi
      // = −100 × 100/300 = −33,3333… dibulatkan 4 desimal −33,3333 dan
      // investasi menerima sisa persis −66,6667. Lawan utang bank
      // (pendanaan) berkredit +200 BERLAWANAN arah dengan kas keluar —
      // komponen non-kas yang tidak boleh menciptakan arus.
      await post(tx, {
        date: "2027-02-10",
        description: "Bayar sewa + DP peralatan, sebagian diutang bank",
        sourceType: "manual",
        lines: [
          { code: "6010", debit: "100" },
          { code: "1500", debit: "200" },
          { code: "2100", credit: "200" },
          { code: "1000", credit: "100" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-02-01", to: "2027-02-28" });
      expect(d(flow.groups.operating).toFixed(4)).toBe("-33.3333");
      expect(d(flow.groups.investing).toFixed(4)).toBe("-66.6667");
      expect(flow.groups.financing).toBe(0);
      expect(flow.net).toBe(-100);
    });
  });

  it("tiga kelompok SERI: sisa pembulatan jatuh ke kelompok yang PERTAMA muncul (urutan lineNo), bukan urutan kode akun", async () => {
    await rollbackTransaction(async (tx) => {
      // Tiga lawan searah berefek sama besar (−1): operasi (6010,
      // lineNo 1), investasi (1500, lineNo 2), pendanaan (2100 debit,
      // lineNo 3). Kas neto −1 atas total searah 3 → bagian per kelompok
      // −0,3333…; kelompok pertama muncul (operasi) menerima sisa
      // −0,3334. Bila agregasi SQL mengurutkan akun menurut kode
      // (1500 < 2100 < 6010), investasi yang akan menerima sisa dan
      // test ini gagal — inilah penjaga urutan kemunculan pertama.
      await post(tx, {
        date: "2027-03-10",
        description: "Pembayaran campuran tiga kelompok seri",
        sourceType: "manual",
        lines: [
          { code: "6010", debit: "1" },
          { code: "1500", debit: "1" },
          { code: "2100", debit: "1" },
          { code: "1999", credit: "2" },
          { code: "1000", credit: "1" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-03-01", to: "2027-03-31" });
      expect(d(flow.groups.operating).toFixed(4)).toBe("-0.3334");
      expect(d(flow.groups.investing).toFixed(4)).toBe("-0.3333");
      expect(d(flow.groups.financing).toFixed(4)).toBe("-0.3333");
      expect(flow.groups.unclassified).toBe(0);
      expect(flow.net).toBe(-1);
    });
  });

  it("lawan tak terpetakan → kelompok Belum terklasifikasi", async () => {
    await rollbackTransaction(async (tx) => {
      await post(tx, {
        date: "2027-04-12",
        description: "Beli aset lain-lain dari bank",
        sourceType: "manual",
        lines: [
          { code: "1999", debit: "7000000" },
          { code: "1100", credit: "7000000" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-04-01", to: "2027-04-30" });
      expect(flow.groups.unclassified).toBe(-7000000);
      expect(flow.groups.operating).toBe(0);
      expect(flow.rows.some((row) => row.group === "unclassified")).toBe(true);
    });
  });

  it("entri campuran kas+bank dalam satu jurnal + transfer kas↔bank neto nol tidak menyumbang arus", async () => {
    await rollbackTransaction(async (tx) => {
      await post(tx, {
        date: "2027-05-08",
        description: "Penjualan diterima kas dan bank",
        sourceType: "sale",
        lines: [
          { code: "1000", debit: "30000000" },
          { code: "1100", debit: "70000000" },
          { code: "4000", credit: "100000000" },
        ],
      });
      await post(tx, {
        date: "2027-05-09",
        description: "Setor kas ke bank",
        sourceType: "bank_transfer",
        lines: [
          { code: "1100", debit: "50000000" },
          { code: "1000", credit: "50000000" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-05-01", to: "2027-05-31" });
      expect(flow.groups.operating).toBe(100000000);
      expect(flow.net).toBe(100000000);
      expect(flow.rows.some((row) => row.sourceType === "bank_transfer")).toBe(false);
    });
  });

  it("jurnal balik: pembayaran beban dan pembalikannya dalam rentang yang sama saling meniadakan", async () => {
    await rollbackTransaction(async (tx) => {
      const original = await post(tx, {
        date: "2027-06-10",
        description: "Bayar sewa Juni",
        sourceType: "expense",
        lines: [
          { code: "6010", debit: "2000000" },
          { code: "1000", credit: "2000000" },
        ],
      });
      await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: original.id,
        date: "2027-06-15",
        createdBy: USER_ID,
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-06-01", to: "2027-06-30" });
      expect(flow.groups.operating).toBe(0);
      expect(flow.net).toBe(0);
      expect(flow.closing).toBe(flow.opening);
      // Kedua jurnal tetap tampil sebagai ember tersendiri: jurnal asal
      // (expense) sebagai keluar, pembaliknya (expense_reversal —
      // konvensi sourceType reverseJournalEntry) sebagai masuk.
      const expenseRow = flow.rows.find((row) => row.sourceType === "expense");
      expect(expenseRow?.inflow).toBe(0);
      expect(expenseRow?.outflow).toBe(2000000);
      const reversalRow = flow.rows.find((row) => row.sourceType === "expense_reversal");
      expect(reversalRow?.inflow).toBe(2000000);
      expect(reversalRow?.outflow).toBe(0);
    });
  });

  it("satu entri berisi BANYAK baris lawan sekelompok & seakun berulang (kasus yang paling berubah bentuk datanya)", async () => {
    await rollbackTransaction(async (tx) => {
      // 10 baris lawan: 8 baris operasi atas 3 akun beban (satu akun
      // muncul 3×) + 2 baris investasi atas akun yang sama. Agregasi
      // SQL meruntuhkan 10 baris mentah menjadi 4 baris (entri × akun);
      // referensi per baris harus memberi angka yang sama persis.
      await post(tx, {
        date: "2027-07-20",
        description: "Pembayaran borongan akhir bulan",
        sourceType: "manual",
        lines: [
          { code: "6010", debit: "100" },
          { code: "6010", debit: "200" },
          { code: "6010", debit: "300" },
          { code: "6020", debit: "10" },
          { code: "6020", debit: "20" },
          { code: "6020", debit: "30" },
          { code: "6030", debit: "150" },
          { code: "6030", debit: "180" },
          { code: "1500", debit: "500" },
          { code: "1500", debit: "490" },
          { code: "1000", credit: "1980" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-07-01", to: "2027-07-31" });
      expect(flow.groups.operating).toBe(-990);
      expect(flow.groups.investing).toBe(-990);
      expect(flow.net).toBe(-1980);
    });
  });

  it("rentang kosong: tidak ada baris, kelompok nol, closing = opening", async () => {
    await rollbackTransaction(async (tx) => {
      await post(tx, {
        date: "2027-01-05",
        description: "Satu-satunya jurnal fixture test ini",
        sourceType: "sale",
        lines: [
          { code: "1000", debit: "1234500" },
          { code: "4000", credit: "1234500" },
        ],
      });
      const flow = await expectCashFlowEqual(tx, { from: "2027-03-01", to: "2027-03-31" });
      expect(flow.rows).toEqual([]);
      expect(flow.groups).toEqual({ operating: 0, investing: 0, financing: 0, unclassified: 0 });
      expect(flow.net).toBe(0);
      expect(flow.opening).toBe(1234500);
      expect(flow.closing).toBe(flow.opening);
    });
  });

  it("membaca arus kas lebih dari satu batch cursor dengan hasil yang tetap identik", async () => {
    await rollbackTransaction(async (tx) => {
      const cashAccountId = await accountIdByCode(tx, "1000");
      const salesAccountId = await accountIdByCode(tx, "4000");
      const entryCount = 10_001;
      const insertBatchSize = 1_000;

      for (let start = 0; start < entryCount; start += insertBatchSize) {
        const batchCount = Math.min(insertBatchSize, entryCount - start);
        const entries = await tx
          .insert(journalEntries)
          .values(
            Array.from({ length: batchCount }, (_, offset) => ({
              companyId: ORG_ID,
              number: `ARSCURSOR-${String(start + offset + 1).padStart(5, "0")}`,
              date: "2027-08-01",
              description: "Uji cursor arus kas",
              sourceType: "sale",
              status: "posted",
            })),
          )
          .returning({ id: journalEntries.id });

        await tx.insert(journalLines).values(
          entries.flatMap(({ id }) => [
            {
              companyId: ORG_ID,
              entryId: id,
              accountId: cashAccountId,
              debit: "1.2500",
              credit: "0",
              lineNo: 1,
            },
            {
              companyId: ORG_ID,
              entryId: id,
              accountId: salesAccountId,
              debit: "0",
              credit: "1.2500",
              lineNo: 2,
            },
          ]),
        );
      }

      const flow = await expectCashFlowEqual(tx, { from: "2027-08-01", to: "2027-08-31" });
      expect(flow.opening).toBe(0);
      expect(flow.net).toBe(entryCount * 1.25);
      expect(flow.closing).toBe(flow.opening + flow.net);
    });
  });
});
