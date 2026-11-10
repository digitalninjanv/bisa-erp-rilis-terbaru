import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  journalEntries,
  paymentMethods,
  products,
  stockBatches,
  stockDocumentLines,
  stockDocuments,
  stockMovements,
  stockReservations,
  stockSerials,
  supplierReturnLines,
  suppliers,
  warehouses,
} from "@/db/schema";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  createOpname,
  createReceipt,
  createTransfer,
  getStock,
  receiveTransfer,
} from "@/server/inventory";
import {
  createSupplierReturn,
  postSupplierReturn,
  receiveReplacement,
  voidPostedSupplierReturn,
} from "@/server/supplier-returns";
import { createReservation, getReservedQuantities } from "@/server/reservations";
import { createSale, openCashSession, quoteCart } from "@/server/pos";
import { getControlReconciliation } from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// FIX-GDG Tahap 2 (A-17) — AVCO, seri, reservasi, transfer, periode:
//   GDG1-02 rumus AVCO isi ulang dari stok negatif/nol menutup defisit
//   GDG1-03 void retur pemasok memulihkan nomor seri
//   GDG1-04 receiveReplacement mewajibkan nomor seri produk serial
//   GDG1-05 baris replacement diagregat per returnLineId
//   GDG1-06/GDG3-14 reservasi dinilai di bawah kunci (balapan)
//   GDG1-07 penerimaan transfer sebagian + selisih perjalanan tercatat
//   GDG1-08 domain menolak qty <= 0 (transfer & opname)
//   GDG1-09 kedaluwarsa bawaan reservasi + konsumsi reservasi oleh checkout
//   GDG3-02 kunci periode mencakup dokumen stok tanpa jurnal
//   GDG3-03 rekonsiliasi persediaan as-of dari ledger bertanggal dokumen
// Perusahaan fixture KHUSUS berkas ini; demo tidak disentuh. Id
// perusahaan UNIK PER LARIAN: probe konkurensi berkomit meninggalkan
// dokumen nyata (penerimaan kredit = utang terbuka), dan utang
// peninggalan larian sebelumnya terbukti menyerap klaim retur test
// rollback berikutnya (FIFO) serta menggeser saldo GL absolut —
// perusahaan sekali pakai per larian meniadakan polusi itu. Probe
// berkomit juga memakai pemasok terpisah (SUP2) agar utang terbukanya
// tidak menyerap klaim retur dalam larian yang sama.
// Skenario dalam transaksi rollback; probe konkurensi berkomit dengan
// SKU unik per larian.

