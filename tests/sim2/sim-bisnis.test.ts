import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  branches,
  categories,
  companySettings,
  customerGroups,
  customers,
  employees,
  fiscalPeriods,
  journalEntries,
  journalLines,
  member,
  organization,
  paymentMethods,
  payrollItems,
  payrollRuns,
  products,
  purchaseOrders,
  stockBatches,
  stockMovements,
  stockOnHand,
  stockReceipts,
  supplierReturns,
  suppliers,
  units,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { postJournal } from "@/server/accounting";
import { createReceipt, createOpname, createTransfer } from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import {
  closeCashSession,
  createSale,
  createSaleReturn,
  openCashSession,
} from "@/server/pos";
import {
  applySupplierCredit,
  createSupplierReturn,
  getSupplierOpenPayable,
  postSupplierReturn,
  refundSupplierReturn,
} from "@/server/supplier-returns";
import { payPayableDocument } from "@/server/payables";
import {
  payPayableFifo,
  postQuickCashSale,
  receiveReceivableFifo,
} from "@/server/quick-entry";
import { createExpense } from "@/server/expenses";
import { createEmployeeAdvance } from "@/server/employee-advances";
import {
  getBalanceSheet,
  getIncomeStatement,
  getInventoryValuation,
  getTrialBalance,
  listHeldSales,
  listPayables,
  listReceivables,
} from "@/server/reports";
import { checkoutAction, holdAction, resumeHeldSaleAction } from "@/server/actions/pos";
import { setPeriodStatusAction } from "@/server/actions/accounting/periode";
import {
  payPayrollAction,
  runPayrollAction,
} from "@/server/actions/hr/payroll";
import { d, toDb } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 Fase S1 — Simulasi bisnis inti ujung-ke-ujung "SimMart".
 *
 * Satu perusahaan fixture khusus (…cc01) yang TIDAK dipakai suite lain;
 * data ter-commit antar-langkah karena garis waktu bisnisnya berurutan
 * (pola payroll-reverse/employee-advances), dan beforeAll/afterAll
 * membersihkan seluruh perusahaan fixture. Transaksi bisnis berjalan
 * lewat domain/aksi server yang sesungguhnya; SQL/Drizzle langsung hanya
 * untuk setup master & verifikasi angka.
 *
 * Semua ekspektasi nominal dihitung tangan dari skenario (lihat
 * docs/sim2/S1-SIMULASI.md), bukan diturunkan dari keluaran sistem.
 */

// Aksi server butuh konteks sesi; diganti di sini agar kode aksi yang
// asli (validasi, jurnal, pemetaan akun) berjalan terhadap DB nyata.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000cc01" },
    user: { id: "01900000-0000-7000-8000-00000000cc10" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000cc01";
const OWNER = "01900000-0000-7000-8000-00000000cc10";

const TODAY = todayISO();
const PERIOD = TODAY.slice(0, 7);
const YEAR = Number(TODAY.slice(0, 4));
const MONTH = Number(TODAY.slice(5, 7));
const MONTH_FROM = `${PERIOD}-01`;
const MONTH_TO = new Date(Date.UTC(YEAR, MONTH, 0)).toISOString().slice(0, 10);

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
const DUE_DATE = addDays(TODAY, 14);
const EXP_A = addDays(TODAY, 10);
const EXP_B = addDays(TODAY, 60);

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withCompany(ORG, fn);
}
function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withCompanyReadOnly(ORG, fn);
}

/** Assert dua nilai uang sama persis sampai sen (2 desimal). */
function expectMoney(actual: unknown, expected: number | string) {
  expect(d(actual as string).toFixed(2)).toBe(d(expected).toFixed(2));
}

async function expectRejects(
  promise: Promise<unknown>,
  check?: { code?: string; message?: RegExp },
) {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, "operasi seharusnya ditolak").toBeDefined();
  if (check?.code) expect(error).toMatchObject({ code: check.code });
  if (check?.message) {
    expect((error as { message?: string }).message ?? "").toMatch(check.message);
  }
  return error;
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const F = {
  wh1: "",
  wh2: "",
  s1: "",
  s2: "",
  c1: "",
  c2: "",
  c3: "",
  e1: "",
  e2: "",
  e3: "",
  method: {} as Record<string, string>,
  acc: {} as Record<string, string>,
  p: {} as Record<string, string>,
};

