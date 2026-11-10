import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  employees,
  expenses,
  journalEntries,
  journalLines,
  products,
  stockReceipts,
  supplierReturns,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { getAccountMap } from "@/server/accounting";
import { createEmployeeAdvance } from "@/server/employee-advances";
import { createExpense } from "@/server/expenses";
import { registerFixedAsset, runFixedAssetDepreciation } from "@/server/fixed-assets";
import { createReceipt } from "@/server/inventory";
import { postQuickCashSale } from "@/server/quick-entry";
import { getTrialBalance } from "@/server/reports";
import {
  createSupplierReturn,
  getSupplierOpenPayable,
  postSupplierReturn,
} from "@/server/supplier-returns";
import { createExpenseAction } from "@/server/actions/accounting/beban-transfer";
import { saveMappingAction } from "@/server/actions/accounting/akun-pemetaan";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-P1 Tahap 4 (A-15) — PPN Masukan + pemetaan lengkap:
//   AK1-03 sembilan kunci pemetaan yang dipakai kode tidak bisa diubah
//          dari Pengaturan (daftar putih aksi + editor UI tertutup);
//   AK1-06/AK4-04 PPN Masukan tidak eksis — penerimaan & beban mencatat
//          bruto termasuk PPN, PKP tidak bisa mengkreditkan pajak
//          masukan; retur pemasok harus mereversi porsi PPN-nya.
// Semua skenario domain berjalan di perusahaan fixture KHUSUS berkas
// ini (f401) dalam transaksi rollback; uji aksi (saveMappingAction)
// berjalan ter-commit lalu pemetaan dipulihkan ke nilai fixture.