const ORG = `01900000-0000-7000-8000-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
const USER = "user-fix-gdg2";
const TODAY = todayISO();
const CLOSED_DATE = "2024-05-10"; // tanpa baris periode & di luar jendela materialisasi = tertutup (FIX-P1)

function minusDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}
function plusDays(iso: string, days: number): string {
  return minusDays(iso, -days);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG);

async function committed<T>(fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
    return fn(tx);
  });
}

async function expectRejects(fn: () => Promise<unknown>, code: string, message?: RegExp) {
  let error: unknown;
  try {
    await fn();
  } catch (caught) {
    error = caught;
  }
  expect(error, "panggilan harus ditolak").toBeDefined();
  expect(error).toMatchObject({ code });
  if (message) expect((error as Error).message).toMatch(message);
}

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4010", "Diskon Penjualan", "revenue", "debit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["6050", "Beban Susut Persediaan", "expense", "debit"],
  ["6060", "Beban Barang Rusak", "expense", "debit"],
  ["9000", "Pembulatan Gain", "revenue", "credit"],
  ["9001", "Pembulatan Loss", "expense", "debit"],
  ["1210", "Kredit Pemasok", "asset", "debit"],
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
  sales_discount: "4010",
  sales_return: "4020",
  cogs: "5000",
  inventory_shrink: "6050",
  damaged: "6060",
  rounding_gain: "9000",
  rounding_loss: "9001",
  supplier_credit: "1210",
};

let WH1 = "";
let WH2 = "";
let SUP1 = "";
let SUP2 = "";
let CASH_ACCOUNT = "";
let CASH_METHOD = "";

async function seedCompany(tx: Tx) {
  await tx.insert(companySettings).values({
    companyId: ORG,
    legalName: "Uji FIX-GDG2",
    roundingMode: "none",
    taxRate: "0",
    taxEnabled: false,
  });
  const accountRows = await tx
    .insert(accounts)
    .values(
      ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
        companyId: ORG,
        code,
        name,
        type,
        normalBalance,
        // A-27 B1/B2: akun terpetakan cash/bank/qris berkelas —
        // kelas diturunkan dari MAPPING_SEEDS, meniru backfill
        // migrasi 0055.
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
      companyId: ORG,
      key,
      accountId: acc.get(code)!,
    })),
  );
  const [wh1] = await tx
    .insert(warehouses)
    .values({ companyId: ORG, name: "Gudang Utama G2", code: "GU-G2", isDefault: true })
    .returning();
  const [wh2] = await tx
    .insert(warehouses)
    .values({ companyId: ORG, name: "Gudang Cabang G2", code: "GC-G2" })
    .returning();
  const [supplier] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: "SUP-G2", name: "PT Pemasok G2" })
    .returning();
  const [supplier2] = await tx
    .insert(suppliers)
    .values({ companyId: ORG, code: "SUP-G2B", name: "PT Pemasok Balapan G2" })
    .returning();
  const [method] = await tx
    .insert(paymentMethods)
    .values({
      companyId: ORG,
      code: "CASH",
      name: "Tunai",
      type: "cash",
      accountId: acc.get("1000")!,
    })
    .returning();
  return { wh1: wh1.id, wh2: wh2.id, supplierId: supplier.id, supplier2Id: supplier2.id, cashAccount: acc.get("1000")!, methodId: method.id };
}

async function ensureFixtures() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG}, true)`);
    // A-27 B2: perusahaan fixture yang lahir sebelum B1 belum punya
    // kelas kas/bank — samakan dengan hasil migrasi 0055 (backfill
    // dari pemetaan, preseden cash→bank→clearing) secara idempoten.
    for (const [key, kind] of [["cash", "cash"], ["bank", "bank"], ["qris", "clearing"]] as const) {
      await tx.execute(
        sql`update "accounts" set "cash_bank_kind" = ${kind} where "company_id" = ${ORG} and "cash_bank_kind" is null and "id" in (select "account_id" from "account_mappings" where "company_id" = ${ORG} and "key" = ${key})`,
      );
    }
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (!existing) {
      const seeded = await seedCompany(tx);
      WH1 = seeded.wh1;
      WH2 = seeded.wh2;
      SUP1 = seeded.supplierId;
      SUP2 = seeded.supplier2Id;
      CASH_ACCOUNT = seeded.cashAccount;
      CASH_METHOD = seeded.methodId;
    } else {
      const whs = await tx
        .select({ id: warehouses.id, code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG));
      WH1 = whs.find((w) => w.code === "GU-G2")!.id;
      WH2 = whs.find((w) => w.code === "GC-G2")!.id;
      const sups = await tx
        .select({ id: suppliers.id, code: suppliers.code })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG));
      SUP1 = sups.find((s) => s.code === "SUP-G2")!.id;
      SUP2 = sups.find((s) => s.code === "SUP-G2B")!.id;
      const [method] = await tx
        .select({ id: paymentMethods.id, accountId: paymentMethods.accountId })
        .from(paymentMethods)
        .where(eq(paymentMethods.companyId, ORG));
      CASH_METHOD = method.id;
      CASH_ACCOUNT = method.accountId!;
    }
  });
}

beforeAll(ensureFixtures);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

let skuCounter = 0;
async function makeProduct(
  tx: Tx,
  opts: {
    sku?: string;
    costPrice?: string;
    salePrice?: string;
    trackBatch?: boolean;
    trackSerial?: boolean;
  } = {},
) {
  skuCounter += 1;
  const sku = opts.sku ?? `G2-${Date.now()}-${skuCounter}`;
  const [row] = await tx
    .insert(products)
    .values({
      companyId: ORG,
      sku,
      name: `Produk ${sku}`,
      costPrice: opts.costPrice ?? "0",
      salePrice: opts.salePrice ?? "15000",
      trackBatch: opts.trackBatch ?? false,
      trackSerial: opts.trackSerial ?? false,
    })
    .returning();
  return row;
}

async function glBalance(tx: Tx, code: string, asOf?: string): Promise<number> {
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG), eq(accounts.code, code)))
    .limit(1);
  const rows = (await tx.execute(sql`
    select coalesce(sum(jl.debit - jl.credit), 0) as balance
    from journal_lines jl
    join journal_entries je on je.id = jl.entry_id
    where jl.company_id = ${ORG}
      and jl.account_id = ${account.id}
      and je.status = 'posted'
      ${asOf ? sql`and je.date <= ${asOf}` : sql``}
  `)) as unknown as { balance: string }[];
  return d(rows[0].balance).toNumber();
}

async function stockOf(tx: Tx, warehouseId: string, productId: string): Promise<number> {
  // getStock (POS) tidak memuat entri untuk produk tanpa baris on-hand
  // di gudang itu — bagi assertion, ketiadaan baris berarti stok 0.
  return (await getStock(tx, ORG, warehouseId, [productId])).get(productId) ?? 0;
}