const PRODUCT_SEEDS: Array<{
  key: string;
  name: string;
  cost: number;
  price: number;
  min: number;
  batch?: boolean;
}> = [
  { key: "AQUA", name: "Sim Aqua 600ml", cost: 2500, price: 4000, min: 0 },
  { key: "IND", name: "Sim Indomie Goreng", cost: 3000, price: 3800, min: 0 },
  { key: "SUSU", name: "Sim Susu UHT 250ml", cost: 5000, price: 7000, min: 0, batch: true },
  { key: "GULA", name: "Sim Gula Pasir 1kg", cost: 15000, price: 18000, min: 20 },
  { key: "MINYAK", name: "Sim Minyak Goreng 2L", cost: 34000, price: 39000, min: 0 },
  { key: "BERAS", name: "Sim Beras 5kg", cost: 62000, price: 72000, min: 0 },
  { key: "KOPI", name: "Sim Kopi Sachet", cost: 1500, price: 2500, min: 0 },
  { key: "TEH", name: "Sim Teh Celup", cost: 4000, price: 6000, min: 12 },
  { key: "ROTI", name: "Sim Roti Tawar", cost: 8000, price: 12000, min: 0 },
  { key: "TELUR", name: "Sim Telur Ayam 1kg", cost: 27000, price: 31000, min: 0 },
  { key: "SABUN", name: "Sim Sabun Mandi", cost: 4200, price: 6000, min: 10 },
  { key: "TISU", name: "Sim Tisu 250 lembar", cost: 13500, price: 17000, min: 0 },
];


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function bootstrapFixture() {
  await wipeFixture();

  await adminDb.insert(user).values({
    id: OWNER,
    name: "Sari Simmart",
    email: "owner@simmart.id",
    emailVerified: true,
    role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(),
    accountId: OWNER,
    providerId: "credential",
    userId: OWNER,
    password: "fixture-tidak-dipakai",
  });
  await adminDb.insert(organization).values({
    id: ORG,
    name: "SimMart",
    slug: "simmart",
    createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG,
    userId: OWNER,
    role: "owner",
    createdAt: new Date(),
  });

  const [branch] = await adminDb
    .insert(branches)
    .values({ companyId: ORG, code: "BR-SIM", name: "SimMart Pusat", isDefault: true })
    .returning();
  const [wh1] = await adminDb
    .insert(warehouses)
    .values({
      companyId: ORG, branchId: branch.id, code: "WH-UTAMA",
      name: "Gudang Utama", type: "warehouse", isDefault: true,
    })
    .returning();
  const [wh2] = await adminDb
    .insert(warehouses)
    .values({
      companyId: ORG, branchId: branch.id, code: "WH-CABANG",
      name: "Gudang Cabang", type: "warehouse",
    })
    .returning();
  F.wh1 = wh1.id;
  F.wh2 = wh2.id;

  await adminDb.insert(companySettings).values({
    companyId: ORG,
    legalName: "SimMart",
    defaultWarehouseId: wh1.id,
    roundingMode: "none",
    taxRate: "0",
    allowNegativeStock: false,
  });

  // FIX-R2 Tahap 3 (AK2-04): section kini dinyatakan EKSPLISIT per akun
  // (elemen kelima), meniru bagan akun standar — fallback laporan tidak
  // lagi menebak dari kode ("4030" → other_income dst. adalah artefak
  // fallback lama). Maksud skenario tidak berubah: 4030 memang
  // pendapatan lain-lain, 1500/1510 memang tidak lancar.
  const accountSeeds: Array<[string, string, string, "debit" | "credit", string]> = [
    ["1000", "Kas", "asset", "debit", "current_asset"],
    ["1010", "Kas Kecil", "asset", "debit", "current_asset"],
    ["1100", "Bank BCA", "asset", "debit", "current_asset"],
    ["1110", "QRIS Clearing", "asset", "debit", "current_asset"],
    ["1200", "Piutang Usaha", "asset", "debit", "current_asset"],
    ["1210", "Kredit Pemasok", "asset", "debit", "current_asset"],
    ["1220", "Piutang Karyawan", "asset", "debit", "current_asset"],
    ["1300", "Persediaan Barang Dagang", "asset", "debit", "current_asset"],
    ["1400", "Perlengkapan", "asset", "debit", "current_asset"],
    ["1500", "Peralatan Toko", "asset", "debit", "non_current_asset"],
    ["1510", "Akumulasi Penyusutan Peralatan", "asset", "credit", "non_current_asset"],
    ["2000", "Utang Usaha", "liability", "credit", "current_liability"],
    ["2100", "Utang Gaji", "liability", "credit", "current_liability"],
    ["2200", "PPN Keluaran", "liability", "credit", "current_liability"],
    ["2300", "Kredit Pelanggan", "liability", "credit", "current_liability"],
    ["3000", "Modal Pemilik", "equity", "credit", "equity"],
    ["3100", "Laba Ditahan", "equity", "credit", "equity"],
    ["4000", "Penjualan", "revenue", "credit", "revenue"],
    ["4010", "Diskon Penjualan", "revenue", "debit", "revenue"],
    ["4020", "Retur Penjualan", "revenue", "debit", "revenue"],
    ["4030", "Pendapatan Lain-lain", "revenue", "credit", "other_income"],
    ["5000", "Harga Pokok Penjualan", "cogs", "debit", "cogs"],
    ["5010", "Selisih Persediaan", "cogs", "debit", "cogs"],
    ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit", "cogs"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit", "operating_expense"],
    ["6010", "Beban Sewa", "expense", "debit", "operating_expense"],
    ["6020", "Beban Listrik dan Air", "expense", "debit", "operating_expense"],
    ["6030", "Beban Telepon dan Internet", "expense", "debit", "operating_expense"],
    ["6040", "Beban Transportasi", "expense", "debit", "operating_expense"],
    ["6050", "Beban Perlengkapan", "expense", "debit", "operating_expense"],
    ["6060", "Beban Administrasi Bank", "expense", "debit", "operating_expense"],
    ["6070", "Beban Lain-lain", "expense", "debit", "other_expense"],
    ["8000", "Selisih Kas Kurang", "expense", "debit", "other_expense"],
    ["8001", "Selisih Kas Lebih", "revenue", "credit", "other_income"],
    ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit", "other_income"],
    ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit", "other_expense"],
  ];
  const accountRows = await adminDb
    .insert(accounts)
    .values(
      accountSeeds.map(([code, name, type, normalBalance, section]) => ({
        companyId: ORG, code, name, type, normalBalance, section,
        // A-27 B1/B2: kelas kas/bank mengikuti seed demo resmi —
        // kas & kas kecil "cash", bank "bank", QRIS "clearing".
        cashBankKind:
          code === "1000" || code === "1010"
            ? "cash"
            : code === "1100"
              ? "bank"
              : code === "1110"
                ? "clearing"
                : null,
      })),
    )
    .returning();
  for (const row of accountRows) F.acc[row.code] = row.id;

  const mapping: Record<string, string> = {
    cash: F.acc["1000"], bank: F.acc["1100"], qris: F.acc["1110"],
    receivable: F.acc["1200"], supplier_credit: F.acc["1210"],
    employee_receivable: F.acc["1220"], inventory: F.acc["1300"],
    payable: F.acc["2000"], revenue: F.acc["4000"],
    sales_discount: F.acc["4010"], sales_return: F.acc["4020"],
    cogs: F.acc["5000"], inventory_shrink: F.acc["5010"], damaged: F.acc["5020"],
    tax_output: F.acc["2200"], rounding_gain: F.acc["9000"],
    rounding_loss: F.acc["9001"], cash_short: F.acc["8000"],
    cash_over: F.acc["8001"], salary_expense: F.acc["6000"],
    salary_payable: F.acc["2100"], bank_fee: F.acc["6060"],
    equity: F.acc["3000"], customer_credit: F.acc["2300"],
  };
  await adminDb.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: ORG, key, accountId })),
  );

  const methodRows = await adminDb
    .insert(paymentMethods)
    .values([
      { companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: mapping.cash, sortOrder: 1 },
      { companyId: ORG, code: "QRIS", name: "QRIS", type: "qris", accountId: mapping.qris, sortOrder: 2 },
      { companyId: ORG, code: "TRANSFER", name: "Transfer Bank", type: "bank", accountId: mapping.bank, sortOrder: 3 },
      { companyId: ORG, code: "CREDIT", name: "Utang / Tempo", type: "credit", accountId: mapping.receivable, sortOrder: 4 },
      { companyId: ORG, code: "CUSTCREDIT", name: "Kredit Pelanggan", type: "customer_credit", accountId: mapping.customer_credit, sortOrder: 5 },
    ])
    .returning();
  for (const row of methodRows) F.method[row.code] = row.id;

  const [group] = await adminDb
    .insert(customerGroups)
    .values({ companyId: ORG, name: "Umum", roundingStep: 0, roundingDirection: "down" })
    .returning();

  const [category] = await adminDb
    .insert(categories)
    .values({ companyId: ORG, name: "Simulasi" })
    .returning();
  const [unit] = await adminDb
    .insert(units)
    .values({ companyId: ORG, code: "PCS", name: "Pieces" })
    .returning();

  const supplierRows = await adminDb
    .insert(suppliers)
    .values([
      { companyId: ORG, code: "SIM-S1", name: "PT Sumber Sim", phone: "021-7000-111" },
      { companyId: ORG, code: "SIM-S2", name: "CV Sim Jaya", phone: "021-7000-222" },
    ])
    .returning();
  F.s1 = supplierRows[0].id;
  F.s2 = supplierRows[1].id;

  const customerRows = await adminDb
    .insert(customers)
    .values([
      { companyId: ORG, code: "SIM-C1", name: "Toko Berkah", groupId: group.id, creditLimit: "1000000" },
      { companyId: ORG, code: "SIM-C2", name: "Ibu Ani", groupId: group.id, creditLimit: "0" },
      { companyId: ORG, code: "SIM-C3", name: "Warung Maju", groupId: group.id, creditLimit: "5000000" },
    ])
    .returning();
  F.c1 = customerRows[0].id;
  F.c2 = customerRows[1].id;
  F.c3 = customerRows[2].id;

  const employeeRows = await adminDb
    .insert(employees)
    .values([
      { companyId: ORG, code: "SIM-E1", name: "Andi Pratama", position: "Kasir", baseSalary: "4000000", allowances: "500000", deductions: "0", joinedAt: TODAY, isActive: true },
      { companyId: ORG, code: "SIM-E2", name: "Bina Lestari", position: "Gudang", baseSalary: "3000000", allowances: "0", deductions: "0", joinedAt: TODAY, isActive: true },
      { companyId: ORG, code: "SIM-E3", name: "Citra Dewi", position: "Admin", baseSalary: "2500000", allowances: "250000", deductions: "0", joinedAt: TODAY, isActive: true },
    ])
    .returning();
  F.e1 = employeeRows[0].id;
  F.e2 = employeeRows[1].id;
  F.e3 = employeeRows[2].id;

  const productRows = await adminDb
    .insert(products)
    .values(
      PRODUCT_SEEDS.map((p, index) => ({
        companyId: ORG,
        sku: `SIM-${String(index + 1).padStart(3, "0")}`,
        name: p.name,
        categoryId: category.id,
        unitId: unit.id,
        costPrice: toDb(p.cost),
        salePrice: toDb(p.price),
        minStock: toDb(p.min),
        trackStock: true,
        trackBatch: p.batch ?? false,
        isActive: true,
      })),
    )
    .returning();
  PRODUCT_SEEDS.forEach((p, index) => {
    F.p[p.key] = productRows[index].id;
  });

  await adminDb.insert(fiscalPeriods).values(
    Array.from({ length: 12 }, (_, i) => ({
      companyId: ORG, year: YEAR, month: i + 1, status: "open",
    })),
  );
}

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

