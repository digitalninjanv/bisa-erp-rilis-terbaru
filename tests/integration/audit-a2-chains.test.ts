import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { adminSql } from "@/db/admin";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  accounts,
  branches,
  cashSessions,
  companySettings,
  employees,
  fiscalPeriods,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  sales,
  stockMovements,
  stockOnHand,
  stockReceipts,
  suppliers,
  user,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type Decimal } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  ensureFiscalPeriods,
  postJournal,
  reverseSourceJournal,
} from "@/server/accounting";
import { applyStockMovement, createReceipt, createTransfer, receiveTransfer } from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { payPayableDocument } from "@/server/payables";
import { createSupplierReturn, postSupplierReturn } from "@/server/supplier-returns";
import {
  closeCashSession,
  createSale,
  createSaleReturn,
  openCashSession,
  quoteCart,
} from "@/server/pos";
import { voidSale } from "@/server/pos";
import { processOfflineSaleItem } from "@/server/pos-offline";
import {
  listProductPackagings,
  syncProductPackagings,
} from "@/server/catalog/packaging";
import {
  getBalanceSheet,
  getIncomeStatement,
  getTrialBalance,
  listPayables,
} from "@/server/reports";
import { runPayrollAction } from "@/server/actions/hr/payroll";
import { GET as payrollExportGET } from "@/app/api/export/payroll/route";
import { NextRequest } from "next/server";
import type { OfflineSalePayload } from "@/lib/pos/pos-offline";

// =====================================================================
// Program Audit Produksi — Tahap A2: rantai integrasi antarmodul
// ujung-ke-ujung dengan ASERSI ANGKA (jurnal per akun, stok, saldo
// laporan) di perusahaan fixture buangan khusus berkas ini (a201).
// Fixture ter-commit sekali (idempoten); setiap skenario berjalan
// dalam transaksi withCompany sungguhan; seluruh baris perusahaan
// fixture dihapus di afterAll (pola pos-offline-tahap2) sehingga DB
// dev tidak menampung residu baru. Demo tidak pernah ditulis.
// =====================================================================

const ALL_PERMS = [
  "pos.sell", "pos.session", "pos.void", "pos.return",
  "payroll.manage", "payroll.salary", "payroll.view",
  "accounting.view", "accounting.manage", "inventory.view",
];
const sessionState = vi.hoisted(() => ({
  permissions: [
    "pos.sell", "pos.session", "pos.void", "pos.return",
    "payroll.manage", "payroll.salary", "payroll.view",
    "accounting.view", "accounting.manage", "inventory.view",
  ] as string[],
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const build = (permission?: string) => async () => {
    if (permission && !sessionState.permissions.includes(permission)) {
      throw new AppError("FORBIDDEN", `Izin ${permission} diperlukan untuk tindakan ini.`);
    }
    return {
      company: { id: "01900000-0000-7000-8000-00000000a201", name: "Uji A2" },
      user: { id: "kasir-a2", name: "Kasir A2" },
      permissions: sessionState.permissions,
      role: "manager",
    };
  };
  return {
    requirePermission: (permission: string) => build(permission)(),
    requirePermissionInModule: (permission: string) => build(permission)(),
    requireAuth: () => build()(),
    requirePermissionPage: (permission: string) => build(permission)(),
    requireUser: () => build()(),
  };
});

const ORG = "01900000-0000-7000-8000-00000000a201";
const USER = "kasir-a2";
const CLOSER = "kasir-a2-tutup";
const TODAY = todayISO();
const WIDE = { from: "2000-01-01", to: "2100-12-31" };

type Tx = Parameters<Parameters<typeof withCompany>[1]>[0];

const acc: Record<string, string> = {};
let whMain = "";
let whSecond = "";
let methodCash = "";
let methodBank = "";
let methodQris = "";
let mainSessionId = "";

async function accountId(tx: Tx, code: string) {
  const [row] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  expect(row, `akun ${code}`).toBeDefined();
  return row.id;
}

async function bootstrap() {
  await withCompany(ORG, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (existing) return;

    await tx.insert(user).values([
      { id: USER, name: "Kasir A2", email: "kasir.a2@uji.local" },
      { id: CLOSER, name: "Kasir Tutup A2", email: "kasir.tutup.a2@uji.local" },
    ]);
    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji Audit A2",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: false,
    });
    await tx.insert(branches).values({
      companyId: ORG,
      code: "A2",
      name: "Cabang A2",
      isDefault: true,
    });

    const seeds: Array<[string, string, string, "debit" | "credit"]> = [
      ["110107", "Kas", "asset", "debit"],
      ["110101", "Bank", "asset", "debit"],
      ["11003", "QRIS Clearing", "asset", "debit"],
      ["12001", "Piutang Usaha", "asset", "debit"],
      ["13001", "Persediaan", "asset", "debit"],
      ["210101", "Utang Usaha", "liability", "credit"],
      ["21002", "Utang Gaji", "liability", "credit"],
      ["22001", "PPN Keluaran", "liability", "credit"],
      ["23001", "Kredit Pihak", "liability", "credit"],
      ["300001", "Modal Pemilik", "equity", "credit"],
      ["400001", "Penjualan", "revenue", "credit"],
      ["440101", "Diskon Penjualan", "revenue", "debit"],
      ["400003", "Retur Penjualan", "revenue", "debit"],
      ["5101", "HPP", "cogs", "debit"],
      ["51002", "Selisih Persediaan", "cogs", "debit"],
      ["51003", "Barang Rusak", "cogs", "debit"],
      ["600004", "Beban Gaji", "expense", "debit"],
      ["720015", "Selisih Kas Kurang", "expense", "debit"],
      ["81002", "Selisih Kas Lebih", "revenue", "credit"],
      ["91001", "Pembulatan Laba", "revenue", "credit"],
      ["91002", "Pembulatan Rugi", "expense", "debit"],
    ];
    const cashKind: Record<string, string> = { "110107": "cash", "110101": "bank", "11003": "clearing" };
    const rows = await tx
      .insert(accounts)
      .values(seeds.map(([code, name, type, normalBalance]) => ({
        companyId: ORG, code, name, type, normalBalance,
        cashBankKind: cashKind[code] ?? null,
      })))
      .returning();
    const byCode = new Map(rows.map((row) => [row.code, row.id]));
    const mapping: Record<string, string> = {
      cash: "110107", bank: "110101", qris: "11003", receivable: "12001",
      inventory: "13001", payable: "210101", revenue: "400001",
      sales_discount: "440101", sales_return: "400003", cogs: "5101",
      inventory_shrink: "51002", damaged: "51003", tax_output: "22001",
      tax_input: "22001", rounding_gain: "91001", rounding_loss: "91002",
      cash_short: "720015", cash_over: "81002", salary_expense: "600004",
      salary_payable: "21002", salary_deductions_payable: "21002",
      pph21_payable: "21002", bpjs_payable: "21002",
      equity: "300001", customer_credit: "23001", supplier_credit: "23001",
    };
    const { accountMappings } = await import("@/db/schema");
    await tx.insert(accountMappings).values(
      Object.entries(mapping).map(([key, code]) => ({ companyId: ORG, key, accountId: byCode.get(code)! })),
    );

    const [w1] = await tx.insert(warehouses).values({
      companyId: ORG, code: "GD-A2", name: "Gudang Utama A2", type: "warehouse", isDefault: true,
    }).returning();
    await tx.insert(warehouses).values({
      companyId: ORG, code: "GD-A2B", name: "Gudang Kedua A2", type: "warehouse", isDefault: false,
    });
    void w1;

    await tx.insert(paymentMethods).values([
      { companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: byCode.get("110107")!, sortOrder: 1 },
      { companyId: ORG, code: "BANK", name: "Transfer Bank", type: "bank", accountId: byCode.get("110101")!, sortOrder: 2 },
      { companyId: ORG, code: "QRIS", name: "QRIS", type: "qris", accountId: byCode.get("11003")!, sortOrder: 3 },
      { companyId: ORG, code: "UTANG", name: "Utang", type: "credit", accountId: byCode.get("12001")!, sortOrder: 4 },
    ]);

    await ensureFiscalPeriods(tx, ORG, Number(TODAY.slice(0, 4)));
  });

  // Resolusi id yang dipakai lintas skenario + sesi kas utama terbuka.
  await withCompany(ORG, async (tx) => {
    for (const code of ["110107", "110101", "11003", "12001", "13001", "210101", "21002", "22001", "23001", "400001", "440101", "400003", "5101", "600004", "720015"]) {
      acc[code] = await accountId(tx, code);
    }
    const [w] = await tx.select().from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.isDefault, true))).limit(1);
    whMain = w.id;
    const [w2] = await tx.select().from(warehouses)
      .where(and(eq(warehouses.companyId, ORG), eq(warehouses.code, "GD-A2B"))).limit(1);
    whSecond = w2.id;
    const methods = await tx.select().from(paymentMethods).where(eq(paymentMethods.companyId, ORG));
    methodCash = methods.find((m) => m.type === "cash")!.id;
    methodBank = methods.find((m) => m.type === "bank")!.id;
    methodQris = methods.find((m) => m.type === "qris")!.id;

    const [open] = await tx.select().from(cashSessions)
      .where(and(eq(cashSessions.companyId, ORG), eq(cashSessions.userId, USER), eq(cashSessions.status, "open")))
      .limit(1);
    if (open) {
      mainSessionId = open.id;
    } else {
      const session = await openCashSession(tx, { companyId: ORG, userId: USER, openingCash: 500000 });
      mainSessionId = session.id;
    }
  });
}