async function movementValue(tx: Tx, productId: string, asOf?: string): Promise<number> {
  const rows = (await tx.execute(sql`
    select coalesce(sum(qty * unit_cost), 0) as value
    from stock_movements
    where company_id = ${ORG} and product_id = ${productId}
    ${asOf ? sql`and date <= ${asOf}` : sql``}
  `)) as unknown as { value: string }[];
  return d(rows[0].value).toNumber();
}

async function costPriceOf(tx: Tx, productId: string): Promise<number> {
  const [row] = await tx
    .select({ costPrice: products.costPrice })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  return d(row.costPrice).toNumber();
}

async function serialCount(tx: Tx, productId: string, status: string): Promise<number> {
  const rows = await tx
    .select({ id: stockSerials.id })
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, ORG),
        eq(stockSerials.productId, productId),
        eq(stockSerials.status, status),
      ),
    );
  return rows.length;
}

async function setSettings(tx: Tx, patch: Record<string, unknown>) {
  await tx
    .update(companySettings)
    .set(patch as never)
    .where(eq(companySettings.companyId, ORG));
}

async function checkout(
  tx: Tx,
  input: { productId: string; qty: number; unitPrice: number; reservationId?: string },
) {
  const quote = await quoteCart(tx, {
    companyId: ORG,
    warehouseId: WH1,
    lines: [{ productId: input.productId, qty: input.qty }],
    reservationId: input.reservationId,
  });
  return createSale(tx, {
    companyId: ORG,
    userId: USER,
    warehouseId: WH1,
    date: TODAY,
    lines: [{ productId: input.productId, qty: input.qty }],
    payments: [{ methodId: CASH_METHOD, amount: quote.total, tendered: quote.total }],
    idempotencyKey: crypto.randomUUID(),
    reservationId: input.reservationId,
  });
}

/* ------------------------------------------------------------------ */
/* GDG1-02 — AVCO isi ulang dari posisi negatif / nol                  */
/* ------------------------------------------------------------------ */

describe("GDG1-02 — AVCO menutup defisit stok negatif", () => {
  it("stok −5 @10.000 lalu terima 10 @20.000 → stok 5, biaya 30.000, subledger = GL 150.000", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { allowNegativeStock: true });
      const product = await makeProduct(tx, { costPrice: "10000", salePrice: "15000" });
      await openCashSession(tx, { companyId: ORG, userId: USER, openingCash: 0 });

      // Jual 5 dari stok 0 pada AVCO Rp10.000 (pengaturan stok negatif aktif).
      await checkout(tx, { productId: product.id, qty: 5, unitPrice: 15000 });
      expect(await stockOf(tx, WH1, product.id)).toBe(-5);
      expect(await glBalance(tx, "1300")).toBe(-50000);

      // Isi ulang 10 @Rp20.000: nilai akhir harus 150.000 (−50.000 + 200.000)
      // pada qty 5 → biaya satuan yang benar Rp30.000, BUKAN Rp20.000.
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: product.id, qty: "10", unitCost: "20000" }],
      });

      expect(await stockOf(tx, WH1, product.id)).toBe(5);
      expect(await costPriceOf(tx, product.id)).toBe(30000);
      expect(await glBalance(tx, "1300")).toBe(150000);
      expect(await movementValue(tx, product.id)).toBe(150000);
      expect(5 * (await costPriceOf(tx, product.id))).toBe(await glBalance(tx, "1300"));
    });
  });

  it("isi ulang dari stok nol memakai biaya masuk; blend normal dua penerimaan tidak berubah", async () => {
    await rollbackTransaction(async (tx) => {
      const fromZero = await makeProduct(tx, { costPrice: "9999" });
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: fromZero.id, qty: "10", unitCost: "20000" }],
      });
      expect(await costPriceOf(tx, fromZero.id)).toBe(20000);

      const normal = await makeProduct(tx, {});
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: normal.id, qty: "10", unitCost: "10000" }],
      });
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH2,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: normal.id, qty: "10", unitCost: "20000" }],
      });
      // Blend global dua gudang (kasus normal terverifikasi A1): tepat 15.000.
      expect(await costPriceOf(tx, normal.id)).toBe(15000);
    });
  });

  it("blend konkuren dua gudang tetap tepat 8.000 (kunci baris produk)", async () => {
    const sku = `G2-RACE-${Date.now()}`;
    const product = await committed((tx) => makeProduct(tx, { sku }));
    const results = await Promise.allSettled([
      committed((tx) =>
        createReceipt(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: WH1,
          supplierId: SUP2,
          source: "purchase",
          date: TODAY,
          lines: [{ productId: product.id, qty: "10", unitCost: "4000" }],
        }),
      ),
      committed((tx) =>
        createReceipt(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: WH2,
          supplierId: SUP2,
          source: "purchase",
          date: TODAY,
          lines: [{ productId: product.id, qty: "10", unitCost: "12000" }],
        }),
      ),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const finalCost = await committed((tx) => costPriceOf(tx, product.id));
    expect(finalCost).toBe(8000);
  });
});