/* ------------------------------------------------------------------ */
/* Verifikasi helpers (SQL/Drizzle hanya untuk membaca angka)          */
/* ------------------------------------------------------------------ */

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, ORG),
        eq(stockOnHand.warehouseId, warehouseId),
        eq(stockOnHand.productId, productId),
      ),
    );
  return d(row?.qty ?? 0);
}

async function batchQty(tx: Tx, productId: string, batchNumber: string) {
  const [row] = await tx
    .select({ qty: stockBatches.qty })
    .from(stockBatches)
    .where(
      and(
        eq(stockBatches.companyId, ORG),
        eq(stockBatches.productId, productId),
        eq(stockBatches.batchNumber, batchNumber),
      ),
    );
  return d(row?.qty ?? 0);
}

async function productCost(tx: Tx, productId: string) {
  const [row] = await tx
    .select({ costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, productId));
  return d(row?.costPrice ?? 0);
}

/** Saldo GL bertanda (debit − kredit) atas jurnal posted, opsional per pihak. */
async function glBalance(tx: Tx, code: string, partyId?: string) {
  const conditions = [
    eq(journalLines.companyId, ORG),
    eq(journalLines.accountId, F.acc[code]),
    eq(journalEntries.status, "posted"),
  ];
  if (partyId) conditions.push(eq(journalLines.partyId, partyId));
  const rows = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(...conditions));
  return rows.reduce((acc, row) => acc.plus(d(row.debit)).minus(d(row.credit)), d(0));
}

async function journalOf(tx: Tx, sourceType: string, sourceId: string) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.status, "posted"),
      ),
    )
    .orderBy(asc(journalEntries.createdAt));
  const result = [];
  for (const entry of entries) {
    const lines = await tx
      .select()
      .from(journalLines)
      .where(eq(journalLines.entryId, entry.id));
    result.push({ entry, lines });
  }
  return result;
}

function lineSum(
  lines: { accountId: string; debit: string; credit: string }[],
  accountId: string,
) {
  const mine = lines.filter((line) => line.accountId === accountId);
  return {
    debit: mine.reduce((acc, line) => acc.plus(d(line.debit)), d(0)),
    credit: mine.reduce((acc, line) => acc.plus(d(line.credit)), d(0)),
  };
}

/** Keadaan bersama antar-langkah garis waktu. */
const S = {
  po1ReceiptId: "",
  po2ReceiptAId: "",
  po2ReceiptBId: "",
  s1DirectReceiptId: "",
  s2ReceiptBId: "",
  return1Id: "",
  return2Id: "",
  tehReceiptId: "",
  kopiReceiptId: "",
  sale1Id: "",
  sessionId: "",
  payrollRunId: "",
};

describe("S1.0 setup & modal awal", () => {
  it("fixture lengkap: 12 produk, 2 gudang, 2 pemasok, 3 pelanggan, 3 karyawan", async () => {
    await read(async (tx) => {
      const productRows = await tx.select().from(products).where(eq(products.companyId, ORG));
      expect(productRows).toHaveLength(12);
      const warehouseRows = await tx.select().from(warehouses).where(eq(warehouses.companyId, ORG));
      expect(warehouseRows).toHaveLength(2);
      expect(await glBalance(tx, "1000")).toEqual(d(0));
    });
  });

  it("modal awal Rp50jt: Dr Kas 45jt + Dr Bank 5jt / Cr Modal 50jt, jurnal seimbang", async () => {
    const entry = await run((tx) =>
      postJournal(tx, {
        companyId: ORG,
        date: TODAY,
        description: "Setoran modal awal SimMart",
        sourceType: "manual",
        createdBy: OWNER,
        lines: [
          { accountId: F.acc["1000"], debit: 45_000_000, description: "Kas tunai" },
          { accountId: F.acc["1100"], debit: 5_000_000, description: "Bank BCA" },
          { accountId: F.acc["3000"], credit: 50_000_000, description: "Modal pemilik" },
        ],
      }),
    );
    expect(entry.id).toBeTruthy();
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "1000"), 45_000_000);
      expectMoney(await glBalance(tx, "1100"), 5_000_000);
      expectMoney(await glBalance(tx, "3000"), -50_000_000);
    });
  });
});