async function wipeFixture() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    const tables = await tx.unsafe<{ tablename: string }[]>(
      `SELECT c.table_name AS tablename FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.column_name = 'company_id'`,
    );
    for (const { tablename } of tables) {
      await tx.unsafe(`DELETE FROM "${tablename}" WHERE company_id = $1`, [ORG]);
    }
    await tx.unsafe(`DELETE FROM "user" WHERE id = ANY($1)`, [[USER, CLOSER]]);
  });
}

beforeAll(bootstrap);
afterAll(wipeFixture);

// ---------- pembantu asersi ----------

let skuCounter = 0;

async function makeProduct(
  tx: Tx,
  input: { salePrice: string; costPrice: string; qty?: number; warehouseId?: string },
) {
  skuCounter += 1;
  const [product] = await tx.insert(products).values({
    companyId: ORG,
    sku: `A2-${String(skuCounter).padStart(3, "0")}-${Date.now()}`,
    name: `Produk Uji A2 ${skuCounter}`,
    costPrice: input.costPrice,
    salePrice: input.salePrice,
    minStock: "0",
    trackStock: true,
    trackBatch: false,
    isActive: true,
  }).returning();
  if (input.qty) {
    await applyStockMovement(tx, {
      companyId: ORG,
      warehouseId: input.warehouseId ?? whMain,
      productId: product.id,
      delta: String(input.qty),
      unitCost: input.costPrice,
      movementType: "opening",
      userId: USER,
    });
  }
  return product;
}

async function makeSupplier(tx: Tx) {
  skuCounter += 1;
  const [supplier] = await tx.insert(suppliers).values({
    companyId: ORG,
    code: `SUP-A2-${skuCounter}-${Date.now()}`,
    name: `Pemasok Uji A2 ${skuCounter}`,
  }).returning();
  return supplier;
}

async function stockQty(tx: Tx, warehouseId: string, productId: string) {
  const [row] = await tx.select({ qty: stockOnHand.qty }).from(stockOnHand)
    .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.warehouseId, warehouseId), eq(stockOnHand.productId, productId)));
  return d(row?.qty ?? "0");
}

/** Seluruh baris jurnal posted untuk dokumen sumber tertentu. */
async function journalLinesFor(tx: Tx, sourceId: string, sourceType?: string) {
  const entries = await tx.select({ id: journalEntries.id, sourceType: journalEntries.sourceType })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.companyId, ORG),
      eq(journalEntries.sourceId, sourceId),
      eq(journalEntries.status, "posted"),
      ...(sourceType ? [eq(journalEntries.sourceType, sourceType)] : []),
    ));
  const lines: (typeof journalLines.$inferSelect)[] = [];
  for (const entry of entries) {
    lines.push(...(await tx.select().from(journalLines).where(eq(journalLines.entryId, entry.id))));
  }
  return { entries, lines };
}