/* ------------------------------------------------------------------ */
/* GDG1-03/04/05 — retur pemasok: seri & baris pengganti               */
/* ------------------------------------------------------------------ */

async function postedReturn(
  tx: Tx,
  input: {
    productId: string;
    qty: string;
    warehouseId?: string;
    extraLines?: { productId: string; qty: string }[];
  },
) {
  const created = await createSupplierReturn(tx, {
    companyId: ORG,
    userId: USER,
    supplierId: SUP1,
    warehouseId: input.warehouseId ?? WH1,
    date: TODAY,
    reasonCategory: "damaged",
    reasonDetail: "Barang rusak saat diterima",
    resolutionType: "replacement",
    lines: [
      { productId: input.productId, qty: input.qty },
      ...(input.extraLines ?? []),
    ],
  });
  await postSupplierReturn(tx, { companyId: ORG, userId: USER, returnId: created.id });
  const lines = await tx
    .select()
    .from(supplierReturnLines)
    .where(eq(supplierReturnLines.returnId, created.id));
  return { returnId: created.id, lines };
}

async function cashReceipt(
  tx: Tx,
  input: {
    productId: string;
    qty: string;
    unitCost: string;
    serialNumbers?: string[];
    batchNumber?: string;
  },
) {
  return createReceipt(tx, {
    companyId: ORG,
    userId: USER,
    warehouseId: WH1,
    supplierId: SUP1,
    source: "purchase",
    paymentAccountId: CASH_ACCOUNT,
    date: TODAY,
    lines: [
      {
        productId: input.productId,
        qty: input.qty,
        unitCost: input.unitCost,
        serialNumbers: input.serialNumbers,
        batchNumber: input.batchNumber,
      },
    ],
  });
}

describe("GDG1-03 — void retur pemasok memulihkan nomor seri", () => {
  it("retur 1 dari 3 seri terposting lalu di-void → ketiga seri kembali in_stock, stok 3", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, { trackSerial: true });
      await cashReceipt(tx, {
        productId: product.id,
        qty: "3",
        unitCost: "9000",
        serialNumbers: ["SN-A", "SN-B", "SN-C"],
      });
      const { returnId } = await postedReturn(tx, { productId: product.id, qty: "1" });
      expect(await stockOf(tx, WH1, product.id)).toBe(2);
      expect(await serialCount(tx, product.id, "in_stock")).toBe(2);
      expect(await serialCount(tx, product.id, "out")).toBe(1);

      await voidPostedSupplierReturn(tx, {
        companyId: ORG,
        userId: USER,
        returnId,
        reason: "Retur dibatalkan, barang ternyata dapat diperbaiki",
        date: TODAY,
      });

      expect(await stockOf(tx, WH1, product.id)).toBe(3);
      expect(await serialCount(tx, product.id, "in_stock")).toBe(3);
      expect(await serialCount(tx, product.id, "out")).toBe(0);
    });
  });
});

describe("GDG1-04 — barang pengganti produk serial wajib bernomor seri", () => {
  it("tanpa daftar seri ditolak; jumlah tak sama ditolak; dengan seri benar seri masuk stok", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, { trackSerial: true });
      await cashReceipt(tx, {
        productId: product.id,
        qty: "2",
        unitCost: "9000",
        serialNumbers: ["SN-1", "SN-2"],
      });
      const { returnId, lines } = await postedReturn(tx, { productId: product.id, qty: "1" });
      expect(await serialCount(tx, product.id, "in_stock")).toBe(1);

      await expectRejects(
        () =>
          receiveReplacement(tx, {
            companyId: ORG,
            userId: USER,
            returnId,
            date: TODAY,
            lines: [{ returnLineId: lines[0].id, qty: "1" }],
          }),
        "VALIDATION",
        /nomor seri/i,
      );
      await expectRejects(
        () =>
          receiveReplacement(tx, {
            companyId: ORG,
            userId: USER,
            returnId,
            date: TODAY,
            lines: [{ returnLineId: lines[0].id, qty: "1", serialNumbers: ["SN-X", "SN-Y"] }],
          }),
        "VALIDATION",
      );

      const result = await receiveReplacement(tx, {
        companyId: ORG,
        userId: USER,
        returnId,
        date: TODAY,
        lines: [{ returnLineId: lines[0].id, qty: "1", serialNumbers: ["SN-BARU"] }],
      });
      expect(d(result.consumedAmount).toNumber()).toBe(9000);
      expect(await stockOf(tx, WH1, product.id)).toBe(2);
      expect(await serialCount(tx, product.id, "in_stock")).toBe(2);
      const [baru] = await tx
        .select({ status: stockSerials.status })
        .from(stockSerials)
        .where(and(eq(stockSerials.companyId, ORG), eq(stockSerials.serialNumber, "SN-BARU")));
      expect(baru.status).toBe("in_stock");
    });
  });
});