describe("S1.1 procurement — PO, penerimaan, utang", () => {
  it("PO-1 diterima PENUH: stok 100+100, AVCO = harga beli, utang S1 Rp550.000, PO received", async () => {
    const { receiptId, orderId } = await run(async (tx) => {
      const order = await createPurchaseOrder(tx, {
        companyId: ORG,
        userId: OWNER,
        supplierId: F.s1,
        date: TODAY,
        lines: [
          { productId: F.p.AQUA, qty: "100", unitCost: "2500" },
          { productId: F.p.IND, qty: "100", unitCost: "3000" },
        ],
      });
      await sendPurchaseOrder(tx, { companyId: ORG, userId: OWNER, orderId: order.id });
      const receipt = await createReceipt(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh1,
        supplierId: F.s1,
        source: "purchase",
        purchaseOrderId: order.id,
        supplierInvoiceNumber: "INV-S1-001",
        date: TODAY,
        lines: [
          { productId: F.p.AQUA, qty: "100", unitCost: "2500" },
          { productId: F.p.IND, qty: "100", unitCost: "3000" },
        ],
      });
      return { receiptId: receipt.id, orderId: order.id };
    });
    S.po1ReceiptId = receiptId;

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.AQUA), 100);
      expectMoney(await stockQty(tx, F.wh1, F.p.IND), 100);
      expectMoney(await productCost(tx, F.p.AQUA), 2500);
      expectMoney(await productCost(tx, F.p.IND), 3000);

      const [order] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, orderId));
      expect(order.status).toBe("received");

      const journals = await journalOf(tx, "purchase", receiptId);
      expect(journals).toHaveLength(1);
      expectMoney(lineSum(journals[0].lines, F.acc["1300"]).debit, 550_000);
      expectMoney(lineSum(journals[0].lines, F.acc["2000"]).credit, 550_000);

      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s1), 550_000);
      const payables = await listPayables(tx, ORG);
      expect(payables.find((row) => row.id === receiptId)?.outstanding).toBe(550_000);
    });
  });

  it("PO-2 diterima PARSIAL dua kali; terima KELEBIHAN dari sisa PO ditolak tanpa efek", async () => {
    const orderId = await run(async (tx) => {
      const order = await createPurchaseOrder(tx, {
        companyId: ORG,
        userId: OWNER,
        supplierId: F.s1,
        date: TODAY,
        lines: [{ productId: F.p.GULA, qty: "50", unitCost: "15000" }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG, userId: OWNER, orderId: order.id });

      const first = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s1,
        source: "purchase", purchaseOrderId: order.id, date: TODAY,
        lines: [{ productId: F.p.GULA, qty: "30", unitCost: "15000" }],
      });
      S.po2ReceiptAId = first.id;
      const [mid] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, order.id));
      expect(mid.status).toBe("partial");
      expectMoney(await stockQty(tx, F.wh1, F.p.GULA), 30);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s1), 1_000_000);

      const second = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s1,
        source: "purchase", purchaseOrderId: order.id, date: TODAY,
        lines: [{ productId: F.p.GULA, qty: "20", unitCost: "15000" }],
      });
      S.po2ReceiptBId = second.id;
      const [done] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, order.id));
      expect(done.status).toBe("received");
      return order.id;
    });

    // Terima melebihi sisa PO (sisa = 0): harus ditolak dan tidak menulis apa pun.
    await expectRejects(
      run((tx) =>
        createReceipt(tx, {
          companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s1,
          source: "purchase", purchaseOrderId: orderId, date: TODAY,
          lines: [{ productId: F.p.GULA, qty: "1", unitCost: "15000" }],
        }),
      ),
    );
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.GULA), 50);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s1), 1_300_000);
    });
  });

  it("penerimaan langsung tanpa PO (S1): MINYAK 20 + TISU 5 — utang S1 menjadi Rp2.047.500", async () => {
    const receiptId = await run(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s1,
        source: "purchase", supplierInvoiceNumber: "INV-S1-004", date: TODAY,
        lines: [
          { productId: F.p.MINYAK, qty: "20", unitCost: "34000" },
          { productId: F.p.TISU, qty: "5", unitCost: "13500" },
        ],
      });
      return receipt.id;
    });
    S.s1DirectReceiptId = receiptId;
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.MINYAK), 20);
      expectMoney(await stockQty(tx, F.wh1, F.p.TISU), 5);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s1), 2_047_500);
    });
  });

  it("penerimaan batch S2 dua lot: AVCO SUSU menjadi Rp5.100, utang S2 Rp204.000", async () => {
    await run(async (tx) => {
      await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s2,
        source: "purchase", supplierInvoiceNumber: "INV-S2-001", date: TODAY,
        lines: [{ productId: F.p.SUSU, qty: "20", unitCost: "5000", batchNumber: "LOT-A", expiryDate: EXP_A }],
      });
      const second = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s2,
        source: "purchase", supplierInvoiceNumber: "INV-S2-002", date: TODAY,
        lines: [{ productId: F.p.SUSU, qty: "20", unitCost: "5200", batchNumber: "LOT-B", expiryDate: EXP_B }],
      });
      S.s2ReceiptBId = second.id;
    });
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.SUSU), 40);
      // AVCO global: (20×5.000 + 20×5.200) / 40 = 5.100.
      expectMoney(await productCost(tx, F.p.SUSU), 5100);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-A"), 20);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-B"), 20);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 204_000);
    });
  });
});

