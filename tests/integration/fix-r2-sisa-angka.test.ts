import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  customers,
  journalEntries,
  journalLines,
  products,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { postJournal, reverseJournalEntry } from "@/server/accounting";
import { createBankTransfer } from "@/server/bank-transfers";
import { createExpense } from "@/server/expenses";
import { createReceipt } from "@/server/inventory";
import { createOpeningBalance, payOpeningBalance } from "@/server/opening-balances";
import { payPayableDocument } from "@/server/payables";
import { payPayableFifo } from "@/server/quick-entry";
import { getBalanceSheet, getCashFlow, getControlReconciliation } from "@/server/reports";
import { AppError } from "@/lib/errors";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-R2 Tahap 3 (A-16) — sisa angka terkonfirmasi audit ronde 2:
//   RV2-01/AK3-11 penjaga saldo kas/bank negatif terkonfigurasi
//                 (allow | warn | block, bawaan warn) di postJournal;
//   AK2-03        arus kas per baris lawan + kelompok "unclassified";
//   AK2-04        fallback kelompok laporan dari tipe, bukan kode;
//   AK2-07        rekonsiliasi kontrol vs subledger.
// Semua skenario berjalan di perusahaan fixture KHUSUS berkas ini
// (f601) dalam transaksi rollback.

const ORG_ID = "01900000-0000-7000-8000-00000000f601";
const USER_ID = "user-uji-fix-r2-tahap3";
const TODAY = todayISO();

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

// [kode, nama, tipe, saldo normal, section eksplisit, cash_flow_group eksplisit]
// Penanda eksplisit meniru bagan akun standar hasil FIX-R2 Tahap 3.
const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit", string | null, string | null]> = [
  ["1000", "Kas", "asset", "debit", "current_asset", null],
  ["1100", "Bank BCA", "asset", "debit", "current_asset", null],
  ["1110", "QRIS Clearing", "asset", "debit", "current_asset", null],
  ["1200", "Piutang Usaha", "asset", "debit", "current_asset", "operating"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit", "current_asset", "operating"],
  ["1500", "Aset Tetap", "asset", "debit", "non_current_asset", "investing"],
  ["2000", "Utang Usaha", "liability", "credit", "current_liability", "operating"],
  ["3000", "Modal Pemilik", "equity", "credit", "equity", "financing"],
  ["4000", "Penjualan", "revenue", "credit", "revenue", "operating"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit", "cogs", "operating"],
  ["6010", "Beban Sewa", "expense", "debit", "operating_expense", "operating"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
  receivable: "1200",
  inventory: "1300",
  payable: "2000",
  equity: "3000",
  revenue: "4000",
  cogs: "5000",
};

let warehouseId = "";
let supplierId = "";
let customerId = "";
let productId = "";

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
      legalName: "Uji FIX-R2 Tahap 3",
      roundingMode: "none",
      taxRate: "0",
      taxEnabled: false,
      // cashNegativePolicy SENGAJA tidak diisi: bawaan kolom migrasi
      // 0042 ("warn") adalah bagian dari yang diuji.
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
          // A-27 B1/B2: akun terpetakan cash/bank/qris berkelas —
          // kelas diturunkan dari MAPPING_SEEDS, meniru backfill
          // migrasi 0055 (perusahaan fixture yang sudah ada di DB
          // lokal telah ter-backfill oleh migrasi itu sendiri).
          cashBankKind:
            MAPPING_SEEDS.cash === code
              ? "cash"
              : MAPPING_SEEDS.bank === code
                ? "bank"
                : MAPPING_SEEDS.qris === code
                  ? "clearing"
                  : null,
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

    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: ORG_ID, name: "Gudang Uji R2-3", code: "GD-R23" })
      .returning();
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: ORG_ID, code: "SUP-R23", name: "PT Pemasok Uji R2" })
      .returning();
    const [customer] = await tx
      .insert(customers)
      .values({ companyId: ORG_ID, code: "CUST-R23", name: "Pelanggan Uji R2" })
      .returning();
    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG_ID,
        sku: "R23-001",
        name: "Produk Uji R2",
        costPrice: "0",
        salePrice: "150000",
      })
      .returning();
    warehouseId = warehouse.id;
    supplierId = supplier.id;
    customerId = customer.id;
    productId = product.id;
  });

  if (!warehouseId) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
      const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, ORG_ID)).limit(1);
      const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, ORG_ID)).limit(1);
      const [customer] = await tx.select({ id: customers.id }).from(customers).where(eq(customers.companyId, ORG_ID)).limit(1);
      const [product] = await tx.select({ id: products.id }).from(products).where(eq(products.companyId, ORG_ID)).limit(1);
      warehouseId = warehouse.id;
      supplierId = supplier.id;
      customerId = customer.id;
      productId = product.id;
    });
  }
}