describe("GDG1-05 — baris replacement diagregat per returnLineId", () => {
  it("dua baris 5+5 atas sisa 5 ditolak; replacedQty tidak menutupi kelebihan", async () => {
    await rollbackTransaction(async (tx) => {
      const a = await makeProduct(tx, {});
      const b = await makeProduct(tx, {});
      await cashReceipt(tx, { productId: a.id, qty: "5", unitCost: "10000" });
      await cashReceipt(tx, { productId: b.id, qty: "5", unitCost: "10000" });
      const { returnId, lines } = await postedReturn(tx, {
        productId: a.id,
        qty: "5",
        extraLines: [{ productId: b.id, qty: "5" }],
      });
      const lineA = lines.find((line) => line.productId === a.id)!;

      await expectRejects(
        () =>
          receiveReplacement(tx, {
            companyId: ORG,
            userId: USER,
            returnId,
            date: TODAY,
            lines: [
              { returnLineId: lineA.id, qty: "5" },
              { returnLineId: lineA.id, qty: "5" },
            ],
          }),
        "VALIDATION",
        /melebihi sisa/,
      );
      // Tidak ada stok fiktif yang masuk dari penolakan itu.
      expect(await stockOf(tx, WH1, a.id)).toBe(0);
    });
  });

  it("pemisahan batch yang sah (3+2 atas sisa 5) diterima dan replacedQty tepat 5", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, { trackBatch: true });
      await cashReceipt(tx, { productId: product.id, qty: "5", unitCost: "10000", batchNumber: "B-ASAL" });
      const { returnId, lines } = await postedReturn(tx, { productId: product.id, qty: "5" });

      await receiveReplacement(tx, {
        companyId: ORG,
        userId: USER,
        returnId,
        date: TODAY,
        lines: [
          { returnLineId: lines[0].id, qty: "3", batchNumber: "B-GANTI-1" },
          { returnLineId: lines[0].id, qty: "2", batchNumber: "B-GANTI-2" },
        ],
      });

      const [line] = await tx
        .select({ replacedQty: supplierReturnLines.replacedQty })
        .from(supplierReturnLines)
        .where(eq(supplierReturnLines.id, lines[0].id));
      expect(d(line.replacedQty).toNumber()).toBe(5);
      expect(await stockOf(tx, WH1, product.id)).toBe(5);
      const batches = await tx
        .select({ qty: stockBatches.qty })
        .from(stockBatches)
        .where(and(eq(stockBatches.companyId, ORG), eq(stockBatches.productId, product.id)));
      expect(batches.reduce((acc, row) => acc + d(row.qty).toNumber(), 0)).toBe(5);
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG1-06/GDG3-14 — reservasi di bawah kunci                          */
/* ------------------------------------------------------------------ */

describe("GDG1-06 — balapan reservasi", () => {
  it("dua reservasi 8+8 atas stok 10: tepat satu lolos, total tereservasi 8", async () => {
    const sku = `G2-RSV-${Date.now()}`;
    const product = await committed(async (tx) => {
      const created = await makeProduct(tx, { sku });
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP2,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: created.id, qty: "10", unitCost: "1000" }],
      });
      return created;
    });
    const results = await Promise.allSettled([
      committed((tx) =>
        createReservation(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: WH1,
          productId: product.id,
          qty: "8",
          date: TODAY,
        }),
      ),
      committed((tx) =>
        createReservation(tx, {
          companyId: ORG,
          userId: USER,
          warehouseId: WH1,
          productId: product.id,
          qty: "8",
          date: TODAY,
        }),
      ),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const reserved = await committed((tx) =>
      getReservedQuantities(tx, ORG, WH1, [product.id]),
    );
    expect((reserved.get(product.id) ?? d(0)).toNumber()).toBe(8);
  });
});

/* ------------------------------------------------------------------ */
/* GDG1-07 — penerimaan transfer sebagian & selisih                    */
/* ------------------------------------------------------------------ */