describe("S1.2 retur pembelian ke pemasok (A-9/D-20)", () => {
  it("retur#1: 5 SUSU rusak (FEFO dari LOT-A) memotong utang S2 menjadi Rp178.500, tanpa kredit", async () => {
    const returnId = await run(async (tx) => {
      const ret = await createSupplierReturn(tx, {
        companyId: ORG, userId: OWNER, supplierId: F.s2, warehouseId: F.wh1,
        date: TODAY, reasonCategory: "damaged",
        reasonDetail: "Botol pecah saat bongkar muat",
        resolutionType: "next_purchase_credit",
        lines: [{ productId: F.p.SUSU, qty: "5" }],
      });
      const posted = await postSupplierReturn(tx, { companyId: ORG, userId: OWNER, returnId: ret.id });
      expectMoney(posted.totalValue, 25_500); // 5 × AVCO 5.100
      return ret.id;
    });
    S.return1Id = returnId;

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.SUSU), 35);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-A"), 15); // FEFO: lot terawal dulu
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-B"), 20);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 178_500);
      // Seluruh nilai retur terserap utang — tidak ada klaim kredit pemasok.
      expectMoney(await glBalance(tx, "1210", F.s2), 0);
      const [header] = await tx
        .select()
        .from(supplierReturns)
        .where(eq(supplierReturns.id, returnId));
      expectMoney(header.payableAmount, 25_500);
      expectMoney(header.creditAmount, 0);
    });
  });

  it("utang S2 dilunasi FIFO Rp178.500; pembayaran ganda atas dokumen lunas ditolak", async () => {
    await run((tx) =>
      payPayableFifo(tx, {
        companyId: ORG, userId: OWNER, supplierId: F.s2, date: TODAY,
        amount: 178_500, accountId: F.acc["1000"],
      }),
    );
    await read(async (tx) => {
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 0);
      expectMoney(await glBalance(tx, "1000"), 44_821_500);
    });
    // Dokumen penerimaan LOT-B sudah lunas — membayar lagi harus ditolak.
    await expectRejects(
      run((tx) =>
        payPayableDocument(tx, {
          companyId: ORG, userId: OWNER, receiptId: S.s2ReceiptBId, date: TODAY,
          amount: 1_000, accountId: F.acc["1000"],
        }),
      ),
      { code: "INVALID_STATE" },
    );
    await read(async (tx) => {
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 0);
    });
  });

  it("retur#2: 10 SUSU saat utang nol — seluruhnya menjadi Kredit Pemasok Rp51.000", async () => {
    const returnId = await run(async (tx) => {
      const ret = await createSupplierReturn(tx, {
        companyId: ORG, userId: OWNER, supplierId: F.s2, warehouseId: F.wh1,
        date: TODAY, reasonCategory: "quality",
        reasonDetail: "Kemasan kusam dan segel rusak, tidak layak jual",
        resolutionType: "next_purchase_credit",
        lines: [{ productId: F.p.SUSU, qty: "10" }],
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: OWNER, returnId: ret.id });
      return ret.id;
    });
    S.return2Id = returnId;

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.SUSU), 25);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-A"), 5);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-B"), 20);
      expectMoney(await glBalance(tx, "1210", F.s2), 51_000);
      const [header] = await tx
        .select()
        .from(supplierReturns)
        .where(eq(supplierReturns.id, returnId));
      expectMoney(header.creditAmount, 51_000);
      expectMoney(header.resolvedAmount, 0);
    });
  });

  it("penyelesaian campuran: kredit Rp40.000 memotong penerimaan TEH baru, sisa klaim Rp11.000", async () => {
    const tehReceiptId = await run(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s2,
        source: "purchase", supplierInvoiceNumber: "INV-S2-003", date: TODAY,
        lines: [{ productId: F.p.TEH, qty: "10", unitCost: "4000" }],
      });
      const applied = await applySupplierCredit(tx, {
        companyId: ORG, userId: OWNER, returnId: S.return2Id,
        amount: 40_000, date: TODAY,
      });
      expectMoney(applied.remainingClaim, 11_000);
      return receipt.id;
    });
    S.tehReceiptId = tehReceiptId;

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.TEH), 10);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 0);
      expectMoney(await glBalance(tx, "1210", F.s2), 11_000);
    });
  });

  it("refund sisa klaim Rp11.000 ke kas — klaim habis, retur resolved, kas bertambah", async () => {
    await run(async (tx) => {
      const refunded = await refundSupplierReturn(tx, {
        companyId: ORG, userId: OWNER, returnId: S.return2Id,
        accountId: F.acc["1000"], amount: 11_000, date: TODAY,
      });
      expectMoney(refunded.remainingClaim, 0);
    });
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "1210", F.s2), 0);
      expectMoney(await glBalance(tx, "1000"), 44_832_500);
      const [header] = await tx
        .select()
        .from(supplierReturns)
        .where(eq(supplierReturns.id, S.return2Id));
      expect(header.status).toBe("resolved");
    });
  });

  it("penerimaan KOPI S2 Rp75.000 dibiarkan terbuka untuk rekonsiliasi utang akhir", async () => {
    const receiptId = await run(async (tx) => {
      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s2,
        source: "purchase", supplierInvoiceNumber: "INV-S2-004", date: TODAY,
        lines: [{ productId: F.p.KOPI, qty: "50", unitCost: "1500" }],
      });
      return receipt.id;
    });
    S.kopiReceiptId = receiptId;
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.KOPI), 50);
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s2), 75_000);
    });
  });
});

describe("S1.3 pembayaran utang S1", () => {
  it("bayar sebagian Rp300.000 → status partial; lunas Rp250.000; bayar lagi ditolak", async () => {
    await run((tx) =>
      payPayableDocument(tx, {
        companyId: ORG, userId: OWNER, receiptId: S.po1ReceiptId, date: TODAY,
        amount: 300_000, accountId: F.acc["1000"],
      }),
    );
    await read(async (tx) => {
      const [receipt] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, S.po1ReceiptId));
      expect(receipt.paymentStatus).toBe("partial");
      expectMoney(receipt.paidAmount, 300_000);
      const payables = await listPayables(tx, ORG);
      expect(payables.find((row) => row.id === S.po1ReceiptId)?.outstanding).toBe(250_000);
    });

    await run((tx) =>
      payPayableDocument(tx, {
        companyId: ORG, userId: OWNER, receiptId: S.po1ReceiptId, date: TODAY,
        amount: 250_000, accountId: F.acc["1000"],
      }),
    );
    await expectRejects(
      run((tx) =>
        payPayableDocument(tx, {
          companyId: ORG, userId: OWNER, receiptId: S.po1ReceiptId, date: TODAY,
          amount: 1_000, accountId: F.acc["1000"],
        }),
      ),
      { code: "INVALID_STATE" },
    );
  });

  it("sisa utang S1 Rp1.497.500 dilunasi FIFO — utang S1 nol, kas Rp42.785.000", async () => {
    await run((tx) =>
      payPayableFifo(tx, {
        companyId: ORG, userId: OWNER, supplierId: F.s1, date: TODAY,
        amount: 1_497_500, accountId: F.acc["1000"],
      }),
    );
    await read(async (tx) => {
      expectMoney(await getSupplierOpenPayable(tx, ORG, F.s1), 0);
      expectMoney(await glBalance(tx, "2000", F.s1), 0);
      expectMoney(await glBalance(tx, "1000"), 42_785_000);
    });
  });
});

