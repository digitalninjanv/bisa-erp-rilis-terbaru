import { describe, expect, it, vi } from "vitest";
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  auditLog,
  cashMovements,
  cashSessions,
  companySettings,
  paymentMethods,
  products,
  sales,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  closeCashSession,
  createSale,
  holdSale,
  openCashSession,
  quoteCart,
  voidSale,
} from "@/server/pos";
import { getCashSessionSummary } from "@/server/reports";
import { checkoutAction } from "@/server/actions/pos";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// Tindak lanjut review independen Tahap 3 (temuan T3R-1 s.d. T3R-3):
// - T3R-1 (P1): baris produk duplikat di quoteCart mengakali ambang
//   diskon manual (tiap baris dinilai sendiri-sendiri) dan cek stok per
//   baris — domain kini menolak baris duplikat.
// - T3R-2 (P2): voidSale menulis mutasi refund ke sesi asal walau sesi
//   itu sudah ditutup, mengubah ringkasan sesi final secara retroaktif.
//   Kini: sesi asal hanya bila masih terbuka; selain itu sesi terbuka
//   pemroses void; tanpa sesi mana pun void tetap jalan tanpa mutasi
//   dan audit mencatatnya (pola D-8).
// - T3R-3 (P2): dua checkout bersamaan atas heldSaleId yang sama dulu
//   menghasilkan dua penjualan final. checkoutAction kini mengklaim
//   baris tahanan FOR UPDATE dalam transaksi checkout yang sama.
// T3R-1 memakai pola rollback di perusahaan demo; T3R-2/T3R-3 memakai
// transaksi commit di perusahaan uji tersendiri (kunci baris & balapan
// hanya terlihat antar-transaksi). checkoutAction dijalankan lewat mock
// sesi (pola accounting-actions-p2.test.ts) yang menunjuk perusahaan uji.

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const T3_ORG = "01900000-0000-7000-8000-00000000aa05";
const ACTION_USER = "user-uji-t3-kasir";
const SELLER = "user-uji-t3-penjual";
const PROCESSOR = "user-uji-t3-pemroses";
const NOSESSION = "user-uji-t3-tanpa-sesi";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: T3_ORG, name: "Uji Review T3" },
    user: { id: ACTION_USER },
    role: "owner",
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function t3Transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${T3_ORG}, true)`);
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
  expect(error).toMatchObject({ code });
  if (message) expect((error as Error).message).toMatch(message);
}

/* ------------------------------------------------------------------ */
/* T3R-1 — baris produk duplikat (rollback, perusahaan demo)           */
/* ------------------------------------------------------------------ */

describe("T3R-1 baris produk duplikat ditolak di quoteCart (rollback)", () => {
  it("quote & checkout menolak dua baris produk yang sama; produk berbeda tetap lolos", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      expect(warehouse).toBeDefined();

      const rows = await tx
        .select({ productId: stockOnHand.productId })
        .from(stockOnHand)
        .innerJoin(products, eq(stockOnHand.productId, products.id))
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            gt(stockOnHand.qty, "10"),
            eq(products.trackBatch, false),
          ),
        )
        .orderBy(asc(products.sku))
        .limit(2);
      expect(rows).toHaveLength(2);
      const [productA, productB] = rows;

      // Harga dibuat genap agar persen diskon mudah dinilai: dua baris
      // produk sama @10.000 dengan diskon nominal 950 per baris adalah
      // 9,5% per baris (di bawah ambang 10%) tetapi 19% gabungan —
      // persis celah T3R-1. Penolakan kini terjadi karena duplikatnya.
      await tx
        .update(products)
        .set({ salePrice: "10000" })
        .where(eq(products.id, productA.productId));
      await tx
        .update(companySettings)
        .set({ roundingMode: "none", posDiscountThresholdPercent: "10" })
        .where(eq(companySettings.companyId, ORG_ID));

      const duplicateWithDiscount = [
        { productId: productA.productId, qty: 1, discountType: "nominal" as const, discountValue: "950" },
        { productId: productA.productId, qty: 1, discountType: "nominal" as const, discountValue: "950" },
      ];
      await expectRejects(
        () => quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines: duplicateWithDiscount }),
        "VALIDATION",
        /lebih dari sekali/,
      );

      const duplicatePlain = [
        { productId: productA.productId, qty: 1 },
        { productId: productA.productId, qty: 2 },
      ];
      await expectRejects(
        () => quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines: duplicatePlain }),
        "VALIDATION",
        /lebih dari sekali/,
      );

      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
        .limit(1);
      expect(method).toBeDefined();
      await expectRejects(
        () =>
          createSale(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            warehouseId: warehouse.id,
            date: todayISO(),
            lines: duplicatePlain,
            payments: [{ methodId: method.id, amount: 30000, tendered: 30000 }],
            idempotencyKey: crypto.randomUUID(),
          }),
        "VALIDATION",
        /lebih dari sekali/,
      );

      // Baris produk berbeda tetap lolos seperti biasa.
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [
          { productId: productA.productId, qty: 1 },
          { productId: productB.productId, qty: 1 },
        ],
      });
      expect(quote.lines).toHaveLength(2);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Perusahaan uji commit untuk T3R-2 & T3R-3                           */
/* ------------------------------------------------------------------ */

/** Fixture minimum perusahaan uji review T3 (idempoten antar-run). */
async function ensureT3Company(tx: Tx) {
  const [existing] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, T3_ORG))
    .limit(1);
  if (existing) return;

  await tx.insert(companySettings).values({ companyId: T3_ORG, legalName: "Uji Review Tahap 3" });

  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1100", "Bank BCA", "asset", "debit"],
    ["1110", "QRIS Clearing", "asset", "debit"],
    ["1200", "Piutang Usaha", "asset", "debit"],
    ["1300", "Persediaan Barang Dagang", "asset", "debit"],
    ["2000", "Utang Usaha", "liability", "credit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["2200", "PPN Keluaran", "liability", "credit"],
    ["2300", "Kredit Pelanggan", "liability", "credit"],
    ["3000", "Modal Pemilik", "equity", "credit"],
    ["4000", "Penjualan", "revenue", "credit"],
    ["4010", "Diskon Penjualan", "revenue", "debit"],
    ["4020", "Retur Penjualan", "revenue", "debit"],
    ["4030", "Pendapatan Lain-lain", "revenue", "credit"],
    ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
    ["5010", "Selisih Persediaan", "cogs", "debit"],
    ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit"],
    ["6060", "Beban Administrasi Bank", "expense", "debit"],
    ["8000", "Selisih Kas Kurang", "expense", "debit"],
    ["8001", "Selisih Kas Lebih", "revenue", "credit"],
    ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
    ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
  ];
  const accountRows = await tx
    .insert(accounts)
    .values(
      accountSeeds.map(([code, name, type, normalBalance]) => ({
        companyId: T3_ORG,
        code,
        name,
        type,
        normalBalance,
      })),
    )
    .returning();
  const acc = new Map(accountRows.map((a) => [a.code, a.id]));
  const mapping: Record<string, string> = {
    cash: acc.get("1000")!,
    bank: acc.get("1100")!,
    qris: acc.get("1110")!,
    receivable: acc.get("1200")!,
    inventory: acc.get("1300")!,
    payable: acc.get("2000")!,
    revenue: acc.get("4000")!,
    sales_discount: acc.get("4010")!,
    sales_return: acc.get("4020")!,
    cogs: acc.get("5000")!,
    inventory_shrink: acc.get("5010")!,
    damaged: acc.get("5020")!,
    tax_output: acc.get("2200")!,
    rounding_gain: acc.get("9000")!,
    rounding_loss: acc.get("9001")!,
    cash_short: acc.get("8000")!,
    cash_over: acc.get("8001")!,
    salary_expense: acc.get("6000")!,
    salary_payable: acc.get("2100")!,
    bank_fee: acc.get("6060")!,
    equity: acc.get("3000")!,
    customer_credit: acc.get("2300")!,
  };
  await tx.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: T3_ORG, key, accountId })),
  );
  const [warehouse] = await tx
    .insert(warehouses)
    .values({ companyId: T3_ORG, code: "GD-UJI", name: "Gudang Uji", type: "warehouse", isDefault: true })
    .returning({ id: warehouses.id });
  await tx.insert(paymentMethods).values({
    companyId: T3_ORG,
    code: "CASH",
    name: "Tunai",
    type: "cash",
    accountId: acc.get("1000")!,
    sortOrder: 1,
  });
  const [product] = await tx
    .insert(products)
    .values({
      companyId: T3_ORG,
      sku: "UJI-REVIEW-T3-1",
      name: "Produk Uji Review T3",
      salePrice: "10000",
      costPrice: "6000",
    })
    .returning({ id: products.id });
  await tx.insert(stockOnHand).values({
    companyId: T3_ORG,
    warehouseId: warehouse.id,
    productId: product.id,
    qty: "100000",
  });
  // AUD-001: stok awal fixture wajib punya gerakan "opening" padan —
  // invarian persediaan (stock_on_hand == Σ stock_movements, cek B1
  // db-integrity) berlaku juga untuk perusahaan fixture.
  await tx.insert(stockMovements).values({
    companyId: T3_ORG,
    warehouseId: warehouse.id,
    productId: product.id,
    movementType: "opening",
    qty: "100000",
    unitCost: "6000",
    referenceType: "fixture",
    reason: "Stok awal fixture uji review-t3",
  });
}

async function t3Fixture(tx: Tx) {
  await ensureT3Company(tx);
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, T3_ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, T3_ORG), eq(products.sku, "UJI-REVIEW-T3-1")))
    .limit(1);
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, T3_ORG), eq(paymentMethods.type, "cash")))
    .limit(1);
  // Persediaan besar agar aman di banyak run.
  await tx
    .update(stockOnHand)
    .set({ qty: "100000" })
    .where(
      and(
        eq(stockOnHand.companyId, T3_ORG),
        eq(stockOnHand.warehouseId, warehouse.id),
        eq(stockOnHand.productId, product.id),
      ),
    );
  return { warehouse, product, method };
}

/** Sesi terbuka pengguna: pakai yang sudah ada, atau buka baru. */
async function openSessionFor(tx: Tx, userId: string, openingCash: number) {
  const [existing] = await tx
    .select({ id: cashSessions.id })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.companyId, T3_ORG),
        eq(cashSessions.userId, userId),
        eq(cashSessions.status, "open"),
      ),
    )
    .orderBy(desc(cashSessions.openedAt))
    .limit(1);
  if (existing) return existing.id;
  const session = await openCashSession(tx, { companyId: T3_ORG, userId, openingCash });
  return session.id;
}

async function closeSessionBalanced(tx: Tx, userId: string, sessionId: string) {
  const summary = await getCashSessionSummary(tx, T3_ORG, sessionId);
  expect(summary).not.toBeNull();
  const result = await closeCashSession(tx, {
    companyId: T3_ORG,
    userId,
    sessionId,
    countedCash: summary!.expected,
  });
  expect(result.difference).toBeCloseTo(0, 2);
}

async function latestVoidAudit(tx: Tx, saleId: string) {
  const [audit] = await tx
    .select()
    .from(auditLog)
    .where(
      and(
        eq(auditLog.companyId, T3_ORG),
        eq(auditLog.action, "pos.void"),
        eq(auditLog.entityId, saleId),
      ),
    )
    .orderBy(desc(auditLog.createdAt))
    .limit(1);
  expect(audit).toBeDefined();
  return audit.after as {
    refundSessionId?: string | null;
    refundSessionSource?: string | null;
    refundSessionNote?: string;
  };
}

async function refundMovements(tx: Tx, saleId: string) {
  return tx
    .select()
    .from(cashMovements)
    .where(
      and(
        eq(cashMovements.companyId, T3_ORG),
        eq(cashMovements.referenceId, saleId),
        eq(cashMovements.type, "refund"),
      ),
    );
}

/* ------------------------------------------------------------------ */
/* T3R-2 — void & sesi refund (commit, perusahaan uji)                 */
/* ------------------------------------------------------------------ */

describe("T3R-2 void tidak menulis ke sesi tertutup (commit)", () => {
  it("sesi asal tertutup: refund masuk ke sesi pemroses; ringkasan sesi tertutup tidak berubah", async () => {
    const fx = await t3Transaction((tx) => t3Fixture(tx));
    const sellerSessionId = await t3Transaction((tx) => openSessionFor(tx, SELLER, 50000));
    const processorSessionId = await t3Transaction((tx) => openSessionFor(tx, PROCESSOR, 0));

    const sale = await t3Transaction((tx) =>
      createSale(tx, {
        companyId: T3_ORG,
        userId: SELLER,
        warehouseId: fx.warehouse.id,
        date: todayISO(),
        lines: [{ productId: fx.product.id, qty: 2 }],
        payments: [{ methodId: fx.method.id, amount: 20000, tendered: 20000 }],
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    expect(sale.total).toBeCloseTo(20000, 2);

    await t3Transaction((tx) => closeSessionBalanced(tx, SELLER, sellerSessionId));
    const snapshot = await t3Transaction((tx) => getCashSessionSummary(tx, T3_ORG, sellerSessionId));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.session.status).toBe("closed");

    await t3Transaction((tx) =>
      voidSale(tx, {
        companyId: T3_ORG,
        userId: PROCESSOR,
        saleId: sale.id,
        reason: "Uji T3R-2 sesi asal tertutup",
      }),
    );

    const after = await t3Transaction(async (tx) => ({
      summary: await getCashSessionSummary(tx, T3_ORG, sellerSessionId),
      refunds: await refundMovements(tx, sale.id),
      auditAfter: await latestVoidAudit(tx, sale.id),
    }));

    // Refund dicatat ke sesi terbuka pemroses void, BUKAN sesi asal.
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0].sessionId).toBe(processorSessionId);
    expect(d(after.refunds[0].amount).toNumber()).toBeCloseTo(-20000, 2);

    // Ringkasan sesi tertutup identik dengan snapshot sebelum void.
    expect(after.summary).not.toBeNull();
    expect(after.summary!.expected).toBe(snapshot!.expected);
    expect(after.summary!.sales).toBe(snapshot!.sales);
    expect(after.summary!.refunds).toBe(snapshot!.refunds);
    expect(after.summary!.movements).toHaveLength(snapshot!.movements.length);
    expect(after.summary!.session.expectedCash).toBe(snapshot!.session.expectedCash);
    expect(after.summary!.session.difference).toBe(snapshot!.session.difference);

    expect(after.auditAfter.refundSessionSource).toBe("processor");
    expect(after.auditAfter.refundSessionId).toBe(processorSessionId);
  });

  it("sesi asal terbuka menerima refund; tanpa sesi mana pun void jalan tanpa mutasi + catatan audit", async () => {
    const fx = await t3Transaction((tx) => t3Fixture(tx));

    // Bagian 1 — sesi asal masih terbuka: perilaku lama dipertahankan,
    // walau pemroses void adalah pengguna lain tanpa sesi.
    const originSessionId = await t3Transaction((tx) => openSessionFor(tx, SELLER, 0));
    const saleOpen = await t3Transaction((tx) =>
      createSale(tx, {
        companyId: T3_ORG,
        userId: SELLER,
        warehouseId: fx.warehouse.id,
        date: todayISO(),
        lines: [{ productId: fx.product.id, qty: 1 }],
        payments: [{ methodId: fx.method.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await t3Transaction((tx) =>
      voidSale(tx, {
        companyId: T3_ORG,
        userId: NOSESSION,
        saleId: saleOpen.id,
        reason: "Uji T3R-2 sesi asal terbuka",
      }),
    );
    const checkOpen = await t3Transaction(async (tx) => ({
      refunds: await refundMovements(tx, saleOpen.id),
      auditAfter: await latestVoidAudit(tx, saleOpen.id),
    }));
    expect(checkOpen.refunds).toHaveLength(1);
    expect(checkOpen.refunds[0].sessionId).toBe(originSessionId);
    expect(checkOpen.auditAfter.refundSessionSource).toBe("origin");

    await t3Transaction((tx) => closeSessionBalanced(tx, SELLER, originSessionId));

    // Bagian 2 — sesi asal ditutup dan pemroses tidak punya sesi
    // terbuka: void tetap berhasil, tanpa mutasi kas, dan audit
    // mencatat bahwa refund tidak masuk sesi mana pun.
    const closedSessionId = await t3Transaction((tx) => openSessionFor(tx, SELLER, 0));
    const saleClosed = await t3Transaction((tx) =>
      createSale(tx, {
        companyId: T3_ORG,
        userId: SELLER,
        warehouseId: fx.warehouse.id,
        date: todayISO(),
        lines: [{ productId: fx.product.id, qty: 1 }],
        payments: [{ methodId: fx.method.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      }),
    );
    await t3Transaction((tx) => closeSessionBalanced(tx, SELLER, closedSessionId));
    await t3Transaction((tx) =>
      voidSale(tx, {
        companyId: T3_ORG,
        userId: NOSESSION,
        saleId: saleClosed.id,
        reason: "Uji T3R-2 tanpa sesi terbuka",
      }),
    );
    const checkClosed = await t3Transaction(async (tx) => {
      const [saleRow] = await tx
        .select({ status: sales.status })
        .from(sales)
        .where(eq(sales.id, saleClosed.id));
      return {
        // Yang dinilai adalah mutasi REFUND-nya: mutasi "sale" asal di
        // sesi tertutup memang ada dan sah (tercatat saat penjualan).
        refunds: await refundMovements(tx, saleClosed.id),
        saleStatus: saleRow?.status,
        auditAfter: await latestVoidAudit(tx, saleClosed.id),
      };
    });
    expect(checkClosed.saleStatus).toBe("void");
    expect(checkClosed.refunds).toHaveLength(0);
    expect(checkClosed.auditAfter.refundSessionId).toBeNull();
    expect(checkClosed.auditAfter.refundSessionNote).toMatch(/tidak dicatat ke sesi/);
  });
});

/* ------------------------------------------------------------------ */
/* T3R-3 — klaim tahanan atomik di checkoutAction (commit)             */
/* ------------------------------------------------------------------ */

describe("T3R-3 klaim tahanan atomik (commit)", () => {
  it("dua checkout bersamaan atas tahanan yang sama: tepat satu berhasil, satu penjualan final", async () => {
    const fx = await t3Transaction((tx) => t3Fixture(tx));
    await t3Transaction((tx) => openSessionFor(tx, ACTION_USER, 0));

    const held = await t3Transaction((tx) =>
      holdSale(tx, {
        companyId: T3_ORG,
        userId: ACTION_USER,
        warehouseId: fx.warehouse.id,
        date: todayISO(),
        label: `Uji T3R-3 ${crypto.randomUUID().slice(0, 8)}`,
        lines: [{ productId: fx.product.id, qty: 1 }],
      }),
    );

    const baseInput = {
      warehouseId: fx.warehouse.id,
      groupId: null,
      heldSaleId: held.id,
      lines: [{ productId: fx.product.id, qty: 1 }],
      payments: [{ methodId: fx.method.id, amount: 10000, tendered: 10000 }],
    };
    const results = await Promise.all([
      checkoutAction({ ...baseInput, idempotencyKey: crypto.randomUUID() }),
      checkoutAction({ ...baseInput, idempotencyKey: crypto.randomUUID() }),
    ]);

    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    const failure = failed[0];
    if (!failure.ok) {
      expect(failure.code).toBe("VALIDATION");
      expect(failure.message).toMatch(/Pesanan tahanan sudah diselesaikan atau tidak tersedia/);
    }
    const successId = succeeded[0].ok ? succeeded[0].data.id : "";

    const stored = await t3Transaction(async (tx) => {
      const heldRows = await tx.select({ id: sales.id }).from(sales).where(eq(sales.id, held.id));
      const [final] = await tx
        .select({ id: sales.id, status: sales.status })
        .from(sales)
        .where(eq(sales.id, successId));
      return { heldCount: heldRows.length, finalStatus: final?.status };
    });
    expect(stored.heldCount).toBe(0);
    expect(stored.finalStatus).toBe("completed");
  });
});