beforeAll(ensureFixtureCompany);

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

async function accountIdByCode(tx: Tx, code: string): Promise<string> {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, code)))
    .limit(1);
  if (!row) throw new Error(`Akun ${code} tidak ada di fixture`);
  return row.id;
}

async function setPolicy(tx: Tx, policy: "allow" | "warn" | "block") {
  await tx.update(companySettings).set({ cashNegativePolicy: policy }).where(eq(companySettings.companyId, ORG_ID));
}

/** Saldo GL satu akun (debit − kredit, seluruh jurnal posted). */
async function glBalance(tx: Tx, code: string) {
  const accountId = await accountIdByCode(tx, code);
  const rows = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, ORG_ID),
        eq(journalLines.accountId, accountId),
        eq(journalEntries.status, "posted"),
      ),
    );
  return rows.reduce((acc, row) => acc.plus(row.debit).minus(row.credit), d(0));
}

/** Setoran modal ke bank — jurnal MASUK, tidak pernah memicu penjaga. */
async function fundBank(tx: Tx, amount: string) {
  const bank = await accountIdByCode(tx, "1100");
  const equity = await accountIdByCode(tx, "3000");
  return postJournal(tx, {
    companyId: ORG_ID,
    date: TODAY,
    description: "Setoran modal uji",
    sourceType: "manual",
    createdBy: USER_ID,
    lines: [
      { accountId: bank, debit: amount },
      { accountId: equity, credit: amount },
    ],
  });
}

async function createAccount(
  tx: Tx,
  input: { code: string; name: string; type: string; normalBalance: "debit" | "credit"; section?: string | null; cashFlowGroup?: string | null },
) {
  const [row] = await tx
    .insert(accounts)
    .values({
      companyId: ORG_ID,
      code: input.code,
      name: input.name,
      type: input.type,
      normalBalance: input.normalBalance,
      section: input.section ?? null,
      cashFlowGroup: input.cashFlowGroup ?? null,
    })
    .returning({ id: accounts.id });
  return row.id;
}

/* ------------------------------------------------------------------ */
/* RV2-01 / AK3-11 — penjaga saldo kas/bank negatif                    */
/* ------------------------------------------------------------------ */

describe("RV2-01 — mode block menolak posting yang membuat kas/bank negatif", () => {
  it("jalur beban: ditolak, pesan menyebut akun & saldo proyeksi, tidak ada jurnal", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "block");
      await fundBank(tx, "1000000");
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const bankId = await accountIdByCode(tx, "1100");
      let caught: unknown;
      try {
        await createExpense(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          expenseAccountId,
          paymentAccountId: bankId,
          amount: "5000000",
          description: "Beban melebihi saldo bank",
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      const message = (caught as AppError).message;
      expect(message).toContain("1100");
      expect(message).toContain("4.000.000");
      expect((await glBalance(tx, "1100")).toFixed(0)).toBe("1000000");
      const expenseJournals = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.sourceType, "expense")));
      expect(expenseJournals).toHaveLength(0);
    });
  });

  it("jalur pembayaran utang: ditolak dan paidAmount penerimaan tidak berubah", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "block");
      await fundBank(tx, "300000");
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: TODAY,
        lines: [{ productId, qty: "2", unitCost: "500000" }],
      });
      const bankId = await accountIdByCode(tx, "1100");
      await expect(
        payPayableDocument(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          receiptId: receipt.id,
          date: TODAY,
          amount: "800000",
          accountId: bankId,
        }),
      ).rejects.toBeInstanceOf(AppError);
      const [row] = await tx
        .select({ paidAmount: stockReceipts.paidAmount })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.paidAmount).toFixed(0)).toBe("0");
    });
  });

  it("jurnal pembalik DIKECUALIKAN: koreksi tetap bisa diposting walau hasilnya negatif", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "block");
      const funding = await fundBank(tx, "10000000");
      // Membalik setoran mengkredit bank 10 jt → proyeksi −10 jt dari
      // saldo berjalan sesudahnya; penjaga tidak boleh menjebak koreksi.
      const result = await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: funding.id,
        date: TODAY,
        description: "Koreksi setoran uji",
      });
      expect(result.reversal.number).toBeTruthy();
      expect((await glBalance(tx, "1100")).toFixed(0)).toBe("0");
    });
  });
});