describe("S1.4 POS — sesi, penjualan, utang, FEFO, hold, konkurensi", () => {
  it("sesi dibuka dengan modal Rp200.000; jual tunai (kembalian Rp10.000) + jual QRIS", async () => {
    const session = await run((tx) =>
      openCashSession(tx, { companyId: ORG, userId: OWNER, openingCash: 200_000 }),
    );
    S.sessionId = session.id;

    const sale1 = await checkoutAction({
      warehouseId: F.wh1,
      lines: [{ productId: F.p.AQUA, qty: 10 }],
      payments: [{ methodId: F.method.CASH, amount: 40_000, tendered: 50_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(sale1.ok).toBe(true);
    if (!sale1.ok) return;
    expect(sale1.data.total).toBe(40_000);
    expect(sale1.data.change).toBe(10_000);
    S.sale1Id = sale1.data.id;

    const sale2 = await checkoutAction({
      warehouseId: F.wh1,
      lines: [{ productId: F.p.IND, qty: 5 }],
      payments: [{ methodId: F.method.QRIS, amount: 19_000, tendered: 19_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(sale2.ok).toBe(true);

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.AQUA), 90);
      expectMoney(await stockQty(tx, F.wh1, F.p.IND), 95);
      expectMoney(await glBalance(tx, "1110"), 19_000);
      const journals = await journalOf(tx, "sale", S.sale1Id);
      expect(journals).toHaveLength(1);
      expectMoney(lineSum(journals[0].lines, F.acc["1000"]).debit, 40_000);
      expectMoney(lineSum(journals[0].lines, F.acc["4000"]).credit, 40_000);
      expectMoney(lineSum(journals[0].lines, F.acc["5000"]).debit, 25_000);
      expectMoney(lineSum(journals[0].lines, F.acc["1300"]).credit, 25_000);
    });
  });

  it("jual split tunai+QRIS; jual UTANG dalam batas kredit; lewati batas kredit ditolak", async () => {
    const split = await checkoutAction({
      warehouseId: F.wh1,
      lines: [{ productId: F.p.GULA, qty: 2 }],
      payments: [
        { methodId: F.method.CASH, amount: 20_000, tendered: 20_000 },
        { methodId: F.method.QRIS, amount: 16_000, tendered: 16_000 },
      ],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(split.ok).toBe(true);
    if (split.ok) expect(split.data.total).toBe(36_000);

    const debt = await checkoutAction({
      warehouseId: F.wh1,
      customerId: F.c1,
      dueDate: DUE_DATE,
      lines: [{ productId: F.p.MINYAK, qty: 10 }],
      payments: [{ methodId: F.method.CREDIT, amount: 390_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(debt.ok).toBe(true);
    if (debt.ok) expect(debt.data.total).toBe(390_000);

    // Piutang berjalan 390.000 + percobaan 720.000 = 1.110.000 > batas 1.000.000.
    const overLimit = await checkoutAction({
      warehouseId: F.wh1,
      customerId: F.c1,
      dueDate: DUE_DATE,
      lines: [{ productId: F.p.GULA, qty: 40 }],
      payments: [{ methodId: F.method.CREDIT, amount: 720_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(overLimit.ok).toBe(false);
    if (!overLimit.ok) expect(overLimit.message).toMatch(/batas kredit/i);

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.GULA), 48); // sale gagal tidak mengurangi stok
      expectMoney(await stockQty(tx, F.wh1, F.p.MINYAK), 10);
      expectMoney(await glBalance(tx, "1200", F.c1), 390_000);
      const receivables = await listReceivables(tx, ORG);
      const mine = receivables.filter((row) => row.customerId === F.c1);
      expect(mine).toHaveLength(1);
      expect(mine[0].outstanding).toBe(390_000);
      expect(mine[0].dueDate).toBe(DUE_DATE);
    });
  });

  it("penjualan SUSU 12 pcs mengalokasikan FEFO: LOT-A habis (0), LOT-B tersisa 13", async () => {
    const sale = await checkoutAction({
      warehouseId: F.wh1,
      lines: [{ productId: F.p.SUSU, qty: 12 }],
      payments: [{ methodId: F.method.CASH, amount: 84_000, tendered: 84_000 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(sale.ok).toBe(true);
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.SUSU), 13);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-A"), 0);
      expectMoney(await batchQty(tx, F.p.SUSU, "LOT-B"), 13);
    });
  });

  it("retur penjualan sebagian (2 AQUA, refund tunai): stok kembali, pendapatan & HPP berbalik proporsional", async () => {
    const ret = await run((tx) =>
      createSaleReturn(tx, {
        companyId: ORG, userId: OWNER, saleId: S.sale1Id, date: TODAY,
        reason: "Botol bocor ditemukan pelanggan",
        refundMethod: "cash", type: "return",
        lines: [{ productId: F.p.AQUA, qty: 2 }],
      }),
    );
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.AQUA), 92);
      // Jurnal retur: Dr Retur Penjualan 8.000 / Cr Kas 8.000 dan
      // Dr Persediaan 5.000 / Cr HPP 5.000 (2 × AVCO 2.500).
      const journals = await journalOf(tx, "sale_return", ret.id);
      expect(journals).toHaveLength(1);
      expectMoney(lineSum(journals[0].lines, F.acc["4020"]).debit, 8_000);
      expectMoney(lineSum(journals[0].lines, F.acc["1000"]).credit, 8_000);
      expectMoney(lineSum(journals[0].lines, F.acc["1300"]).debit, 5_000);
      expectMoney(lineSum(journals[0].lines, F.acc["5000"]).credit, 5_000);
    });
  });

  it("hold → resume (baca-saja) → checkout merujuk tahanan: tahanan terhapus, stok KOPI 45", async () => {
    const held = await holdAction({
      warehouseId: F.wh1,
      label: "Pesanan Bu Rina",
      lines: [{ productId: F.p.KOPI, qty: 5 }],
      idempotencyKey: crypto.randomUUID(),
    });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const heldId = held.data.id;

    const resumed = await resumeHeldSaleAction(heldId);
    expect(resumed.ok).toBe(true);
    if (resumed.ok) {
      expect(resumed.data.heldTotal).toBe(12_500);
      expect(resumed.data.lines).toHaveLength(1);
    }
    // Resume tidak menghapus tahanan (D-9).
    await read(async (tx) => {
      const heldList = await listHeldSales(tx, ORG);
      expect(heldList.some((row) => row.id === heldId)).toBe(true);
      expectMoney(await stockQty(tx, F.wh1, F.p.KOPI), 50); // hold tidak menggerakkan stok
    });

    const checkout = await checkoutAction({
      warehouseId: F.wh1,
      lines: [{ productId: F.p.KOPI, qty: 5 }],
      payments: [{ methodId: F.method.CASH, amount: 12_500, tendered: 12_500 }],
      heldSaleId: heldId,
      idempotencyKey: crypto.randomUUID(),
    });
    expect(checkout.ok).toBe(true);
    await read(async (tx) => {
      const heldList = await listHeldSales(tx, ORG);
      expect(heldList.some((row) => row.id === heldId)).toBe(false);
      expectMoney(await stockQty(tx, F.wh1, F.p.KOPI), 45);
    });
  });

  it("dua penjualan BERSAMAAN atas TISU (stok 5, masing-masing 4): tepat satu berhasil, stok akhir 1, tidak oversell", async () => {
    const attempt = () =>
      run((tx) =>
        createSale(tx, {
          companyId: ORG, userId: OWNER, warehouseId: F.wh1, date: TODAY,
          lines: [{ productId: F.p.TISU, qty: 4 }],
          payments: [{ methodId: F.method.CASH, amount: 68_000, tendered: 68_000 }],
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason as { code?: string };
    expect(reason.code).toBe("INSUFFICIENT_STOCK");

    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.TISU), 1);
    });
  });

  it("tutup sesi: kas diharapkan Rp416.500, dihitung Rp414.500 — selisih kurang Rp2.000 tercatat & terjurnal", async () => {
    const closed = await run((tx) =>
      closeCashSession(tx, {
        companyId: ORG, userId: OWNER, sessionId: S.sessionId,
        countedCash: 414_500, notes: "Tutup toko hari pertama",
        // A-28 Tahap 1 (H-POS-02): selisih −2.000 wajib alasan.
        differenceReason: "Kembalian kurang Rp2.000",
      }),
    );
    expect(closed.expected).toBe(416_500);
    expect(closed.counted).toBe(414_500);
    expect(closed.difference).toBe(-2_000);

    await read(async (tx) => {
      const journals = await journalOf(tx, "cash_session", S.sessionId);
      expect(journals).toHaveLength(1);
      expectMoney(lineSum(journals[0].lines, F.acc["8000"]).debit, 2_000);
      expectMoney(lineSum(journals[0].lines, F.acc["1000"]).credit, 2_000);
    });
  });
});

describe("S1.5 gudang — transfer & opname", () => {
  it("transfer AQUA 20 dari Gudang Utama ke Gudang Cabang; total stok & GL persediaan tidak berubah", async () => {
    await run((tx) =>
      createTransfer(tx, {
        companyId: ORG, userId: OWNER,
        fromWarehouseId: F.wh1, toWarehouseId: F.wh2, date: TODAY,
        lines: [{ productId: F.p.AQUA, qty: "20" }],
      }),
    );
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.AQUA), 72);
      expectMoney(await stockQty(tx, F.wh2, F.p.AQUA), 20);
      // Nilai persediaan sebelum opname: 1.762.300 (lihat rekonsiliasi akhir).
      expectMoney(await glBalance(tx, "1300"), 1_762_300);
    });
  });

  it("opname GULA: sistem 48, fisik 45 — selisih kurang 3 × Rp15.000 terjurnal ke Selisih Persediaan", async () => {
    const doc = await run((tx) =>
      createOpname(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh1, date: TODAY,
        notes: "Opname perdana SimMart",
        lines: [{ productId: F.p.GULA, countedQty: "45" }],
      }),
    );
    await read(async (tx) => {
      expectMoney(await stockQty(tx, F.wh1, F.p.GULA), 45);
      const journals = await journalOf(tx, "opname", doc.id);
      expect(journals.length).toBeGreaterThanOrEqual(1);
      const allLines = journals.flatMap((j) => j.lines);
      expectMoney(lineSum(allLines, F.acc["5010"]).debit, 45_000);
      expectMoney(lineSum(allLines, F.acc["1300"]).credit, 45_000);
      expectMoney(await glBalance(tx, "1300"), 1_717_300);
    });
  });

  it("peringatan stok minimum: SABUN (min 10, stok 0) & TEH (min 12, stok 10) terdaftar menipis; AQUA tidak", async () => {
    await read(async (tx) => {
      const valuation = await getInventoryValuation(tx, ORG);
      const lowSkus = valuation.lowStock.map((row) => row.sku);
      expect(lowSkus).toContain("SIM-011"); // SABUN
      expect(lowSkus).toContain("SIM-008"); // TEH
      expect(lowSkus).not.toContain("SIM-001"); // AQUA stok 92
      expectMoney(valuation.totalValue, 1_717_300);
    });
  });
});