function totalsFor(lines: (typeof journalLines.$inferSelect)[], accountId: string) {
  let debit: Decimal = d(0);
  let credit: Decimal = d(0);
  for (const line of lines) {
    if (line.accountId !== accountId) continue;
    debit = debit.plus(d(line.debit));
    credit = credit.plus(d(line.credit));
  }
  return { debit, credit };
}

function expectBalanced(lines: (typeof journalLines.$inferSelect)[]) {
  const debit = lines.reduce((sum, line) => sum.plus(d(line.debit)), d(0));
  const credit = lines.reduce((sum, line) => sum.plus(d(line.credit)), d(0));
  expect(debit.toFixed(4)).toBe(credit.toFixed(4));
}

/** Saldo GL (debit − kredit) satu akun dari seluruh jurnal posted. */
async function glBalance(tx: Tx, accountId: string) {
  const [row] = await tx.select({
    value: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)`,
  }).from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(and(eq(journalEntries.companyId, ORG), eq(journalEntries.status, "posted"), eq(journalLines.accountId, accountId)));
  return d(row?.value ?? "0");
}

async function trialClosing(tx: Tx, code: string) {
  const trial = await getTrialBalance(tx, ORG, WIDE);
  return trial.find((row) => row.code === code)?.closing ?? 0;
}

// =====================================================================
// (a) BELI: PO berkemasan → terima → stok/nilai naik → utang →
//     bayar sebagian → bayar lunas → kas turun → laporan konsisten
// =====================================================================
describe("A2-(a) rantai pembelian ujung-ke-ujung", () => {
  it("PO 2 Dus → terima → utang 290.000 → bayar 100.000 + 190.000 → neraca saldo konsisten", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "3800", costPrice: "0" });
      await syncProductPackagings(tx, ORG, product.id, [{
        name: "Dus", isi: "40", buyPrice: "145000", salePrice: "152000",
        barcode: null, isDefaultPurchase: true, isDefaultSale: true, isActive: true,
      }], { priceGateSatisfied: true });
      const [dus] = await listProductPackagings(tx, ORG, product.id);

      const cashBefore = await trialClosing(tx, "110107");
      const payableBefore = await trialClosing(tx, "210101");
      const inventoryBefore = await trialClosing(tx, "13001");

      const order = await createPurchaseOrder(tx, {
        companyId: ORG, userId: USER, supplierId: supplier.id, date: TODAY,
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });
      await sendPurchaseOrder(tx, { companyId: ORG, userId: USER, orderId: order.id });
      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: USER, warehouseId: whMain, supplierId: supplier.id,
        source: "purchase", purchaseOrderId: order.id, date: TODAY,
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });

      const qtyAfterReceipt = await stockQty(tx, whMain, product.id);
      const [productRow] = await tx.select({ costPrice: products.costPrice }).from(products)
        .where(eq(products.id, product.id));
      const receiptJournal = await journalLinesFor(tx, receipt.id);
      const invTotals = totalsFor(receiptJournal.lines, acc["13001"]);
      const payTotals = totalsFor(receiptJournal.lines, acc["210101"]);

      const payablesAfterReceipt = await listPayables(tx, ORG);
      const payableRow = payablesAfterReceipt.find((row) => row.id === receipt.id);
      const remainingAfterReceipt = payableRow ? d(payableRow.total).minus(d(payableRow.paidAmount)) : null;

      // Bayar sebagian lalu lunas dari akun kas.
      await payPayableDocument(tx, {
        companyId: ORG, userId: USER, receiptId: receipt.id, date: TODAY,
        amount: 100000, accountId: acc["110107"],
      });
      const payablesPartial = await listPayables(tx, ORG);
      const partialRow = payablesPartial.find((row) => row.id === receipt.id);
      const remainingPartial = partialRow ? d(partialRow.total).minus(d(partialRow.paidAmount)) : null;
      const [receiptPartial] = await tx.select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts).where(eq(stockReceipts.id, receipt.id));

      await payPayableDocument(tx, {
        companyId: ORG, userId: USER, receiptId: receipt.id, date: TODAY,
        amount: 190000, accountId: acc["110107"],
      });
      const [receiptPaid] = await tx.select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts).where(eq(stockReceipts.id, receipt.id));
      const payablesFinal = await listPayables(tx, ORG);

      return {
        qtyAfterReceipt, avco: productRow.costPrice, receiptJournal, invTotals, payTotals,
        remainingAfterReceipt, remainingPartial,
        partialStatus: receiptPartial.paymentStatus, paidStatus: receiptPaid.paymentStatus,
        stillListed: payablesFinal.some((row) => row.id === receipt.id),
        cashDelta: (await trialClosing(tx, "110107")) - cashBefore,
        payableDelta: (await trialClosing(tx, "210101")) - payableBefore,
        inventoryDelta: (await trialClosing(tx, "13001")) - inventoryBefore,
      };
    });

    expect(outcome.qtyAfterReceipt.toNumber()).toBe(80);
    expect(outcome.avco).toBe("3625.0000");
    expectBalanced(outcome.receiptJournal.lines);
    expect(outcome.invTotals.debit.toNumber()).toBe(290000);
    expect(outcome.payTotals.credit.toNumber()).toBe(290000);
    expect(outcome.remainingAfterReceipt?.toNumber()).toBe(290000);
    expect(outcome.remainingPartial?.toNumber()).toBe(190000);
    expect(outcome.partialStatus).toBe("partial");
    expect(outcome.paidStatus).toBe("paid");
    expect(outcome.stillListed).toBe(false);
    // Laporan: kas −290.000, utang neto 0, persediaan +290.000.
    expect(outcome.cashDelta).toBe(-290000);
    expect(outcome.payableDelta).toBe(0);
    expect(outcome.inventoryDelta).toBe(290000);
  });
});

// =====================================================================
// (a2) KELEBIHAN BAYAR utang — perilaku desain A-21 R3-02 yang
//      diverifikasi A2: kelebihan TIDAK ditolak; porsi teralokasi
//      melunasi dokumen dan sisanya menjadi kredit pemasok tercatat.
// =====================================================================
describe("A2-(a2) kelebihan bayar utang menjadi kredit pemasok", () => {
  it("utang 50.000 dibayar 80.000: dokumen lunas, kredit pemasok 30.000 lahir, kas −80.000", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "9000", costPrice: "5000" });
      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: USER, warehouseId: whMain, supplierId: supplier.id,
        source: "purchase", date: TODAY,
        lines: [{ productId: product.id, qty: "10", unitCost: "5000" }],
      });
      const cashBefore = await glBalance(tx, acc["110107"]);
      const creditBefore = await glBalance(tx, acc["23001"]);
      await payPayableDocument(tx, {
        companyId: ORG, userId: USER, receiptId: receipt.id, date: TODAY,
        amount: 80000, accountId: acc["110107"],
      });
      const [receiptRow] = await tx.select({ paymentStatus: stockReceipts.paymentStatus })
        .from(stockReceipts).where(eq(stockReceipts.id, receipt.id));
      const { partyCredits } = await import("@/db/schema");
      const credits = await tx.select().from(partyCredits)
        .where(and(eq(partyCredits.companyId, ORG), eq(partyCredits.partyId, supplier.id)));
      return {
        status: receiptRow.paymentStatus,
        cashDelta: (await glBalance(tx, acc["110107"])).minus(cashBefore),
        creditDelta: (await glBalance(tx, acc["23001"])).minus(creditBefore),
        credits: credits.map((row) => ({
          amount: d(row.amount).toNumber(),
          remaining: d(row.amount).minus(d(row.usedAmount)).toNumber(),
          status: row.status,
        })),
      };
    });

    expect(outcome.status).toBe("paid");
    expect(outcome.cashDelta.toNumber()).toBe(-80000);
    // Akun kredit pemasok (aset) terdebit sebesar kelebihan.
    expect(outcome.creditDelta.toNumber()).toBe(30000);
    expect(outcome.credits).toHaveLength(1);
    expect(outcome.credits[0].amount).toBe(30000);
    expect(outcome.credits[0].remaining).toBe(30000);
    expect(outcome.credits[0].status).toBe("open");
  });
});

// =====================================================================
// (b) JUAL: POS tunai + QRIS, diskon baris, PPN aktif → jurnal per
//     akun benar, stok turun, laba rugi & persediaan terbarui,
//     cetak ulang struk = SALINAN
// =====================================================================
describe("A2-(b) rantai penjualan POS campuran", () => {
  it("2 pcs diskon 10% + PPN 11%: jurnal seimbang per akun, stok −2, LR konsisten, struk salinan bertanda", async () => {
    let saleId = "";
    const outcome = await withCompany(ORG, async (tx) => {
      await tx.update(companySettings).set({ taxEnabled: true })
        .where(eq(companySettings.companyId, ORG));
      try {
        const product = await makeProduct(tx, { salePrice: "10000", costPrice: "6000", qty: 20 });
        const lines = [{ productId: product.id, qty: 2, discountType: "percent" as const, discountValue: 10 }];
        const quote = await quoteCart(tx, { companyId: ORG, warehouseId: whMain, lines });
        const cashPart = 10000;
        const sale = await createSale(tx, {
          companyId: ORG, userId: USER, warehouseId: whMain, date: TODAY, dueDate: TODAY,
          lines,
          payments: [
            { methodId: methodCash, amount: cashPart, tendered: cashPart },
            { methodId: methodQris, amount: quote.total - cashPart, tendered: quote.total - cashPart },
          ],
          idempotencyKey: crypto.randomUUID(),
        });
        saleId = sale.id;

        const journal = await journalLinesFor(tx, sale.id, "sale");
        const incomeBefore = await getIncomeStatement(tx, ORG, WIDE);
        return {
          quote, sale, journal,
          stock: await stockQty(tx, whMain, product.id),
          incomeBefore,
          gl: {
            revenue: totalsFor(journal.lines, acc["400001"]),
            discount: totalsFor(journal.lines, acc["440101"]),
            tax: totalsFor(journal.lines, acc["22001"]),
            cash: totalsFor(journal.lines, acc["110107"]),
            qris: totalsFor(journal.lines, acc["11003"]),
            cogs: totalsFor(journal.lines, acc["5101"]),
            inventory: totalsFor(journal.lines, acc["13001"]),
          },
        };
      } finally {
        await tx.update(companySettings).set({ taxEnabled: false })
          .where(eq(companySettings.companyId, ORG));
      }
    });

    const q = outcome.quote;
    expect(q.subtotal).toBe(20000);
    expect(q.discountTotal).toBe(2000);
    expect(q.taxTotal).toBeGreaterThan(0);
    expect(outcome.stock.toNumber()).toBe(18);
    expectBalanced(outcome.journal.lines);
    // Harga jual TERMASUK PPN (konvensi sistem): pendapatan dikredit
    // bruto-sebelum-diskon SESUDAH pajak diekstrak dari bruto
    // (revenueGross = subtotal − taxTotal di sales-persist.ts);
    // diskon tetap contra terpisah di debit; PPN kredit.
    expect(outcome.gl.revenue.credit.toNumber()).toBeCloseTo(q.subtotal - q.taxTotal, 2);
    expect(outcome.gl.discount.debit.toNumber()).toBe(2000);
    expect(outcome.gl.tax.credit.toNumber()).toBeCloseTo(q.taxTotal, 2);
    // Kas + QRIS = total tertagih.
    expect(outcome.gl.cash.debit.toNumber() + outcome.gl.qris.debit.toNumber())
      .toBeCloseTo(q.total, 2);
    // HPP 2 × 6.000 keluar dari persediaan.
    expect(outcome.gl.cogs.debit.toNumber()).toBe(12000);
    expect(outcome.gl.inventory.credit.toNumber()).toBe(12000);

    // Konsistensi laporan: jalankan ulang LR di transaksi baru —
    // pendapatan neto naik sebesar bruto − diskon dari penjualan ini
    // (dibandingkan snapshot SEBELUM penjualan diambil di rantai lain?
    // di sini: LR memuat akun diskon sebagai pengurang pendapatan).
    const income = await withCompanyReadOnly(ORG, (tx) => getIncomeStatement(tx, ORG, WIDE));
    // Pendapatan neto LR dari penjualan ini = 18.000/1,11 ≈ 16.216.
    expect(income.totalRevenue).toBeGreaterThanOrEqual(16000);
    expect(income.totalCogs).toBeGreaterThanOrEqual(12000);

    // Cetak ulang struk bertanda SALINAN; cetakan asli tidak.
    const { default: ReceiptPage } = await import("@/app/app/pos/nota/[id]/page");
    const copyHtml = renderToStaticMarkup(
      (await ReceiptPage({
        params: Promise.resolve({ id: saleId }),
        searchParams: Promise.resolve({ salinan: "1" }),
      })) as ReactElement,
    );
    expect(copyHtml).toContain("Salinan — bukan nota asli");
    const originalHtml = renderToStaticMarkup(
      (await ReceiptPage({
        params: Promise.resolve({ id: saleId }),
        searchParams: Promise.resolve({}),
      })) as ReactElement,
    );
    expect(originalHtml).not.toContain("Salinan — bukan nota asli");
  });
});

// =====================================================================
// (c) RETUR JUAL SEBAGIAN atas baris berkemasan (cuplikan S4)
// =====================================================================
describe("A2-(c) retur penjualan sebagian berkemasan", () => {
  it("jual 2 Dus → retur 1 Dus: stok kembali 40, pendapatan & HPP terkoreksi sebesar baris asal", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const product = await makeProduct(tx, { salePrice: "3800", costPrice: "3000", qty: 100 });
      await syncProductPackagings(tx, ORG, product.id, [{
        name: "Dus", isi: "40", buyPrice: "120000", salePrice: "145000",
        barcode: null, isDefaultPurchase: false, isDefaultSale: true, isActive: true,
      }], { priceGateSatisfied: true });
      const [dus] = await listProductPackagings(tx, ORG, product.id);

      const lines = [{ productId: product.id, qty: 2, packagingId: dus.id }];
      const quote = await quoteCart(tx, { companyId: ORG, warehouseId: whMain, lines });
      const sale = await createSale(tx, {
        companyId: ORG, userId: USER, warehouseId: whMain, date: TODAY, dueDate: TODAY,
        lines,
        payments: [{ methodId: methodCash, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      const stockAfterSale = await stockQty(tx, whMain, product.id);
      const [originLine] = await tx.select().from(sales)
        .where(eq(sales.id, sale.id));
      void originLine;
      const { saleLines } = await import("@/db/schema");
      const [lineRow] = await tx.select().from(saleLines)
        .where(eq(saleLines.saleId, sale.id));

      const ret = await createSaleReturn(tx, {
        companyId: ORG, userId: USER, saleId: sale.id, date: TODAY,
        reason: "Uji A2 retur sebagian berkemasan",
        refundMethod: "transfer", type: "return",
        lines: [{ saleLineId: lineRow.id, productId: product.id, qty: 1 }],
      });
      const journal = await journalLinesFor(tx, ret.id);
      return {
        quote, stockAfterSale,
        stockAfterReturn: await stockQty(tx, whMain, product.id),
        returnTotal: ret.total, journal,
        gl: {
          salesReturn: totalsFor(journal.lines, acc["400003"]),
          bank: totalsFor(journal.lines, acc["110101"]),
          inventory: totalsFor(journal.lines, acc["13001"]),
          cogs: totalsFor(journal.lines, acc["5101"]),
        },
      };
    });

    expect(outcome.quote.total).toBe(290000);
    expect(outcome.stockAfterSale.toNumber()).toBe(20);
    expect(outcome.stockAfterReturn.toNumber()).toBe(60);
    expect(outcome.returnTotal).toBeCloseTo(145000, 2);
    expectBalanced(outcome.journal.lines);
    expect(outcome.gl.salesReturn.debit.toNumber()).toBe(145000);
    expect(outcome.gl.bank.credit.toNumber()).toBe(145000);
    // HPP dibalik sebesar 40 pcs × AVCO 3.000.
    expect(outcome.gl.inventory.debit.toNumber()).toBe(120000);
    expect(outcome.gl.cogs.credit.toNumber()).toBe(120000);
  });
});

// =====================================================================
// (d) RETUR BELI: stok & nilai turun, utang terkoreksi
// =====================================================================
describe("A2-(d) retur pembelian", () => {
  it("terima 80 pcs (utang 290.000) → retur 1 Dus: stok 40, persediaan −145.000, utang terkoreksi", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const supplier = await makeSupplier(tx);
      const product = await makeProduct(tx, { salePrice: "3800", costPrice: "0" });
      await syncProductPackagings(tx, ORG, product.id, [{
        name: "Dus", isi: "40", buyPrice: "145000", salePrice: null,
        barcode: null, isDefaultPurchase: true, isDefaultSale: false, isActive: true,
      }], { priceGateSatisfied: true });
      const [dus] = await listProductPackagings(tx, ORG, product.id);

      const receipt = await createReceipt(tx, {
        companyId: ORG, userId: USER, warehouseId: whMain, supplierId: supplier.id,
        source: "purchase", date: TODAY,
        lines: [{ productId: product.id, qty: "2", unitCost: "145000", packagingId: dus.id }],
      });
      const invBefore = await glBalance(tx, acc["13001"]);
      const payBefore = await glBalance(tx, acc["210101"]);
      const { stockReceiptLines } = await import("@/db/schema");
      const [originLine] = await tx.select().from(stockReceiptLines)
        .where(eq(stockReceiptLines.receiptId, receipt.id));

      const created = await createSupplierReturn(tx, {
        companyId: ORG, userId: USER, supplierId: supplier.id, warehouseId: whMain,
        date: TODAY, reasonCategory: "damaged",
        reasonDetail: "Uji A2: satu dus rusak.",
        resolutionType: "refund",
        lines: [{ productId: product.id, qty: "1", packagingId: dus.id, receiptLineId: originLine.id }],
      });
      await postSupplierReturn(tx, { companyId: ORG, userId: USER, returnId: created.id });

      return {
        stock: await stockQty(tx, whMain, product.id),
        invDelta: (await glBalance(tx, acc["13001"])).minus(invBefore),
        payDelta: (await glBalance(tx, acc["210101"])).minus(payBefore),
      };
    });

    expect(outcome.stock.toNumber()).toBe(40);
    expect(outcome.invDelta.toNumber()).toBe(-145000);
    // Utang berkurang 145.000: saldo (debit − kredit) NAIK sebesar itu.
    expect(outcome.payDelta.toNumber()).toBe(145000);
  });
});

// =====================================================================
// (e) TRANSFER ANTAR GUDANG: total global tetap, histori tercatat
// =====================================================================
describe("A2-(e) transfer antar gudang", () => {
  it("transfer 20 dari 50: asal 30, tujuan 20, total global 50, gerakan tercatat dua sisi", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      // Jalur dua tahap (saklar perusahaan): kirim → in_transit →
      // terima. Saklar dipulihkan di akhir transaksi uji ini.
      await tx.update(companySettings).set({ transferTwoStepEnabled: true })
        .where(eq(companySettings.companyId, ORG));
      try {
        const product = await makeProduct(tx, { salePrice: "5000", costPrice: "2000", qty: 50 });
        const transfer = await createTransfer(tx, {
          companyId: ORG, userId: USER,
          fromWarehouseId: whMain, toWarehouseId: whSecond, date: TODAY,
          idempotencyKey: crypto.randomUUID(),
          lines: [{ productId: product.id, qty: 20 }],
        });
        const midFrom = await stockQty(tx, whMain, product.id);
        const midTo = await stockQty(tx, whSecond, product.id);
        const { stockDocuments } = await import("@/db/schema");
        const [midDoc] = await tx.select({ status: stockDocuments.status }).from(stockDocuments)
          .where(eq(stockDocuments.id, transfer.id));
        await receiveTransfer(tx, {
          companyId: ORG, userId: USER, documentId: transfer.id, date: TODAY,
        });
        const movements = await tx.select().from(stockMovements)
          .where(and(eq(stockMovements.companyId, ORG), eq(stockMovements.productId, product.id)));
        return {
          midFrom, midTo,
          finalFrom: await stockQty(tx, whMain, product.id),
          finalTo: await stockQty(tx, whSecond, product.id),
          movementCount: movements.length,
          status: midDoc.status,
        };
      } finally {
        await tx.update(companySettings).set({ transferTwoStepEnabled: false })
          .where(eq(companySettings.companyId, ORG));
      }
    });

    expect(outcome.status).toBe("in_transit");
    // Leg keluar langsung mengurangi asal; tujuan belum bertambah.
    expect(outcome.midFrom.toNumber()).toBe(30);
    expect(outcome.midTo.toNumber()).toBe(0);
    expect(outcome.finalFrom.toNumber()).toBe(30);
    expect(outcome.finalTo.toNumber()).toBe(20);
    expect(outcome.finalFrom.plus(outcome.finalTo).toNumber()).toBe(50);
    expect(outcome.movementCount).toBeGreaterThanOrEqual(2);
  });
});

// =====================================================================
// (f) VOID penjualan + uji negatif dokumen final
// =====================================================================
describe("A2-(f) pembatalan penjualan", () => {
  it("void: stok & jurnal kembali neto nol, histori tidak terhapus; void/retur kedua ditolak", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const product = await makeProduct(tx, { salePrice: "8000", costPrice: "5000", qty: 10 });
      const lines = [{ productId: product.id, qty: 3 }];
      const quote = await quoteCart(tx, { companyId: ORG, warehouseId: whMain, lines });
      const sale = await createSale(tx, {
        companyId: ORG, userId: USER, warehouseId: whMain, date: TODAY, dueDate: TODAY,
        lines,
        payments: [{ methodId: methodCash, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
      const stockAfterSale = await stockQty(tx, whMain, product.id);
      const cashBefore = await glBalance(tx, acc["110107"]);
      const revenueBefore = await glBalance(tx, acc["400001"]);

      await voidSale(tx, { companyId: ORG, userId: USER, saleId: sale.id, reason: "Uji A2 void" });
      const [saleRow] = await tx.select({ status: sales.status }).from(sales)
        .where(eq(sales.id, sale.id));
      const allJournals = await journalLinesFor(tx, sale.id);

      let secondVoidError: unknown;
      try {
        await voidSale(tx, { companyId: ORG, userId: USER, saleId: sale.id, reason: "Uji A2 void kedua" });
      } catch (error) { secondVoidError = error; }
      let returnOnVoidError: unknown;
      try {
        await createSaleReturn(tx, {
          companyId: ORG, userId: USER, saleId: sale.id, date: TODAY,
          reason: "Uji A2 retur atas void", refundMethod: "cash", type: "return",
          lines: [{ productId: product.id, qty: 1 }],
        });
      } catch (error) { returnOnVoidError = error; }

      return {
        stockAfterSale,
        stockAfterVoid: await stockQty(tx, whMain, product.id),
        status: saleRow.status,
        journalCount: allJournals.entries.length,
        journalLines: allJournals.lines,
        cashDelta: (await glBalance(tx, acc["110107"])).minus(cashBefore),
        revenueDelta: (await glBalance(tx, acc["400001"])).minus(revenueBefore),
        secondVoidError, returnOnVoidError,
      };
    });

    expect(outcome.stockAfterSale.toNumber()).toBe(7);
    expect(outcome.stockAfterVoid.toNumber()).toBe(10);
    expect(outcome.status).toBe("void");
    // Jurnal asal TETAP ada + jurnal pembalik lahir: histori utuh.
    expect(outcome.journalCount).toBeGreaterThanOrEqual(2);
    expectBalanced(outcome.journalLines);
    // Neto kas & pendapatan dari penjualan ini kembali nol.
    expect(outcome.cashDelta.toNumber()).toBe(-24000);
    expect(outcome.revenueDelta.toNumber()).toBe(24000);
    expect(outcome.secondVoidError).toBeTruthy();
    expect(outcome.returnOnVoidError).toBeTruthy();
  });
});

// =====================================================================
// (g) OFFLINE: sinkron tepat sekali (web + bergaya desktop
//     berkemasan) & kegagalan sinkron tanpa transaksi setengah
// =====================================================================
describe("A2-(g) sinkronisasi offline tepat sekali", () => {
  it("muatan sama dikirim dua kali → satu penjualan (duplicate); stok kurang → tertahan tanpa penjualan", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const product = await makeProduct(tx, { salePrice: "5000", costPrice: "3000", qty: 10 });
      const payload: OfflineSalePayload = {
        clientKey: `a2-offline-${Date.now()}`,
        warehouseId: whMain,
        cashierId: USER,
        originSessionId: mainSessionId,
        date: TODAY,
        lines: [{ productId: product.id, qty: 2, unitPrice: 5000 }],
        payments: [{ methodId: methodCash, amount: 10000, tendered: 10000 }],
        expectedTotal: 10000,
        queuedAt: new Date().toISOString(),
      };
      const first = await processOfflineSaleItem(tx, {
        companyId: ORG, userId: USER, item: payload,
        originEntitlements: { [USER]: { canSell: true, canDiscount: true } },
      });
      const stockAfterFirst = await stockQty(tx, whMain, product.id);
      const second = await processOfflineSaleItem(tx, {
        companyId: ORG, userId: USER, item: payload,
        originEntitlements: { [USER]: { canSell: true, canDiscount: true } },
      });
      const salesForKey = await tx.select({ id: sales.id }).from(sales)
        .where(and(eq(sales.companyId, ORG), eq(sales.idempotencyKey, payload.clientKey)));

      // Muatan gagal: stok tidak cukup.
      const failPayload: OfflineSalePayload = {
        ...payload,
        clientKey: `a2-offline-fail-${Date.now()}`,
        lines: [{ productId: product.id, qty: 99, unitPrice: 5000 }],
        payments: [{ methodId: methodCash, amount: 495000, tendered: 495000 }],
        expectedTotal: 495000,
      };
      const failed = await processOfflineSaleItem(tx, {
        companyId: ORG, userId: USER, item: failPayload,
        originEntitlements: { [USER]: { canSell: true, canDiscount: true } },
      });
      const failSales = await tx.select({ id: sales.id }).from(sales)
        .where(and(eq(sales.companyId, ORG), eq(sales.idempotencyKey, failPayload.clientKey)));

      // Muatan bergaya desktop berkemasan (kontrak S5): 1 Dus isi 40.
      const packed = await makeProduct(tx, { salePrice: "3800", costPrice: "3000", qty: 100 });
      await syncProductPackagings(tx, ORG, packed.id, [{
        name: "Dus", isi: "40", buyPrice: "120000", salePrice: "145000",
        barcode: null, isDefaultPurchase: false, isDefaultSale: true, isActive: true,
      }], { priceGateSatisfied: true });
      const [dus] = await listProductPackagings(tx, ORG, packed.id);
      const desktopPayload: OfflineSalePayload = {
        clientKey: `a2-desktop-${Date.now()}`,
        warehouseId: whMain,
        cashierId: USER,
        originSessionId: mainSessionId,
        deviceId: "desktop-uji-a2",
        date: TODAY,
        lines: [{ productId: packed.id, qty: 1, unitPrice: 145000, packagingId: dus.id, isiSnapshot: 40 }],
        payments: [{ methodId: methodCash, amount: 145000, tendered: 145000 }],
        expectedTotal: 145000,
        queuedAt: new Date().toISOString(),
      };
      const desktop = await processOfflineSaleItem(tx, {
        companyId: ORG, userId: USER, item: desktopPayload,
        originEntitlements: { [USER]: { canSell: true, canDiscount: true } },
      });

      return {
        first: first.status, second: second.status,
        stockAfterFirst, salesForKey: salesForKey.length,
        stockFinal: await stockQty(tx, whMain, product.id),
        failedStatus: failed.status, failSales: failSales.length,
        desktopStatus: desktop.status,
        packedStock: await stockQty(tx, whMain, packed.id),
      };
    });

    expect(outcome.first).toBe("synced");
    expect(outcome.second).toBe("duplicate");
    expect(outcome.salesForKey).toBe(1);
    expect(outcome.stockAfterFirst.toNumber()).toBe(8);
    expect(outcome.stockFinal.toNumber()).toBe(8);
    expect(["conflict", "failed"]).toContain(outcome.failedStatus);
    expect(outcome.failSales).toBe(0);
    expect(outcome.desktopStatus).toBe("synced");
    expect(outcome.packedStock.toNumber()).toBe(60);
  });
});

// =====================================================================
// (h) TUTUP SESI BUTA bertoleransi + TUTUP PERIODE & jurnal pembalik
// =====================================================================
describe("A2-(h) tutup sesi buta dan tutup periode", () => {
  it("selisih di luar toleransi tanpa alasan ditolak; dengan alasan tertutup + jurnal selisih", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const session = await openCashSession(tx, { companyId: ORG, userId: CLOSER, openingCash: 100000 });
      let rejection: unknown;
      try {
        await closeCashSession(tx, {
          companyId: ORG, userId: CLOSER, sessionId: session.id, countedCash: 97000,
        });
      } catch (error) { rejection = error; }
      const [afterReject] = await tx.select({ status: cashSessions.status }).from(cashSessions)
        .where(eq(cashSessions.id, session.id));
      const closed = await closeCashSession(tx, {
        companyId: ORG, userId: CLOSER, sessionId: session.id, countedCash: 97000,
        differenceReason: "Uji A2: kembalian kurang",
      });
      const journal = await journalLinesFor(tx, session.id);
      return {
        rejection, afterRejectStatus: afterReject.status,
        difference: closed.difference, journal,
        short: totalsFor(journal.lines, acc["720015"]),
        cash: totalsFor(journal.lines, acc["110107"]),
      };
    });

    expect(outcome.rejection).toMatchObject({ code: "VALIDATION" });
    expect(outcome.afterRejectStatus).toBe("open");
    expect(outcome.difference).toBe(-3000);
    expectBalanced(outcome.journal.lines);
    expect(outcome.short.debit.toNumber()).toBe(3000);
    expect(outcome.cash.credit.toNumber()).toBe(3000);
  });

  it("jurnal di periode tertutup ditolak; koreksi sah lewat jurnal pembalik bertanggal terbuka", async () => {
    const outcome = await withCompany(ORG, async (tx) => {
      const year = Number(TODAY.slice(0, 4));
      await ensureFiscalPeriods(tx, ORG, year);
      // Larian ulang sesudah kegagalan di tengah: pastikan Agustus
      // mulai dari keadaan terbuka sebelum jurnal asal diposting.
      await tx.update(fiscalPeriods).set({ status: "open" })
        .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, 8)));
      const pastDate = `${year}-08-15`;
      const sourceId = crypto.randomUUID();
      const original = await postJournal(tx, {
        companyId: ORG, date: pastDate, description: "Uji A2 jurnal Agustus",
        sourceType: "manual", sourceId, createdBy: USER,
        lines: [
          { accountId: acc["110107"], debit: "75000" },
          { accountId: acc["400001"], credit: "75000" },
        ],
      });
      void original;
      // Tutup periode Agustus.
      await tx.update(fiscalPeriods).set({ status: "closed" })
        .where(and(eq(fiscalPeriods.companyId, ORG), eq(fiscalPeriods.year, year), eq(fiscalPeriods.month, 8)));

      let rejection: unknown;
      try {
        await postJournal(tx, {
          companyId: ORG, date: `${year}-08-20`, description: "Uji A2 posting ke periode tertutup",
          sourceType: "manual", createdBy: USER,
          lines: [
            { accountId: acc["110107"], debit: "1000" },
            { accountId: acc["400001"], credit: "1000" },
          ],
        });
      } catch (error) { rejection = error; }

      // Koreksi: balik jurnal asal dengan tanggal HARI INI (terbuka).
      const cashBefore = await glBalance(tx, acc["110107"]);
      const reversal = await reverseSourceJournal(tx, {
        companyId: ORG, sourceType: "manual", sourceId,
        date: TODAY, description: "Uji A2 koreksi jurnal Agustus", createdBy: USER,
      });
      const reversalJournal = reversal ? await journalLinesFor(tx, sourceId, "manual_reversal") : null;
      return {
        rejection, reversal,
        cashDelta: (await glBalance(tx, acc["110107"])).minus(cashBefore),
        reversalJournal,
      };
    });

    expect(outcome.rejection).toBeTruthy();
    expect(outcome.reversal).not.toBeNull();
    // Pembalik mengkredit kas 75.000 → delta −75.000 dari sebelum balik.
    expect(outcome.cashDelta.toNumber()).toBe(-75000);
    expectBalanced(outcome.reversalJournal!.lines);
  });
});

// =====================================================================
// (i) PAYROLL satu siklus + penyembunyian nominal tanpa payroll.salary
// =====================================================================
describe("A2-(i) payroll dan izin level-field", () => {
  it("run → jurnal gaji seimbang (beban = bruto, utang gaji = bersih); ekspor ditolak tanpa payroll.salary", async () => {
    await withCompany(ORG, async (tx) => {
      await tx.insert(employees).values({
        companyId: ORG, code: `EMP-A2-${Date.now()}`, name: "Karyawan Uji A2",
        baseSalary: "6000000", allowances: "500000", deductions: "250000", isActive: true,
      });
    });
    const period = TODAY.slice(0, 7);
    sessionState.permissions = ["payroll.manage", "payroll.salary", "payroll.view"];
    const result = await runPayrollAction({ period, acknowledgeMinWage: true });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const runId = result.data.id;

    const data = await withCompanyReadOnly(ORG, async (tx) => {
      const journal = await journalLinesFor(tx, runId, "payroll");
      const [run] = await tx.select().from((await import("@/db/schema")).payrollRuns)
        .where(eq((await import("@/db/schema")).payrollRuns.id, runId));
      return { journal, run };
    });
    expectBalanced(data.journal.lines);
    const gross = d(data.run.totalGross).toNumber();
    const net = d(data.run.totalNet).toNumber();
    expect(gross).toBe(6500000);
    const expense = totalsFor(data.journal.lines, acc["600004"]);
    const payable = totalsFor(data.journal.lines, acc["21002"]);
    expect(expense.debit.toNumber()).toBe(gross);
    expect(payable.credit.toNumber()).toBeGreaterThanOrEqual(net);

    // Tanpa payroll.salary → ekspor rekap DITOLAK di gerbang route.
    sessionState.permissions = ["payroll.view"];
    let rejection: unknown;
    try {
      await payrollExportGET(new NextRequest(`http://localhost/api/export/payroll?runId=${runId}`));
    } catch (error) { rejection = error; }
    expect(rejection).toMatchObject({ code: "FORBIDDEN" });

    // Dengan payroll.salary → 200 dan memuat angka bersih karyawan.
    sessionState.permissions = ["payroll.salary"];
    const response = await payrollExportGET(
      new NextRequest(`http://localhost/api/export/payroll?runId=${runId}`),
    );
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Karyawan Uji A2");
    sessionState.permissions = [...ALL_PERMS];
  });
});