async function shippedTransfer(tx: Tx, productId: string, qty: string) {
  await setSettings(tx, { transferTwoStepEnabled: true });
  await createReceipt(tx, {
    companyId: ORG,
    userId: USER,
    warehouseId: WH1,
    supplierId: SUP1,
    source: "purchase",
    date: TODAY,
    lines: [{ productId, qty, unitCost: "10000" }],
  });
  return createTransfer(tx, {
    companyId: ORG,
    userId: USER,
    fromWarehouseId: WH1,
    toWarehouseId: WH2,
    date: TODAY,
    lines: [{ productId, qty }],
  });
}

async function transferLine(tx: Tx, documentId: string) {
  const [line] = await tx
    .select()
    .from(stockDocumentLines)
    .where(eq(stockDocumentLines.documentId, documentId));
  return line;
}

describe("GDG1-07 — transfer dua tahap: terima sebagian, terima lagi, selisih ditutup", () => {
  it("kirim 10 → terima 7 (dokumen tetap Dalam Perjalanan) → terima sisa 3 → terposting penuh", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      const doc = await shippedTransfer(tx, product.id, "10");
      expect(await stockOf(tx, WH1, product.id)).toBe(0);
      expect(await stockOf(tx, WH2, product.id)).toBe(0);

      const partial = await receiveTransfer(tx, {
        companyId: ORG,
        userId: USER,
        documentId: doc.id,
        date: TODAY,
        lines: [{ productId: product.id, receivedQty: "7" }],
      });
      expect(partial.status).toBe("in_transit");
      expect(d((await transferLine(tx, doc.id)).receivedQty).toNumber()).toBe(7);
      expect(await stockOf(tx, WH2, product.id)).toBe(7);

      const done = await receiveTransfer(tx, {
        companyId: ORG,
        userId: USER,
        documentId: doc.id,
        date: TODAY,
      });
      expect(done.status).toBe("posted");
      expect(d((await transferLine(tx, doc.id)).receivedQty).toNumber()).toBe(10);
      expect(await stockOf(tx, WH2, product.id)).toBe(10);
    });
  });

  it("kirim 10 → terima 7 + tutup selisih beralasan: tujuan +7, sumber −10, jurnal selisih 30.000, GL = ledger", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      const doc = await shippedTransfer(tx, product.id, "10");
      const glBefore = await glBalance(tx, "1300");
      // Nilai ledger gerakan produk ini sesudah pengiriman = 0:
      // penerimaan +100.000 di sumber, transfer keluar −100.000 —
      // nilainya sedang "dalam perjalanan" (belum masuk gudang tujuan).
      const mvBefore = await movementValue(tx, product.id);
      expect(mvBefore).toBe(0);

      // Penutupan selisih tanpa alasan wajib ditolak.
      await expectRejects(
        () =>
          receiveTransfer(tx, {
            companyId: ORG,
            userId: USER,
            documentId: doc.id,
            date: TODAY,
            lines: [{ productId: product.id, receivedQty: "7" }],
            closeRemainder: true,
          }),
        "VALIDATION",
        /alasan/i,
      );
      // Menerima melebihi qty kirim ditolak.
      await expectRejects(
        () =>
          receiveTransfer(tx, {
            companyId: ORG,
            userId: USER,
            documentId: doc.id,
            date: TODAY,
            lines: [{ productId: product.id, receivedQty: "11" }],
          }),
        "VALIDATION",
        /melebihi/,
      );

      const closed = await receiveTransfer(tx, {
        companyId: ORG,
        userId: USER,
        documentId: doc.id,
        date: TODAY,
        lines: [{ productId: product.id, receivedQty: "7" }],
        closeRemainder: true,
        differenceReason: "3 unit rusak dalam perjalanan",
      });
      expect(closed.status).toBe("posted");
      expect(closed.differenceReason).toBe("3 unit rusak dalam perjalanan");
      expect(await stockOf(tx, WH1, product.id)).toBe(0);
      expect(await stockOf(tx, WH2, product.id)).toBe(7);

      // Jurnal selisih perjalanan: Dr Beban Susut 30.000 / Cr Persediaan 30.000.
      const [journal] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG),
            eq(journalEntries.sourceType, "transfer_difference"),
            eq(journalEntries.sourceId, doc.id),
            eq(journalEntries.status, "posted"),
          ),
        );
      expect(journal).toBeDefined();
      // GL persediaan turun tepat nilai selisih (30.000). Ledger
      // gerakan produk ini berakhir pada nilai fisik di tujuan
      // (7 × 10.000 = 70.000), dan 70.000 diterima + 30.000 selisih
      // menjurnal = 100.000 nilai kirim — tidak ada nilai yang hilang
      // atau tercipta di antara ledger stok dan GL.
      expect(await glBalance(tx, "1300")).toBe(glBefore - 30000);
      expect(await movementValue(tx, product.id)).toBe(mvBefore + 70000);
      expect((await movementValue(tx, product.id)) + 30000).toBe(100000);
      expect(d((await transferLine(tx, doc.id)).receivedQty).toNumber()).toBe(7);
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG1-08 — domain menolak qty <= 0                                   */
/* ------------------------------------------------------------------ */