describe("S1.6 akuntansi — beban, entri cepat, piutang, jurnal manual", () => {
  it("beban listrik Rp750.000 via domain beban (jalur Catat Transaksi): Dr Beban Listrik / Cr Bank", async () => {
    const expense = await run((tx) =>
      createExpense(tx, {
        companyId: ORG, userId: OWNER, date: TODAY,
        expenseAccountId: F.acc["6020"], paymentAccountId: F.acc["1100"],
        amount: 750_000, description: "Listrik dan air bulan berjalan",
      }),
    );
    await read(async (tx) => {
      const journals = await journalOf(tx, "expense", expense.id);
      expect(journals).toHaveLength(1);
      expectMoney(lineSum(journals[0].lines, F.acc["6020"]).debit, 750_000);
      expectMoney(lineSum(journals[0].lines, F.acc["1100"]).credit, 750_000);
      expectMoney(await glBalance(tx, "1100"), 4_250_000);
    });
  });

  it("penjualan tunai non-stok Rp100.000 (Catat Transaksi): Dr Kas / Cr Pendapatan Lain-lain", async () => {
    const posted = await run((tx) =>
      postQuickCashSale(tx, {
        companyId: ORG, userId: OWNER, date: TODAY,
        amount: 100_000, accountId: F.acc["1000"], revenueAccountId: F.acc["4030"],
        taxIncluded: false, taxRate: 0, notes: "Jasa penitipan paket",
      }),
    );
    await read(async (tx) => {
      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, posted.journalId));
      expectMoney(lineSum(lines, F.acc["1000"]).debit, 100_000);
      expectMoney(lineSum(lines, F.acc["4030"]).credit, 100_000);
    });
  });

  it("terima piutang Toko Berkah sebagian Rp200.000 FIFO — sisa piutang Rp190.000, status partial", async () => {
    await run((tx) =>
      receiveReceivableFifo(tx, {
        companyId: ORG, userId: OWNER, customerId: F.c1, date: TODAY,
        amount: 200_000, accountId: F.acc["1000"],
      }),
    );
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "1200", F.c1), 190_000);
      const receivables = await listReceivables(tx, ORG);
      const mine = receivables.filter((row) => row.customerId === F.c1);
      expect(mine).toHaveLength(1);
      expect(mine[0].outstanding).toBe(190_000);
      expect(mine[0].paymentStatus).toBe("partial");
    });
  });

  it("jurnal manual seimbang: Dr Beban Sewa Rp1.200.000 / Cr Kas", async () => {
    await run((tx) =>
      postJournal(tx, {
        companyId: ORG, date: TODAY,
        description: "Sewa toko bulan berjalan",
        sourceType: "manual", createdBy: OWNER,
        lines: [
          { accountId: F.acc["6010"], debit: 1_200_000, description: "Sewa toko" },
          { accountId: F.acc["1000"], credit: 1_200_000, description: "Kas keluar" },
        ],
      }),
    );
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "6010"), 1_200_000);
    });
  });
});

describe("S1.7 HR ringkas — kasbon & payroll (A-11/D-22)", () => {
  it("kasbon Andi Rp500.000 rencana cicilan tetap Rp200.000: Dr Piutang Karyawan / Cr Kas", async () => {
    const advance = await run((tx) =>
      createEmployeeAdvance(tx, {
        companyId: ORG, userId: OWNER, employeeId: F.e1, date: TODAY,
        amount: 500_000, accountId: F.acc["1000"],
        planMode: "fixed", planValue: 200_000, note: "Kasbon kebutuhan keluarga",
      }),
    );
    expect(advance.number).toMatch(/^KSB-/);
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "1220"), 500_000);
    });
  });

  it("payroll bulan berjalan: bruto Rp10.250.000, potongan kasbon Andi Rp200.000, bersih Rp10.050.000", async () => {
    const result = await runPayrollAction({ period: PERIOD });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    S.payrollRunId = result.data.id;

    await read(async (tx) => {
      const [runRow] = await tx
        .select()
        .from(payrollRuns)
        .where(eq(payrollRuns.id, S.payrollRunId));
      expectMoney(runRow.totalGross, 10_250_000);
      expectMoney(runRow.totalAdvanceDeductions, 200_000);
      expectMoney(runRow.totalNet, 10_050_000);

      const items = await tx
        .select()
        .from(payrollItems)
        .where(eq(payrollItems.runId, S.payrollRunId));
      const andi = items.find((item) => item.employeeId === F.e1);
      expect(andi).toBeDefined();
      expectMoney(andi!.advanceDeduction, 200_000);
      expectMoney(andi!.net, 4_300_000); // 4.500.000 bruto − 200.000 kasbon

      const journals = await journalOf(tx, "payroll", S.payrollRunId);
      expect(journals).toHaveLength(1);
      const lines = journals[0].lines;
      expectMoney(lineSum(lines, F.acc["6000"]).debit, 10_250_000);
      expectMoney(lineSum(lines, F.acc["2100"]).credit, 10_050_000);
      expectMoney(lineSum(lines, F.acc["1220"]).credit, 200_000);
      const totalDebit = lines.reduce((acc, line) => acc.plus(d(line.debit)), d(0));
      const totalCredit = lines.reduce((acc, line) => acc.plus(d(line.credit)), d(0));
      expect(totalDebit.toFixed(2)).toBe(totalCredit.toFixed(2));

      // Sisa kasbon Andi terbawa: 500.000 − 200.000 = 300.000.
      expectMoney(await glBalance(tx, "1220"), 300_000);
    });
  });

  it("payroll dibayar dari kas: utang gaji lunas (saldo 2100 nol)", async () => {
    const paid = await payPayrollAction({
      runId: S.payrollRunId, accountId: F.acc["1000"], date: TODAY,
    });
    expect(paid.ok).toBe(true);
    await read(async (tx) => {
      expectMoney(await glBalance(tx, "2100"), 0);
    });
  });
});