describe("RV2-01 — mode warn memposting dengan peringatan berisi saldo proyeksi", () => {
  it("jalur beban: jurnal terposting, warnings terisi, saldo bank menjadi negatif persis", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "warn");
      await fundBank(tx, "1000000");
      const expense = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId: await accountIdByCode(tx, "6010"),
        paymentAccountId: await accountIdByCode(tx, "1100"),
        amount: "5000000",
        description: "Beban mendahului setoran",
      });
      expect(expense.warnings).toHaveLength(1);
      expect(expense.warnings[0]).toContain("1100");
      expect(expense.warnings[0]).toContain("4.000.000");
      expect((await glBalance(tx, "1100")).toFixed(0)).toBe("-4000000");
    });
  });

  it("jalur transfer keluar: peringatan dari akun asal", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "warn");
      await fundBank(tx, "1000000");
      const transfer = await createBankTransfer(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        fromAccountId: await accountIdByCode(tx, "1100"),
        toAccountId: await accountIdByCode(tx, "1000"),
        amount: "3000000",
      });
      expect(transfer.warnings).toHaveLength(1);
      expect(transfer.warnings[0]).toContain("2.000.000");
      expect((await glBalance(tx, "1100")).toFixed(0)).toBe("-2000000");
    });
  });

  it("jalur pembayaran saldo awal utang: peringatan diteruskan", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "warn");
      const doc = await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplierId,
        date: TODAY,
        amount: "2000000",
      });
      await fundBank(tx, "500000");
      const paid = await payOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        openingId: doc.id,
        date: TODAY,
        amount: "2000000",
        accountId: await accountIdByCode(tx, "1100"),
      });
      expect(paid.warnings).toHaveLength(1);
      expect(paid.warnings[0]).toContain("1.500.000");
    });
  });

  it("jalur quick entry FIFO bayar utang: peringatan diagregasi", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "warn");
      await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplierId,
        date: TODAY,
        amount: "3000000",
      });
      await fundBank(tx, "1000000");
      const result = await payPayableFifo(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId,
        date: TODAY,
        amount: "3000000",
        accountId: await accountIdByCode(tx, "1100"),
      });
      expect(result.numbers).toHaveLength(1);
      expect(result.warnings.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings[0]).toContain("2.000.000");
    });
  });
});

describe("RV2-01 — mode allow & bawaan", () => {
  it("mode allow = perilaku lama persis: terposting, tanpa peringatan, saldo negatif terbentuk", async () => {
    await rollbackTransaction(async (tx) => {
      await setPolicy(tx, "allow");
      const expense = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId: await accountIdByCode(tx, "6010"),
        paymentAccountId: await accountIdByCode(tx, "1100"),
        amount: "5000000",
        description: "Beban tanpa penjaga",
      });
      expect(expense.warnings).toEqual([]);
      expect((await glBalance(tx, "1100")).toFixed(0)).toBe("-5000000");
    });
  });

  it("bawaan perusahaan baru adalah warn (kolom migrasi 0042), bukan allow diam-diam", async () => {
    await rollbackTransaction(async (tx) => {
      const [settings] = await tx
        .select({ cashNegativePolicy: companySettings.cashNegativePolicy })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_ID))
        .limit(1);
      expect(settings.cashNegativePolicy).toBe("warn");
      const expense = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId: await accountIdByCode(tx, "6010"),
        paymentAccountId: await accountIdByCode(tx, "1100"),
        amount: "5000000",
        description: "Beban pada kebijakan bawaan",
      });
      expect(expense.warnings).toHaveLength(1);
    });
  });
});

/* ------------------------------------------------------------------ */
/* AK2-03 — arus kas per baris lawan                                   */
/* ------------------------------------------------------------------ */