// =====================================================================
// (3) KONSISTENSI LAPORAN vs JURNAL SUMBER (sesudah semua rantai)
// =====================================================================
describe("A2-(3) konsistensi laporan terhadap jurnal sumber", () => {
  it("neraca saldo berimbang, persamaan akuntansi neraca berlaku, buku besar = jurnal", async () => {
    const result = await withCompanyReadOnly(ORG, async (tx) => {
      const trial = await getTrialBalance(tx, ORG, WIDE);
      const sheet = await getBalanceSheet(tx, ORG, TODAY);
      const ledgerCash = await glBalance(tx, acc["110107"]);
      const trialCash = trial.find((row) => row.code === "110107");
      const imbalance = trial.reduce(
        (sum, row) => sum + (row.normalBalance === "debit" ? row.closing : -row.closing),
        0,
      );
      return { trial, sheet, ledgerCash, trialCash, imbalance };
    });

    expect(Math.abs(result.imbalance)).toBeLessThan(0.01);
    expect(Math.abs(result.sheet.totalAssets - (result.sheet.totalLiabilities + result.sheet.totalEquity)))
      .toBeLessThan(0.01);
    // Buku besar (lewat neraca saldo) == agregasi jurnal mentah.
    expect(result.trialCash?.closing ?? 0).toBeCloseTo(result.ledgerCash.toNumber(), 2);
  });
});