describe("GDG1-08 — validasi tanda qty di domain", () => {
  it("createTransfer qty 0 / negatif / baris duplikat ditolak; opname hitungan negatif ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: product.id, qty: "10", unitCost: "10000" }],
      });
      const transfer = (lines: { productId: string; qty: string }[]) =>
        createTransfer(tx, {
          companyId: ORG,
          userId: USER,
          fromWarehouseId: WH1,
          toWarehouseId: WH2,
          date: TODAY,
          lines,
        });
      await expectRejects(() => transfer([{ productId: product.id, qty: "0" }]), "VALIDATION", /lebih dari 0/);
      await expectRejects(() => transfer([{ productId: product.id, qty: "-4" }]), "VALIDATION", /lebih dari 0/);
      await expectRejects(
        () =>
          transfer([
            { productId: product.id, qty: "2" },
            { productId: product.id, qty: "3" },
          ]),
        "VALIDATION",
        /lebih dari sekali/,
      );
      // Arah mutasi tidak pernah terbalik oleh penolakan-penolakan itu.
      expect(await stockOf(tx, WH1, product.id)).toBe(10);
      expect(await stockOf(tx, WH2, product.id)).toBe(0);

      await expectRejects(
        () =>
          createOpname(tx, {
            companyId: ORG,
            userId: USER,
            warehouseId: WH1,
            date: TODAY,
            lines: [{ productId: product.id, countedQty: "-1" }],
          }),
        "VALIDATION",
        /tidak boleh negatif/,
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG1-09 — kedaluwarsa bawaan reservasi + konsumsi oleh checkout     */
/* ------------------------------------------------------------------ */

describe("GDG1-09 — lifecycle reservasi", () => {
  it("tanpa expiresAt eksplisit, reservasi memakai bawaan pengaturan (7 hari, dapat diubah)", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: product.id, qty: "10", unitCost: "10000" }],
      });
      const first = await createReservation(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        productId: product.id,
        qty: "2",
        date: TODAY,
      });
      expect(first.expiresAt).not.toBeNull();
      expect(first.expiresAt!.toISOString().slice(0, 10)).toBe(plusDays(TODAY, 7));

      await setSettings(tx, { reservationDefaultExpiryDays: 3 });
      const second = await createReservation(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        productId: product.id,
        qty: "2",
        date: TODAY,
      });
      expect(second.expiresAt!.toISOString().slice(0, 10)).toBe(plusDays(TODAY, 3));

      const explicit = new Date(`${plusDays(TODAY, 30)}T00:00:00.000Z`);
      const third = await createReservation(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        productId: product.id,
        qty: "2",
        date: TODAY,
        expiresAt: explicit,
      });
      expect(third.expiresAt!.toISOString()).toBe(explicit.toISOString());
    });
  });

  it("checkout menyebut reservationId: reservasi terkonsumsi atomik sampai fulfilled", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, { salePrice: "15000" });
      const other = await makeProduct(tx, { salePrice: "15000" });
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [
          { productId: product.id, qty: "10", unitCost: "10000" },
          { productId: other.id, qty: "10", unitCost: "10000" },
        ],
      });
      await openCashSession(tx, { companyId: ORG, userId: USER, openingCash: 0 });
      const reservation = await createReservation(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        productId: product.id,
        qty: "10",
        date: TODAY,
      });

      // Tanpa menyebut reservasi, stok yang direservasi penuh tetap terkunci.
      await expectRejects(
        () => checkout(tx, { productId: product.id, qty: 10, unitPrice: 15000 }),
        "INSUFFICIENT_STOCK",
      );
      // Reservasi produk lain tidak dapat dipakai untuk penjualan ini.
      await expectRejects(
        () => checkout(tx, { productId: other.id, qty: 1, unitPrice: 15000, reservationId: reservation.id }),
        "VALIDATION",
        /reservasi/i,
      );

      // Konsumsi sebagian: 4 terjual, sisa reservasi 6 dan tetap aktif.
      await checkout(tx, { productId: product.id, qty: 4, unitPrice: 15000, reservationId: reservation.id });
      const [afterPartial] = await tx
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.id, reservation.id));
      expect(d(afterPartial.qty).toNumber()).toBe(6);
      expect(afterPartial.status).toBe("active");

      // Konsumsi sisa: reservasi berakhir sebagai fulfilled.
      await checkout(tx, { productId: product.id, qty: 6, unitPrice: 15000, reservationId: reservation.id });
      const [afterFull] = await tx
        .select()
        .from(stockReservations)
        .where(eq(stockReservations.id, reservation.id));
      expect(afterFull.status).toBe("fulfilled");
      expect(await stockOf(tx, WH1, product.id)).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-02 — kunci periode mencakup dokumen stok                       */