describe("AK2-03 — klasifikasi arus kas per baris lawan", () => {
  it("jurnal majemuk: beban 10 jt + peralatan 90 jt dari bank 100 jt → operasi −10 jt & investasi −90 jt", async () => {
    await rollbackTransaction(async (tx) => {
      const bank = await accountIdByCode(tx, "1100");
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-05-10",
        description: "Bayar sewa + beli peralatan",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "6010"), debit: "10000000" },
          { accountId: await accountIdByCode(tx, "1500"), debit: "90000000" },
          { accountId: bank, credit: "100000000" },
        ],
      });
      const flow = await getCashFlow(tx, ORG_ID, { from: "2027-05-01", to: "2027-05-31" });
      expect(flow.groups.operating).toBe(-10000000);
      expect(flow.groups.investing).toBe(-90000000);
      expect(flow.groups.financing).toBe(0);
      expect(flow.groups.unclassified).toBe(0);
      expect(flow.net).toBe(-100000000);
      // Ikatan akuntansi arus kas tidak pecah oleh klasifikasi baru.
      expect(flow.closing).toBe(flow.opening + flow.net);
    });
  });

  it("jurnal pembuka majemuk: komponen non-kas (persediaan) tidak menciptakan arus kas operasi", async () => {
    await rollbackTransaction(async (tx) => {
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-06-05",
        description: "Saldo awal usaha uji",
        sourceType: "opening",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "1000"), debit: "50000000" },
          { accountId: await accountIdByCode(tx, "1300"), debit: "28000000" },
          { accountId: await accountIdByCode(tx, "3000"), credit: "78000000" },
        ],
      });
      const flow = await getCashFlow(tx, ORG_ID, { from: "2027-06-01", to: "2027-06-30" });
      // Hanya kas yang benar-benar masuk yang menjadi arus pendanaan;
      // baris persediaan searah kas adalah komponen non-kas jurnal ini.
      expect(flow.groups.financing).toBe(50000000);
      expect(flow.groups.operating).toBe(0);
      expect(flow.groups.unclassified).toBe(0);
      expect(flow.net).toBe(50000000);
      expect(flow.closing).toBe(flow.opening + flow.net);
    });
  });

  it("akun lawan tanpa kelompok → baris Belum terklasifikasi, bukan operasi diam-diam", async () => {
    await rollbackTransaction(async (tx) => {
      const otherAsset = await createAccount(tx, {
        code: "1999",
        name: "Aset Lain-lain Uji",
        type: "asset",
        normalBalance: "debit",
        // tanpa section & tanpa cash_flow_group → resolusi null
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-07-12",
        description: "Beli aset lain-lain",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: otherAsset, debit: "7000000" },
          { accountId: await accountIdByCode(tx, "1100"), credit: "7000000" },
        ],
      });
      const flow = await getCashFlow(tx, ORG_ID, { from: "2027-07-01", to: "2027-07-31" });
      expect(flow.groups.unclassified).toBe(-7000000);
      expect(flow.groups.operating).toBe(0);
      expect(flow.net).toBe(-7000000);
      expect(flow.rows.some((row) => row.group === "unclassified")).toBe(true);
    });
  });
});

/* ------------------------------------------------------------------ */
/* AK2-04 — fallback kelompok dari tipe, bukan rentang kode            */
/* ------------------------------------------------------------------ */