const ORG_ID = "01900000-0000-7000-8000-00000000f401";
const USER_ID = "user-uji-fix-p1-tahap4";
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

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank BCA", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1180", "PPN Masukan", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1210", "Kredit Pemasok", "asset", "debit"],
  ["1215", "Kredit Pemasok Cadangan", "asset", "debit"],
  ["1220", "Piutang Karyawan", "asset", "debit"],
  ["1225", "Piutang Kasbon Cadangan", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["1500", "Aset Tetap", "asset", "debit"],
  ["1510", "Akumulasi Penyusutan", "asset", "credit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["2100", "Utang Gaji", "liability", "credit"],
  ["2110", "Utang PPh 21", "liability", "credit"],
  ["2120", "Utang BPJS", "liability", "credit"],
  ["2200", "PPN Keluaran", "liability", "credit"],
  ["2300", "Kredit Pelanggan", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["3100", "Laba Ditahan", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["5010", "Selisih Persediaan", "cogs", "debit"],
  ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
  ["6000", "Beban Gaji Karyawan", "expense", "debit"],
  ["6010", "Beban Sewa", "expense", "debit"],
  ["6060", "Beban Administrasi Bank", "expense", "debit"],
  ["6070", "Beban Lain-lain", "expense", "debit"],
  ["6080", "Beban Iuran BPJS Perusahaan", "expense", "debit"],
  ["6090", "Beban Penyusutan", "expense", "debit"],
  ["6095", "Beban Penyusutan Cadangan", "expense", "debit"],
  ["8000", "Selisih Kas Kurang", "expense", "debit"],
  ["8001", "Selisih Kas Lebih", "revenue", "credit"],
  ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
  ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
  tax_input: "1180",
  receivable: "1200",
  supplier_credit: "1210",
  employee_receivable: "1220",
  employee_loan_receivable: "1220",
  inventory: "1300",
  fixed_asset: "1500",
  accumulated_depreciation: "1510",
  payable: "2000",
  salary_payable: "2100",
  pph21_payable: "2110",
  bpjs_payable: "2120",
  tax_output: "2200",
  customer_credit: "2300",
  equity: "3000",
  revenue: "4000",
  sales_discount: "4010",
  sales_return: "4020",
  other_income: "4030",
  cogs: "5000",
  inventory_shrink: "5010",
  damaged: "5020",
  salary_expense: "6000",
  bank_fee: "6060",
  payroll_employer_expense: "6080",
  depreciation_expense: "6090",
};

let warehouseId = "";
let supplierId = "";
let employeeId = "";
let productTaxId = "";

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
      legalName: "Uji FIX-P1 Tahap 4 PPN",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: true,
    });

    const accountRows = await tx
      .insert(accounts)
      .values(
        ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
          companyId: ORG_ID,
          code,
          name,
          type,
          normalBalance,
          // AUD-001/A-27: kelas kas/bank eksplisit (validator membacanya);
          // fixture tidak boleh bergantung pada residu ter-backfill.
          cashBankKind:
            code === "1000" ? "cash" : code === "1100" ? "bank" : code === "1110" ? "clearing" : null,
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
      .values({ companyId: ORG_ID, name: "Gudang Uji Tahap 4", code: "GD-T4" })
      .returning();
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: ORG_ID, code: "SUP-T4", name: "PT Pemasok Kena Pajak" })
      .returning();
    const [employee] = await tx
      .insert(employees)
      .values({ companyId: ORG_ID, code: "EMP-T4-001", name: "Karyawan Uji Tahap 4" })
      .returning();
    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG_ID,
        sku: "T4-PPN-001",
        name: "Produk Kena PPN Uji",
        costPrice: "0",
        salePrice: "150000",
      })
      .returning();
    warehouseId = warehouse.id;
    supplierId = supplier.id;
    employeeId = employee.id;
    productTaxId = product.id;
  });

  // Run kedua dan seterusnya: fixture sudah ter-commit, ambil id-nya.
  if (!warehouseId) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG_ID}, true)`);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_ID))
        .limit(1);
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      const [employee] = await tx
        .select({ id: employees.id })
        .from(employees)
        .where(eq(employees.companyId, ORG_ID))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.companyId, ORG_ID))
        .limit(1);
      warehouseId = warehouse.id;
      supplierId = supplier.id;
      employeeId = employee.id;
      productTaxId = product.id;
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

async function accountCodeById(tx: Tx, id: string): Promise<string> {
  const [row] = await tx
    .select({ code: accounts.code })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.id, id)))
    .limit(1);
  return row?.code ?? id;
}

/** Baris jurnal satu sumber, diringkas per KODE akun: { "1300": {debit, credit} }. */
async function journalByCode(
  tx: Tx,
  sourceType: string,
  sourceId: string,
): Promise<Record<string, { debit: Decimal; credit: Decimal }>> {
  const [entry] = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
        sql`${journalEntries.reversalOfId} is null`,
      ),
    )
    .limit(1);
  if (!entry) throw new Error(`Jurnal ${sourceType}/${sourceId} tidak ditemukan`);
  const lines = await tx
    .select({ accountId: journalLines.accountId, debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  const result: Record<string, { debit: Decimal; credit: Decimal }> = {};
  for (const line of lines) {
    const code = await accountCodeById(tx, line.accountId);
    const bucket = (result[code] ??= { debit: d(0), credit: d(0) });
    bucket.debit = bucket.debit.plus(d(line.debit));
    bucket.credit = bucket.credit.plus(d(line.credit));
  }
  return result;
}

function expectLine(
  journal: Record<string, { debit: Decimal; credit: Decimal }>,
  code: string,
  side: "debit" | "credit",
  amount: string,
) {
  const line = journal[code];
  expect(line, `baris jurnal akun ${code}`).toBeDefined();
  expect(line![side].toFixed(4)).toBe(d(amount).toFixed(4));
}

async function setSettings(tx: Tx, patch: { taxEnabled?: boolean; taxRate?: string }) {
  await tx
    .update(companySettings)
    .set(patch)
    .where(eq(companySettings.companyId, ORG_ID));
}

/** Penerimaan kredit ber-PPN baku: 10 × Rp111.000 bruto = Rp1.110.000. */
async function receiveTaxedCredit(tx: Tx) {
  return createReceipt(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    warehouseId,
    supplierId,
    source: "purchase",
    date: TODAY,
    taxIncluded: true,
    lines: [{ productId: productTaxId, qty: "10", unitCost: "111000" }],
  });
}

/* ------------------------------------------------------------------ */
/* Bagian A — AK1-03: kunci pemetaan dibuka                            */
/* ------------------------------------------------------------------ */

const NEW_KEYS: { key: string; fixtureCode: string; customCode: string }[] = [
  { key: "supplier_credit", fixtureCode: "1210", customCode: "1215" },
  { key: "employee_receivable", fixtureCode: "1220", customCode: "1225" },
  { key: "employee_loan_receivable", fixtureCode: "1220", customCode: "1225" },
  { key: "pph21_payable", fixtureCode: "2110", customCode: "2120" },
  { key: "bpjs_payable", fixtureCode: "2120", customCode: "2110" },
  { key: "payroll_employer_expense", fixtureCode: "6080", customCode: "6070" },
  { key: "fixed_asset", fixtureCode: "1500", customCode: "1300" },
  { key: "accumulated_depreciation", fixtureCode: "1510", customCode: "1300" },
  { key: "depreciation_expense", fixtureCode: "6090", customCode: "6095" },
  { key: "tax_input", fixtureCode: "1180", customCode: "1300" },
];

describe("AK1-03 — saveMappingAction menerima kunci yang sebelumnya terkunci", () => {
  it("kesepuluh kunci bisa disimpan lewat aksi dan terbaca kembali", async () => {
    for (const { key, fixtureCode, customCode } of NEW_KEYS) {
      const customId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, customCode));
      const result = await saveMappingAction({ key, accountId: customId });
      expect(result.ok, `simpan ${key}`).toBe(true);
      const saved = await withCompany(ORG_ID, async (tx) => {
        const map = await getAccountMap(tx, ORG_ID);
        return map[key];
      });
      expect(saved, `pemetaan ${key} terbaca`).toBe(customId);
      // Pulihkan ke nilai fixture agar uji domain lain tidak terpengaruh.
      const fixtureId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, fixtureCode));
      const restore = await saveMappingAction({ key, accountId: fixtureId });
      expect(restore.ok, `pulihkan ${key}`).toBe(true);
    }
  });

  it("kunci tak dikenal tetap ditolak", async () => {
    const cashId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1000"));
    const result = await saveMappingAction({ key: "kunci_ngawur", accountId: cashId });
    expect(result.ok).toBe(false);
  });

  it("domain kasbon memakai akun employee_receivable pilihan (bukan bawaan)", async () => {
    const customId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1225"));
    const fixtureId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1220"));
    const saved = await saveMappingAction({ key: "employee_receivable", accountId: customId });
    expect(saved.ok).toBe(true);
    try {
      await rollbackTransaction(async (tx) => {
        const cashId = await accountIdByCode(tx, "1000");
        const advance = await createEmployeeAdvance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          employeeId,
          date: TODAY,
          amount: "250000",
          accountId: cashId,
          planMode: "full",
        });
        const journal = await journalByCode(tx, "employee_advance", advance.id);
        expectLine(journal, "1225", "debit", "250000");
        expect(journal["1220"]).toBeUndefined();
      });
    } finally {
      await saveMappingAction({ key: "employee_receivable", accountId: fixtureId });
    }
  });

  it("domain aset tetap memakai akun depreciation_expense pilihan", async () => {
    const customId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "6095"));
    const fixtureId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "6090"));
    const saved = await saveMappingAction({ key: "depreciation_expense", accountId: customId });
    expect(saved.ok).toBe(true);
    try {
      await rollbackTransaction(async (tx) => {
        const cashId = await accountIdByCode(tx, "1000");
        await registerFixedAsset(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          name: "Mesin Uji Tahap 4",
          acquisitionDate: "2026-09-01",
          cost: "12000000",
          residualValue: "0",
          usefulLifeMonths: 12,
          sourceAccountId: cashId,
        });
        const run = await runFixedAssetDepreciation(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          period: "2026-10",
        });
        const journal = await journalByCode(tx, "fixed_asset_depreciation", run.id);
        expectLine(journal, "6095", "debit", "1000000");
        expectLine(journal, "1510", "credit", "1000000");
        expect(journal["6090"]).toBeUndefined();
      });
    } finally {
      await saveMappingAction({ key: "depreciation_expense", accountId: fixtureId });
    }
  });

  it("domain retur pemasok memakai akun supplier_credit pilihan untuk klaim berlebih", async () => {
    const customId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1215"));
    const fixtureId = await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1210"));
    const saved = await saveMappingAction({ key: "supplier_credit", accountId: customId });
    expect(saved.ok).toBe(true);
    try {
      await rollbackTransaction(async (tx) => {
        // Pembelian TUNAI: tidak ada utang terbuka, jadi seluruh nilai
        // retur menjadi klaim kredit pemasok.
        const cashId = await accountIdByCode(tx, "1000");
        await createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId,
          supplierId,
          source: "purchase",
          paymentAccountId: cashId,
          date: TODAY,
          lines: [{ productId: productTaxId, qty: "4", unitCost: "50000" }],
        });
        const draft = await createSupplierReturn(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          supplierId,
          warehouseId,
          date: TODAY,
          reasonCategory: "damaged",
          reasonDetail: "Barang rusak saat diterima",
          resolutionType: "refund",
          lines: [{ productId: productTaxId, qty: "4" }],
        });
        await postSupplierReturn(tx, { companyId: ORG_ID, userId: USER_ID, returnId: draft.id });
        const journal = await journalByCode(tx, "supplier_return", draft.id);
        expectLine(journal, "1215", "debit", "200000");
        expectLine(journal, "1300", "credit", "200000");
        expect(journal["1210"]).toBeUndefined();
      });
    } finally {
      await saveMappingAction({ key: "supplier_credit", accountId: fixtureId });
    }
  });
});

/* ------------------------------------------------------------------ */
/* Bagian B — AK1-06/AK4-04: PPN Masukan                               */
/* ------------------------------------------------------------------ */

describe("AK4-04 — penerimaan ber-PPN memisah PPN Masukan", () => {
  it("pembelian kredit: Dr Persediaan (DPP) + Dr PPN Masukan, Cr Utang (bruto)", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await receiveTaxedCredit(tx);
      const journal = await journalByCode(tx, "purchase", receipt.id);
      expectLine(journal, "1300", "debit", "1000000");
      expectLine(journal, "1180", "debit", "110000");
      expectLine(journal, "2000", "credit", "1110000");

      const [row] = await tx
        .select({ taxRate: stockReceipts.taxRate, taxAmount: stockReceipts.taxAmount, total: stockReceipts.total })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.taxAmount).toFixed(2)).toBe("110000.00");
      expect(d(row.taxRate).toFixed(2)).toBe("11.00");
      expect(d(row.total).toFixed(2)).toBe("1110000.00");

      // AVCO menyerap DPP, bukan bruto: harga pokok menjadi Rp100.000.
      const [product] = await tx
        .select({ costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, productTaxId))
        .limit(1);
      expect(d(product.costPrice).toFixed(2)).toBe("100000.00");

      // Utang terbuka tetap sebesar total faktur bruto.
      const open = await getSupplierOpenPayable(tx, ORG_ID, supplierId);
      expect(open.toFixed(2)).toBe("1110000.00");
    });
  });

  it("pembelian tunai: kredit ke kas sebesar bruto, split sama", async () => {
    await rollbackTransaction(async (tx) => {
      const cashId = await accountIdByCode(tx, "1000");
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        paymentAccountId: cashId,
        date: TODAY,
        taxIncluded: true,
        lines: [{ productId: productTaxId, qty: "10", unitCost: "111000" }],
      });
      const journal = await journalByCode(tx, "purchase", receipt.id);
      expectLine(journal, "1300", "debit", "1000000");
      expectLine(journal, "1180", "debit", "110000");
      expectLine(journal, "1000", "credit", "1110000");
    });
  });

  it("PPN persen: harga baris DPP, PPN dihitung dari total DPP", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: TODAY,
        taxPercent: "11",
        lines: [{ productId: productTaxId, qty: "10", unitCost: "100000" }],
      });
      const journal = await journalByCode(tx, "purchase", receipt.id);
      expectLine(journal, "1300", "debit", "1000000");
      expectLine(journal, "1180", "debit", "110000");
      expectLine(journal, "2000", "credit", "1110000");

      const [row] = await tx
        .select({
          taxRate: stockReceipts.taxRate,
          taxAmount: stockReceipts.taxAmount,
          total: stockReceipts.total,
        })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.taxAmount).toFixed(2)).toBe("110000.00");
      expect(d(row.taxRate).toFixed(2)).toBe("11.00");
      expect(d(row.total).toFixed(2)).toBe("1110000.00");
    });
  });

  it("PPN persen di atas 100 ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId,
          supplierId,
          source: "purchase",
          date: TODAY,
          taxPercent: "101",
          lines: [{ productId: productTaxId, qty: "1", unitCost: "100000" }],
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("tanpa tanda PPN: perilaku lama persis (persediaan menyerap bruto)", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: productTaxId, qty: "10", unitCost: "111000" }],
      });
      const journal = await journalByCode(tx, "purchase", receipt.id);
      expectLine(journal, "1300", "debit", "1110000");
      expectLine(journal, "2000", "credit", "1110000");
      expect(journal["1180"]).toBeUndefined();
      const [row] = await tx
        .select({ taxAmount: stockReceipts.taxAmount })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(d(row.taxAmount).toFixed(2)).toBe("0.00");
    });
  });

  it("tanda PPN saat PPN perusahaan NONAKTIF ditolak, bukan diabaikan diam-diam", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { taxEnabled: false });
      await expect(receiveTaxedCredit(tx)).rejects.toBeInstanceOf(AppError);
    });
  });

  it("tanda PPN saat tarif 0 ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { taxRate: "0" });
      await expect(receiveTaxedCredit(tx)).rejects.toBeInstanceOf(AppError);
    });
  });
});

describe("AK4-04 — beban dengan opsi Termasuk PPN", () => {
  it("jurnal terbelah: Dr Beban (DPP) + Dr PPN Masukan, Cr Kas (bruto)", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const paymentAccountId = await accountIdByCode(tx, "1000");
      const expense = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId,
        paymentAccountId,
        amount: "1110000",
        description: "Sewa gudang kena PPN",
        taxIncluded: true,
        taxRate: "11",
      });
      const journal = await journalByCode(tx, "expense", expense.id);
      expectLine(journal, "6010", "debit", "1000000");
      expectLine(journal, "1180", "debit", "110000");
      expectLine(journal, "1000", "credit", "1110000");
      const [row] = await tx
        .select({ taxAmount: expenses.taxAmount, amount: expenses.amount })
        .from(expenses)
        .where(eq(expenses.id, expense.id))
        .limit(1);
      expect(d(row.taxAmount).toFixed(2)).toBe("110000.00");
      expect(d(row.amount).toFixed(2)).toBe("1110000.00");
    });
  });

  it("tanpa opsi: jurnal lama persis (beban penuh)", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const paymentAccountId = await accountIdByCode(tx, "1000");
      const expense = await createExpense(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date: TODAY,
        expenseAccountId,
        paymentAccountId,
        amount: "1110000",
        description: "Sewa gudang tanpa PPN",
      });
      const journal = await journalByCode(tx, "expense", expense.id);
      expectLine(journal, "6010", "debit", "1110000");
      expectLine(journal, "1000", "credit", "1110000");
      expect(journal["1180"]).toBeUndefined();
    });
  });

  it("opsi aktif tetapi tarif efektif 0 (PPN nonaktif) ditolak di domain", async () => {
    await rollbackTransaction(async (tx) => {
      const expenseAccountId = await accountIdByCode(tx, "6010");
      const paymentAccountId = await accountIdByCode(tx, "1000");
      await expect(
        createExpense(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          date: TODAY,
          expenseAccountId,
          paymentAccountId,
          amount: "1110000",
          description: "Sewa saat PPN nonaktif",
          taxIncluded: true,
          taxRate: "0",
        }),
      ).rejects.toBeInstanceOf(AppError);
    });
  });

  it("lewat aksi formulir beban: tarif dibaca dari pengaturan perusahaan", async () => {
    const result = await createExpenseAction({
      date: TODAY,
      expenseAccountId: await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "6010")),
      paymentAccountId: await withCompany(ORG_ID, (tx) => accountIdByCode(tx, "1000")),
      amount: "1110000",
      description: "Sewa uji aksi tahap 4",
      taxIncluded: true,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const journal = await withCompany(ORG_ID, (tx) =>
        journalByCode(tx, "expense", result.data.id),
      );
      expectLine(journal, "6010", "debit", "1000000");
      expectLine(journal, "1180", "debit", "110000");
      expectLine(journal, "1000", "credit", "1110000");
    }
  });
});

describe("AK4-04 — saldo PPN Masukan & Keluaran terbaca di neraca saldo", () => {
  it("beli kena PPN + jual kena PPN → kedua akun pajak tampil dengan saldo benar", async () => {
    await rollbackTransaction(async (tx) => {
      // Jendela tanggal tersendiri (Maret 2027) agar mutasi yang dibaca
      // hanya milik skenario ini — perusahaan fixture juga menampung
      // jurnal ter-commit dari uji aksi di berkas ini.
      const date = "2027-03-15";
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId,
        supplierId,
        source: "purchase",
        date,
        taxIncluded: true,
        lines: [{ productId: productTaxId, qty: "10", unitCost: "111000" }],
      });
      const cashId = await accountIdByCode(tx, "1000");
      const revenueId = await accountIdByCode(tx, "4000");
      await postQuickCashSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        date,
        amount: "2220000",
        accountId: cashId,
        revenueAccountId: revenueId,
        taxIncluded: true,
        taxRate: "11",
      });
      const rows = await getTrialBalance(tx, ORG_ID, { from: "2027-03-01", to: "2027-03-31" });
      const ppnMasukan = rows.find((row) => row.code === "1180");
      const ppnKeluaran = rows.find((row) => row.code === "2200");
      expect(ppnMasukan, "akun 1180 tampil di neraca saldo").toBeDefined();
      expect(ppnKeluaran, "akun 2200 tampil di neraca saldo").toBeDefined();
      // Mutasi dalam jendela: PPN Masukan terdebit 110.000 dari
      // pembelian; PPN Keluaran terkredit 220.000 dari penjualan.
      expect(d(ppnMasukan!.debit).toFixed(2)).toBe("110000.00");
      expect(d(ppnMasukan!.credit).toFixed(2)).toBe("0.00");
      expect(d(ppnKeluaran!.credit).toFixed(2)).toBe("220000.00");
      expect(d(ppnKeluaran!.debit).toFixed(2)).toBe("0.00");
    });
  });
});

describe("AK4-04 — retur pemasok mereversi PPN Masukan secara proporsional", () => {
  it("retur PENUH: utang lunas seluruhnya dan PPN Masukan kembali nol", async () => {
    await rollbackTransaction(async (tx) => {
      const receipt = await receiveTaxedCredit(tx);
      const draft = await createSupplierReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId,
        warehouseId,
        date: TODAY,
        reasonCategory: "damaged",
        reasonDetail: "Seluruh barang rusak",
        resolutionType: "refund",
        lines: [{ productId: productTaxId, qty: "10" }],
      });
      await postSupplierReturn(tx, { companyId: ORG_ID, userId: USER_ID, returnId: draft.id });

      const journal = await journalByCode(tx, "supplier_return", draft.id);
      expectLine(journal, "2000", "debit", "1110000");
      expectLine(journal, "1300", "credit", "1000000");
      expectLine(journal, "1180", "credit", "110000");

      const [ret] = await tx
        .select({ taxAmount: supplierReturns.taxAmount, payableAmount: supplierReturns.payableAmount })
        .from(supplierReturns)
        .where(eq(supplierReturns.id, draft.id))
        .limit(1);
      expect(d(ret.taxAmount).toFixed(2)).toBe("110000.00");
      expect(d(ret.payableAmount).toFixed(2)).toBe("1000000.00");

      const open = await getSupplierOpenPayable(tx, ORG_ID, supplierId);
      expect(open.toFixed(2)).toBe("0.00");
      const [rcpt] = await tx
        .select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id))
        .limit(1);
      expect(rcpt.paymentStatus).toBe("paid");
    });
  });

  it("retur SEBAGIAN (5 dari 10): PPN direversi separuh, sisa utang separuh bruto", async () => {
    await rollbackTransaction(async (tx) => {
      await receiveTaxedCredit(tx);
      const draft = await createSupplierReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId,
        warehouseId,
        date: TODAY,
        reasonCategory: "quality",
        reasonDetail: "Setengah barang tidak sesuai mutu",
        resolutionType: "refund",
        lines: [{ productId: productTaxId, qty: "5" }],
      });
      await postSupplierReturn(tx, { companyId: ORG_ID, userId: USER_ID, returnId: draft.id });

      const journal = await journalByCode(tx, "supplier_return", draft.id);
      expectLine(journal, "2000", "debit", "555000");
      expectLine(journal, "1300", "credit", "500000");
      expectLine(journal, "1180", "credit", "55000");

      const open = await getSupplierOpenPayable(tx, ORG_ID, supplierId);
      expect(open.toFixed(2)).toBe("555000.00");
    });
  });
});