describe("S1.8 rekonsiliasi laporan akhir bulan", () => {
  it("neraca saldo: total debit = total kredit; identitas Σ(debit−kredit) seluruh akun = 0", async () => {
    await read(async (tx) => {
      const tb = await getTrialBalance(tx, ORG, { from: MONTH_FROM, to: MONTH_TO });
      const totalDebit = tb.reduce((acc, row) => acc + row.debit, 0);
      const totalCredit = tb.reduce((acc, row) => acc + row.credit, 0);
      expect(totalDebit).toBeCloseTo(totalCredit, 2);
      expect(totalDebit).toBeGreaterThan(60_000_000);

      const [identity] = await tx
        .select({
          net: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(eq(journalLines.companyId, ORG), eq(journalEntries.status, "posted")),
        );
      expectMoney(identity.net, 0);
    });
  });

  it("saldo GL per akun cocok dengan hitungan tangan skenario", async () => {
    const expected: Record<string, number> = {
      "1000": 31_549_500, // kas: modal 45jt − pembayaran utang 2.226jt + refund 11rb + POS bersih 216,5rb + piutang 200rb + entri cepat 100rb − sewa 1,2jt − kasbon 500rb − gaji 10,05jt − selisih kas 2rb
      "1100": 4_250_000, // bank: modal 5jt − listrik 750rb
      "1110": 35_000, // QRIS: 19rb + 16rb
      "1200": 190_000, // piutang: 390rb − diterima 200rb
      "1210": 0, // kredit pemasok habis terselesaikan
      "1220": 300_000, // piutang karyawan: kasbon 500rb − potongan payroll 200rb
      "1300": 1_717_300, // persediaan: cocok valuasi di bawah
      "2000": -75_000, // utang: sisa penerimaan KOPI
      "2100": 0, // utang gaji lunas dibayar
      "3000": -50_000_000,
      "4000": -649_500, // penjualan: 40+19+36+390+84+12,5+68 rb
      "4010": 0,
      "4020": 8_000, // retur penjualan 2 AQUA
      "4030": -100_000,
      "5000": 527_700, // HPP bersih setelah retur
      "5010": 45_000, // selisih opname
      "6000": 10_250_000,
      "6010": 1_200_000,
      "6020": 750_000,
      "8000": 2_000, // selisih kas kurang sesi
    };
    await read(async (tx) => {
      for (const [code, value] of Object.entries(expected)) {
        expectMoney(await glBalance(tx, code), value);
      }
    });
  });

  it("laba rugi cocok hitungan tangan: pendapatan 741.500, HPP+selisih 572.700, beban 12.202.000, rugi bersih Rp12.033.200", async () => {
    await read(async (tx) => {
      const is = await getIncomeStatement(tx, ORG, { from: MONTH_FROM, to: MONTH_TO });
      expect(is.totalRevenue).toBeCloseTo(641_500, 2);
      expect(is.totalOtherIncome).toBeCloseTo(100_000, 2);
      expect(is.totalCogs).toBeCloseTo(572_700, 2);
      expect(is.grossProfit).toBeCloseTo(68_800, 2);
      expect(is.totalExpense).toBeCloseTo(12_202_000, 2);
      expect(is.netProfit).toBeCloseTo(-12_033_200, 2);
      const salesLine = is.revenue.find((line) => line.code === "4000");
      expect(salesLine?.amount).toBeCloseTo(649_500, 2);
    });
  });

  it("neraca seimbang: aset Rp38.041.800 = utang Rp75.000 + ekuitas Rp37.966.800 (termasuk rugi berjalan)", async () => {
    await read(async (tx) => {
      const bs = await getBalanceSheet(tx, ORG, MONTH_TO);
      expect(bs.balanced).toBe(true);
      expect(bs.totalAssets).toBeCloseTo(38_041_800, 2);
      expect(bs.totalLiabilities).toBeCloseTo(75_000, 2);
      expect(bs.totalEquity).toBeCloseTo(37_966_800, 2);
    });
  });

  it("subledger = akun kontrol: persediaan laporan = GL, piutang & utang daftar = GL; invariant stok = Σ gerakan", async () => {
    await read(async (tx) => {
      const valuation = await getInventoryValuation(tx, ORG);
      expectMoney(valuation.totalValue, 1_717_300);
      expectMoney(await glBalance(tx, "1300"), 1_717_300);

      const receivables = await listReceivables(tx, ORG);
      const arTotal = receivables.reduce((acc, row) => acc + row.outstanding, 0);
      expect(arTotal).toBeCloseTo(190_000, 2);
      expectMoney(await glBalance(tx, "1200"), arTotal);

      const payables = await listPayables(tx, ORG);
      const apTotal = payables.reduce((acc, row) => acc + row.outstanding, 0);
      expect(apTotal).toBeCloseTo(75_000, 2);
      expectMoney(await glBalance(tx, "2000"), -apTotal);

      // Invariant AGENTS.md: stock_on_hand = Σ stock_movements per produk×gudang.
      const mismatches = await tx
        .select({ productId: stockOnHand.productId })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG),
            sql`${stockOnHand.qty} <> coalesce((
              select sum(sm.qty) from ${stockMovements} sm
              where sm.company_id = ${ORG}
                and sm.product_id = ${stockOnHand.productId}
                and sm.warehouse_id = ${stockOnHand.warehouseId}
            ), 0)`,
          ),
        );
      expect(mismatches).toHaveLength(0);
    });
  });
});

describe("S1.9 tutup periode", () => {
  it("periode bulan berjalan ditutup; posting berjurnal pada bulan itu ditolak (PERIOD_CLOSED)", async () => {
    const closed = await setPeriodStatusAction({ year: YEAR, month: MONTH, status: "closed" });
    expect(closed.ok).toBe(true);

    await expectRejects(
      run((tx) =>
        postJournal(tx, {
          companyId: ORG, date: TODAY,
          description: "Posting setelah tutup periode",
          sourceType: "manual", createdBy: OWNER,
          lines: [
            { accountId: F.acc["6010"], debit: 1_000 },
            { accountId: F.acc["1000"], credit: 1_000 },
          ],
        }),
      ),
      { code: "PERIOD_CLOSED" },
    );
    await expectRejects(
      run((tx) =>
        createReceipt(tx, {
          companyId: ORG, userId: OWNER, warehouseId: F.wh1, supplierId: F.s1,
          source: "purchase", date: TODAY,
          lines: [{ productId: F.p.AQUA, qty: "1", unitCost: "2500" }],
        }),
      ),
      { code: "PERIOD_CLOSED" },
    );
  });
});