/* ------------------------------------------------------------------ */

describe("GDG3-02 — dokumen stok bertanggal periode tertutup ditolak", () => {
  it("transfer, opname neto-nol, penerimaan bernilai nol, dan penyesuaian pada 2024-05-10 semuanya ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: product.id, qty: "10", unitCost: "10000" }],
      });

      await expectRejects(
        () =>
          createTransfer(tx, {
            companyId: ORG,
            userId: USER,
            fromWarehouseId: WH1,
            toWarehouseId: WH2,
            date: CLOSED_DATE,
            lines: [{ productId: product.id, qty: "1" }],
          }),
        "PERIOD_CLOSED",
      );
      // Opname tanpa selisih (neto nol, tanpa jurnal) pun tertahan periode.
      await expectRejects(
        () =>
          createOpname(tx, {
            companyId: ORG,
            userId: USER,
            warehouseId: WH1,
            date: CLOSED_DATE,
            lines: [{ productId: product.id, countedQty: "10" }],
          }),
        "PERIOD_CLOSED",
      );
      // Penerimaan bernilai nol (total 0 → jurnal dilewati) pun tertahan.
      await expectRejects(
        () =>
          createReceipt(tx, {
            companyId: ORG,
            userId: USER,
            warehouseId: WH1,
            supplierId: SUP1,
            source: "purchase",
            date: CLOSED_DATE,
            lines: [{ productId: product.id, qty: "5", unitCost: "0" }],
          }),
        "PERIOD_CLOSED",
      );
      // Kontrol terbuka: dokumen yang sama pada tanggal hari ini lolos.
      const ok = await createTransfer(tx, {
        companyId: ORG,
        userId: USER,
        fromWarehouseId: WH1,
        toWarehouseId: WH2,
        date: TODAY,
        lines: [{ productId: product.id, qty: "1" }],
      });
      expect(ok.number).toBeTruthy();
      const docs = await tx
        .select({ id: stockDocuments.id })
        .from(stockDocuments)
        .where(eq(stockDocuments.companyId, ORG));
      expect(docs.length).toBe(1); // hanya transfer kontrol yang terbit
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-03 — rekonsiliasi persediaan as-of dari ledger dokumen         */
/* ------------------------------------------------------------------ */

describe("GDG3-03 — rekonsiliasi kontrol persediaan untuk tanggal lampau", () => {
  it("penerimaan backdated 30 hari: selisih as-of 15 hari lalu = 0 (bukan +1.000.000)", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      const date30 = minusDays(TODAY, 30);
      const date15 = minusDays(TODAY, 15);
      const date45 = minusDays(TODAY, 45);
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: date30,
        lines: [{ productId: product.id, qty: "10", unitCost: "100000" }],
      });

      const inventoryLeg = (recon: Awaited<ReturnType<typeof getControlReconciliation>>) =>
        recon.legs.find((leg) => leg.key === "inventory")!;

      const mid = inventoryLeg(await getControlReconciliation(tx, ORG, date15));
      expect(mid.gl).toBe(1000000);
      expect(mid.subledger).toBe(1000000);
      expect(mid.difference).toBe(0);

      const before = inventoryLeg(await getControlReconciliation(tx, ORG, date45));
      expect(before.gl).toBe(0);
      expect(before.subledger).toBe(0);
      expect(before.difference).toBe(0);

      const now = inventoryLeg(await getControlReconciliation(tx, ORG, TODAY));
      expect(now.difference).toBe(0);
    });
  });

  it("gerakan dicatat bertanggal dokumen sumbernya (kolom date), bukan tanggal posting", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await makeProduct(tx, {});
      const date30 = minusDays(TODAY, 30);
      await createReceipt(tx, {
        companyId: ORG,
        userId: USER,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: date30,
        lines: [{ productId: product.id, qty: "4", unitCost: "5000" }],
      });
      const rows = await tx
        .select({ date: stockMovements.date, qty: stockMovements.qty })
        .from(stockMovements)
        .where(eq(stockMovements.productId, product.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].date).toBe(date30);
    });
  });
});