describe("AK2-04 — pengelompokan laporan tanpa tebakan kode", () => {
  it("utang bank 2400 DENGAN section non-current tampil jangka panjang & pendanaan", async () => {
    await rollbackTransaction(async (tx) => {
      const loan = await createAccount(tx, {
        code: "2400",
        name: "Utang Bank Jangka Panjang",
        type: "liability",
        normalBalance: "credit",
        section: "non_current_liability",
        cashFlowGroup: "financing",
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-08-10",
        description: "Pencairan pinjaman bank",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "1000"), debit: "120000000" },
          { accountId: loan, credit: "120000000" },
        ],
      });
      const sheet = await getBalanceSheet(tx, ORG_ID, "2027-08-31");
      const nonCurrent = sheet.nonCurrentLiabilities.find((row) => row.code === "2400");
      expect(nonCurrent?.amount).toBe(120000000);
      expect(sheet.currentLiabilities.some((row) => row.code === "2400")).toBe(false);
      const flow = await getCashFlow(tx, ORG_ID, { from: "2027-08-01", to: "2027-08-31" });
      expect(flow.groups.financing).toBe(120000000);
    });
  });

  it("utang bernama jangka panjang TANPA penanda = jangka pendek & operasi (bawaan tipe terdokumentasi)", async () => {
    await rollbackTransaction(async (tx) => {
      const loan = await createAccount(tx, {
        code: "2401",
        name: "Utang Bank Jangka Panjang",
        type: "liability",
        normalBalance: "credit",
        // tanpa section & tanpa cash_flow_group
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-08-10",
        description: "Pencairan tanpa penanda kelompok",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "1000"), debit: "40000000" },
          { accountId: loan, credit: "40000000" },
        ],
      });
      const sheet = await getBalanceSheet(tx, ORG_ID, "2027-08-31");
      expect(sheet.currentLiabilities.some((row) => row.code === "2401")).toBe(true);
      expect(sheet.nonCurrentLiabilities.some((row) => row.code === "2401")).toBe(false);
      const flow = await getCashFlow(tx, ORG_ID, { from: "2027-08-01", to: "2027-08-31" });
      expect(flow.groups.operating).toBe(40000000);
      expect(flow.groups.financing).toBe(0);
    });
  });

  it("aset berkode 1990 TANPA section = aset lancar (keajaiban rentang kode lama hilang)", async () => {
    await rollbackTransaction(async (tx) => {
      const asset = await createAccount(tx, {
        code: "1990",
        name: "Aset Uji Kode Tinggi",
        type: "asset",
        normalBalance: "debit",
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: "2027-08-10",
        description: "Beli aset kode 1990",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: asset, debit: "3000000" },
          { accountId: await accountIdByCode(tx, "1000"), credit: "3000000" },
        ],
      });
      const sheet = await getBalanceSheet(tx, ORG_ID, "2027-08-31");
      expect(sheet.currentAssets.some((row) => row.code === "1990")).toBe(true);
      expect(sheet.nonCurrentAssets.some((row) => row.code === "1990")).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* AK2-07 — rekonsiliasi kontrol vs subledger                          */
/* ------------------------------------------------------------------ */

describe("AK2-07 — rekonsiliasi kontrol vs subledger", () => {
  it("fixture terkendali: ketiga selisih 0; jurnal manual ke akun kontrol → selisih persis sebesar itu", async () => {
    await rollbackTransaction(async (tx) => {
      await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "receivable",
        partyId: customerId,
        date: TODAY,
        amount: "650000",
      });
      await createOpeningBalance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        kind: "payable",
        partyId: supplierId,
        date: TODAY,
        amount: "800000",
      });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: TODAY,
        lines: [{ productId, qty: "10", unitCost: "100000" }],
      });

      const before = await getControlReconciliation(tx, ORG_ID, TODAY);
      const leg = (key: string) => before.legs.find((row) => row.key === key)!;
      expect(leg("receivable")).toMatchObject({ gl: 650000, subledger: 650000, difference: 0 });
      // Utang = saldo awal 800 rb + penerimaan kredit 1 jt.
      expect(leg("payable")).toMatchObject({ gl: 1800000, subledger: 1800000, difference: 0 });
      expect(leg("inventory")).toMatchObject({ gl: 1000000, subledger: 1000000, difference: 0 });

      // Selisih buatan: jurnal manual langsung ke dua akun kontrol.
      await postJournal(tx, {
        companyId: ORG_ID,
        date: TODAY,
        description: "Jurnal manual uji ke piutang",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "1200"), debit: "100000" },
          { accountId: await accountIdByCode(tx, "4000"), credit: "100000" },
        ],
      });
      await postJournal(tx, {
        companyId: ORG_ID,
        date: TODAY,
        description: "Jurnal manual uji ke persediaan",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: await accountIdByCode(tx, "1300"), debit: "50000" },
          { accountId: await accountIdByCode(tx, "3000"), credit: "50000" },
        ],
      });

      const after = await getControlReconciliation(tx, ORG_ID, TODAY);
      const legAfter = (key: string) => after.legs.find((row) => row.key === key)!;
      expect(legAfter("receivable").difference).toBe(100000);
      expect(legAfter("receivable").manualJournals.some((row) => row.amount === 100000)).toBe(true);
      expect(legAfter("inventory").difference).toBe(50000);
      expect(legAfter("inventory").manualJournals.some((row) => row.amount === 50000)).toBe(true);
      // Sisi yang tidak disentuh tetap selaras.
      expect(legAfter("payable").difference).toBe(0);
    });
  });
});
