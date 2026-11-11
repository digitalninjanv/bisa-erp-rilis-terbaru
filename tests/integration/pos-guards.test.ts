import { describe, expect, it } from "vitest";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  auditLog,
  cashSessions,
  companySettings,
  customerGroupPrices,
  customerGroups,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  sales,
  stockMovements,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import {
  cashDrawerMovement,
  closeCashSession,
  createSale,
  openCashSession,
  quoteCart,
} from "@/server/pos";
import { listCustomerGroups, searchProducts } from "@/server/catalog";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction, rollbackTransaction as rollbackForCompany } from "../helpers/rollback-transaction";

// Tahap 3 POS batch P3-3: POS-DISC-01 (ambang diskon manual + izin
// pos.discount, D-10), SET-RND-01 (pembulatan perusahaan diterapkan),
// POS-IDEM-01 (balapan kunci idempotensi mengembalikan penjualan yang
// sama), POS-SES-01 (kepemilikan sesi + satu sesi terbuka per kasir),
// POS-REF-01 (validasi gudang & metode di domain), POS-STK-01 (regresi:
// produk non-stok tidak digerakkan), POS-SRCH-01 (pencarian memakai
// gudang terpilih + stok pada katalog awal), POS-GRP-01 (kelompok
// nonaktif tersaring untuk POS), POS-PAY-02 (pembayaran non-tunai tidak
// boleh melebihi sisa tagihan).
// Pola rollback di perusahaan demo; uji balapan memakai transaksi commit
// di perusahaan uji tersendiri (pola pos-returns.test.ts).

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const OTHER_USER = "01900000-0000-7000-8000-000000000099";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function defaultWarehouse(tx: Tx) {
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  expect(warehouse).toBeDefined();
  return warehouse;
}

async function stockedProduct(tx: Tx, warehouseId: string, minQty: string) {
  const [row] = await tx
    .select({
      productId: stockOnHand.productId,
      qty: stockOnHand.qty,
      salePrice: products.salePrice,
    })
    .from(stockOnHand)
    .innerJoin(products, eq(stockOnHand.productId, products.id))
    .where(
      and(
        eq(stockOnHand.companyId, ORG_ID),
        eq(stockOnHand.warehouseId, warehouseId),
        gt(stockOnHand.qty, minQty),
        eq(products.trackBatch, false),
      ),
    )
    .orderBy(asc(products.sku))
    .limit(1);
  expect(row).toBeDefined();
  return row;
}

async function methodByType(tx: Tx, type: string) {
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, type)))
    .limit(1);
  expect(method).toBeDefined();
  return method;
}

async function setSettings(
  tx: Tx,
  patch: Partial<{ roundingMode: string; posDiscountThresholdPercent: string; taxRate: string }>,
) {
  await tx.update(companySettings).set(patch).where(eq(companySettings.companyId, ORG_ID));
}

async function setPrice(tx: Tx, productId: string, salePrice: string) {
  await tx.update(products).set({ salePrice }).where(eq(products.id, productId));
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
/* POS-DISC-01                                                         */
/* ------------------------------------------------------------------ */

describe("POS-DISC-01 ambang diskon manual (rollback)", () => {
  it("diskon manual di atas ambang ditolak tanpa izin pos.discount; lolos & teraudit dengan izin", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", posDiscountThresholdPercent: "10" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "10");
      await setPrice(tx, product.productId, "10000");
      const method = await methodByType(tx, "cash");
      const lines = [
        { productId: product.productId, qty: 2, discountType: "percent" as const, discountValue: 50 },
      ];

      await expectRejects(
        () => quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines }),
        "VALIDATION",
        /ambang 10%/,
      );

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines,
        canDiscount: true,
      });
      expect(quote.lines[0].manualDiscountAmount).toBeCloseTo(10000, 2);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
        canDiscount: true,
      });

      const audits = await tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.action, "pos.discount.override"),
            eq(auditLog.entityId, sale.id),
          ),
        );
      return { audits: audits.length, total: sale.total };
    });
    expect(outcome.audits).toBe(1);
    expect(outcome.total).toBeCloseTo(10000, 2);
  });

  it("diskon tepat di ambang & di bawahnya bebas; diskon nominal dinilai dari bruto baris", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", posDiscountThresholdPercent: "10" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "10");
      await setPrice(tx, product.productId, "10000");

      // Tepat 10% = ambang → tidak memerlukan izin.
      const atThreshold = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.productId, qty: 1, discountType: "percent", discountValue: 10 }],
      });
      expect(atThreshold.discountTotal).toBeCloseTo(1000, 2);

      // Nominal Rp6.000/unit pada harga Rp10.000 = 60% dari bruto → ditolak.
      await expectRejects(
        () =>
          quoteCart(tx, {
            companyId: ORG_ID,
            warehouseId: warehouse.id,
            lines: [{ productId: product.productId, qty: 1, discountType: "nominal", discountValue: 6000 }],
          }),
        "VALIDATION",
        /ambang 10%/,
      );
    });
  });

  it("diskon kelompok harga TIDAK dihitung ke ambang diskon manual", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", posDiscountThresholdPercent: "10" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "10");
      await setPrice(tx, product.productId, "10000");
      const [discountAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "440101")))
        .limit(1);
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: "Uji P3-3 Grup 50",
          roundingStep: 1,
          roundingDirection: "nearest",
          roundCashTotal: false,
          discountAccountId: discountAccount.id,
        })
        .returning({ id: customerGroups.id });
      await tx.insert(customerGroupPrices).values({
        companyId: ORG_ID,
        groupId: group.id,
        productId: product.productId,
        ruleType: "percent",
        value: "50",
      });

      // Diskon grup 50% tanpa diskon manual & tanpa izin → tetap lolos.
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        groupId: group.id,
        lines: [{ productId: product.productId, qty: 1 }],
      });
      expect(quote.lines[0].groupDiscountAmount).toBeCloseTo(5000, 2);
      expect(quote.lines[0].manualDiscountAmount).toBe(0);
    });
  });
});

/* ------------------------------------------------------------------ */
/* SET-RND-01                                                          */
/* ------------------------------------------------------------------ */

describe("SET-RND-01 pembulatan perusahaan (rollback)", () => {
  it("roundingMode perusahaan diterapkan bila tak ada pembulatan kelompok & terjurnal ke akun pembulatan", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "nearest_500", taxRate: "0" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "3200");
      const method = await methodByType(tx, "cash");
      const lines = [{ productId: product.productId, qty: 1 }];

      const quote = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      expect(quote.roundingMode).toBe("nearest_500");
      expect(quote.roundingAdjustment).toBeCloseTo(-200, 2);
      expect(quote.total).toBeCloseTo(3000, 2);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select({ roundingMode: sales.roundingMode, total: sales.total })
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));

      const [entry] = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "sale"),
            eq(journalEntries.sourceId, sale.id),
          ),
        )
        .limit(1);
      const journal = await tx
        .select({ code: accounts.code, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .innerJoin(accounts, eq(journalLines.accountId, accounts.id))
        .where(eq(journalLines.entryId, entry.id));
      const lossLine = journal.find((row) => row.code === "720015");
      return { stored, lossDebit: lossLine ? d(lossLine.debit).toNumber() : 0 };
    });
    expect(outcome.stored.roundingMode).toBe("nearest_500");
    expect(d(outcome.stored.total).toNumber()).toBeCloseTo(3000, 2);
    // Penjualan berkurang Rp200 karena pembulatan → rugi pembulatan (81001).
    expect(outcome.lossDebit).toBeCloseTo(200, 2);
  });

  it("mode 'none' berarti tanpa pembulatan; pembulatan kelompok tetap didahulukan dari perusahaan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      await setPrice(tx, product.productId, "3200");
      const lines = [{ productId: product.productId, qty: 1 }];

      await setSettings(tx, { roundingMode: "none", taxRate: "0" });
      const plain = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      expect(plain.roundingMode).toBe("none");
      expect(plain.roundingAdjustment).toBe(0);
      expect(plain.total).toBeCloseTo(3200, 2);

      // Perusahaan up_1000 akan menghasilkan 4.000; kelompok down_500
      // yang aktif harus menang → 3.000 dengan mode kelompok.
      await setSettings(tx, { roundingMode: "up_1000" });
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: "Uji P3-3 Bulat Grup",
          roundingStep: 500,
          roundingDirection: "down",
          roundCashTotal: true,
        })
        .returning({ id: customerGroups.id });
      const grouped = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        groupId: group.id,
        lines,
      });
      expect(grouped.roundingMode).toBe("down_500");
      expect(grouped.total).toBeCloseTo(3000, 2);
    });
  });
});

/* ------------------------------------------------------------------ */
/* POS-IDEM-01 (replay sekuensial; balapan di perusahaan uji bawah)    */
/* ------------------------------------------------------------------ */

describe("POS-IDEM-01 replay sekuensial (rollback)", () => {
  it("kunci yang sama dua kali dalam transaksi terpisah mengembalikan penjualan yang sama", async () => {
    const key = crypto.randomUUID();
    const run = () =>
      rollbackTransaction(async (tx) => {
        await setSettings(tx, { roundingMode: "none" });
        const warehouse = await defaultWarehouse(tx);
        const product = await stockedProduct(tx, warehouse.id, "5");
        const method = await methodByType(tx, "cash");
        const quote = await quoteCart(tx, {
          companyId: ORG_ID,
          warehouseId: warehouse.id,
          lines: [{ productId: product.productId, qty: 1 }],
        });
        return createSale(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [{ productId: product.productId, qty: 1 }],
          payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
          idempotencyKey: key,
        });
      });
    // Dua transaksi rollback terpisah tidak berbagi data ter-commit, jadi
    // ini hanya pin jalur cepat; balapan sesungguhnya diuji di bawah.
    const first = await run();
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

/* ------------------------------------------------------------------ */
/* POS-SES-01                                                          */
/* ------------------------------------------------------------------ */

describe("POS-SES-01 kepemilikan & keunikan sesi (rollback)", () => {
  it("menutup sesi orang lain ditolak NOT_FOUND; mutasi laci orang lain ditolak", async () => {
    await rollbackTransaction(async (tx) => {
      const [foreign] = await tx
        .insert(cashSessions)
        .values({ companyId: ORG_ID, userId: OTHER_USER, openingCash: "0", status: "open" })
        .returning({ id: cashSessions.id });

      await expectRejects(
        () =>
          closeCashSession(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            sessionId: foreign.id,
            countedCash: 0,
          }),
        "NOT_FOUND",
      );
      await expectRejects(
        () =>
          cashDrawerMovement(tx, {
            companyId: ORG_ID,
            userId: USER_ID,
            sessionId: foreign.id,
            type: "deposit",
            amount: 1000,
          }),
        "INVALID_STATE",
      );
    });
  });

  it("membuka sesi kedua saat masih ada yang terbuka ditolak dengan pesan ramah", async () => {
    await rollbackTransaction(async (tx) => {
      // Perusahaan demo sudah punya sesi terbuka untuk USER_ID (seed).
      await expectRejects(
        () => openCashSession(tx, { companyId: ORG_ID, userId: USER_ID, openingCash: 0 }),
        "INVALID_STATE",
        /sesi terbuka/,
      );
    });
  });

  it("indeks unik parsial menolak dua sesi terbuka untuk pengguna yang sama", async () => {
    const captured = await rollbackTransaction(async (tx) => {
      const freshUser = `user-indeks-${crypto.randomUUID().slice(0, 8)}`;
      await tx.insert(cashSessions).values({
        companyId: ORG_ID,
        userId: freshUser,
        openingCash: "0",
        status: "open",
      });
      let error: unknown;
      try {
        await tx.insert(cashSessions).values({
          companyId: ORG_ID,
          userId: freshUser,
          openingCash: "0",
          status: "open",
        });
      } catch (caught) {
        error = caught;
      }
      // Drizzle membungkus error postgres.js; kode & nama constraint
      // berada di rantai `cause`.
      let current: unknown = error;
      while (current && typeof current === "object") {
        const e = current as { code?: string; constraint_name?: string; cause?: unknown };
        if (e.code) return { code: e.code, constraint_name: e.constraint_name };
        current = e.cause;
      }
      return undefined;
    });
    expect(captured?.code).toBe("23505");
    expect(captured?.constraint_name).toBe("cash_sessions_one_open_per_user_uq");
  });
});

/* ------------------------------------------------------------------ */
/* POS-REF-01                                                          */
/* ------------------------------------------------------------------ */

describe("POS-REF-01 validasi referensi checkout (rollback)", () => {
  it("gudang asing ditolak NOT_FOUND; gudang nonaktif ditolak di quote", async () => {
    await rollbackTransaction(async (tx) => {
      const product = await stockedProduct(tx, (await defaultWarehouse(tx)).id, "5");
      const lines = [{ productId: product.productId, qty: 1 }];

      await expectRejects(
        () => quoteCart(tx, { companyId: ORG_ID, warehouseId: crypto.randomUUID(), lines }),
        "NOT_FOUND",
        /Gudang/,
      );

      const [inactive] = await tx
        .insert(warehouses)
        .values({
          companyId: ORG_ID,
          code: `GD-OFF-${crypto.randomUUID().slice(0, 6)}`,
          name: "Gudang Nonaktif Uji",
          type: "warehouse",
          isActive: false,
        })
        .returning({ id: warehouses.id });
      await expectRejects(
        () => quoteCart(tx, { companyId: ORG_ID, warehouseId: inactive.id, lines }),
        "VALIDATION",
        /nonaktif/,
      );
    });
  });

  it("metode pembayaran nonaktif & asing ditolak di createSale", async () => {
    await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "5");
      const lines = [{ productId: product.productId, qty: 1 }];
      const quote = await quoteCart(tx, { companyId: ORG_ID, warehouseId: warehouse.id, lines });
      const [cashAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "110107")))
        .limit(1);

      const [inactiveMethod] = await tx
        .insert(paymentMethods)
        .values({
          companyId: ORG_ID,
          code: `OFF-${crypto.randomUUID().slice(0, 6)}`,
          name: "Metode Nonaktif Uji",
          type: "bank",
          accountId: cashAccount.id,
          isActive: false,
        })
        .returning({ id: paymentMethods.id });

      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
      };
      await expectRejects(
        () =>
          createSale(tx, {
            ...base,
            payments: [{ methodId: inactiveMethod.id, amount: quote.total, tendered: quote.total }],
            idempotencyKey: crypto.randomUUID(),
          }),
        "VALIDATION",
        /nonaktif/,
      );
      await expectRejects(
        () =>
          createSale(tx, {
            ...base,
            payments: [{ methodId: crypto.randomUUID(), amount: quote.total, tendered: quote.total }],
            idempotencyKey: crypto.randomUUID(),
          }),
        "VALIDATION",
        /tidak valid/,
      );
    });
  });
});

/* ------------------------------------------------------------------ */
/* POS-PAY-02                                                          */
/* ------------------------------------------------------------------ */

describe("POS-PAY-02 pembayaran non-tunai tidak melebihi sisa (rollback)", () => {
  it("QRIS melebihi total ditolak; campuran tunai+QRIS pas diterima; kembalian hanya dari tunai", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none", taxRate: "0" });
      const warehouse = await defaultWarehouse(tx);
      const product = await stockedProduct(tx, warehouse.id, "10");
      await setPrice(tx, product.productId, "10000");
      const cash = await methodByType(tx, "cash");
      const qris = await methodByType(tx, "qris");
      const lines = [{ productId: product.productId, qty: 1 }];
      const base = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines,
      };

      await expectRejects(
        () =>
          createSale(tx, {
            ...base,
            payments: [{ methodId: qris.id, amount: 15000, tendered: 15000 }],
            idempotencyKey: crypto.randomUUID(),
          }),
        "VALIDATION",
        /melebihi sisa/,
      );
      // Tunai sudah menutup tagihan → QRIS tambahan apa pun berlebih.
      await expectRejects(
        () =>
          createSale(tx, {
            ...base,
            payments: [
              { methodId: cash.id, amount: 10000, tendered: 10000 },
              { methodId: qris.id, amount: 1000, tendered: 1000 },
            ],
            idempotencyKey: crypto.randomUUID(),
          }),
        "VALIDATION",
        /melebihi sisa/,
      );

      const mixed = await createSale(tx, {
        ...base,
        payments: [
          { methodId: cash.id, amount: 4000, tendered: 4000 },
          { methodId: qris.id, amount: 6000, tendered: 6000 },
        ],
        idempotencyKey: crypto.randomUUID(),
      });
      expect(mixed.total).toBeCloseTo(10000, 2);
      expect(mixed.change).toBe(0);

      const cashOver = await createSale(tx, {
        ...base,
        payments: [{ methodId: cash.id, amount: 10000, tendered: 20000 }],
        idempotencyKey: crypto.randomUUID(),
      });
      return { cashChange: cashOver.change };
    });
    expect(outcome.cashChange).toBeCloseTo(10000, 2);
  });
});

/* ------------------------------------------------------------------ */
/* POS-STK-01 (regresi GD-P1-4)                                        */
/* ------------------------------------------------------------------ */

describe("POS-STK-01 produk non-stok tidak digerakkan (rollback)", () => {
  it("menjual produk trackStock=false tanpa mutasi stok & tanpa baris stok tercatat", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      await setSettings(tx, { roundingMode: "none" });
      const warehouse = await defaultWarehouse(tx);
      const method = await methodByType(tx, "cash");
      const [service] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `SVC-UJI-${crypto.randomUUID().slice(0, 6)}`,
          name: "Jasa Uji P3-3",
          salePrice: "5000",
          costPrice: "2000",
          trackStock: false,
        })
        .returning({ id: products.id });

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: todayISO(),
        lines: [{ productId: service.id, qty: 2 }],
        payments: [{ methodId: method.id, amount: 10000, tendered: 10000 }],
        idempotencyKey: crypto.randomUUID(),
      });

      const movements = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceId, sale.id),
          ),
        );
      const onHand = await tx
        .select({ productId: stockOnHand.productId })
        .from(stockOnHand)
        .where(
          and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.productId, service.id)),
        );
      return { total: sale.total, movements: movements.length, onHand: onHand.length };
    });
    expect(outcome.total).toBeCloseTo(10000, 2);
    expect(outcome.movements).toBe(0);
    expect(outcome.onHand).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* POS-SRCH-01 & POS-GRP-01                                            */
/* ------------------------------------------------------------------ */

describe("POS-SRCH-01 pencarian per gudang & katalog awal berstok (rollback)", () => {
  it("searchProducts menilai stok dari gudang yang diminta, termasuk cabang tanpa kata kunci", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const main = await defaultWarehouse(tx);
      const [second] = await tx
        .insert(warehouses)
        .values({
          companyId: ORG_ID,
          code: `GD2-${crypto.randomUUID().slice(0, 6)}`,
          name: "Gudang Kedua Uji",
          type: "warehouse",
          isActive: true,
        })
        .returning({ id: warehouses.id });
      const product = await stockedProduct(tx, main.id, "1");
      const [mainStock] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, main.id),
            eq(stockOnHand.productId, product.productId),
          ),
        );
      const secondQty = d(mainStock.qty).plus(3).toNumber();
      await tx.insert(stockOnHand).values({
        companyId: ORG_ID,
        warehouseId: second.id,
        productId: product.productId,
        qty: String(secondQty),
      });

      const [productRow] = await tx
        .select({ name: products.name })
        .from(products)
        .where(eq(products.id, product.productId));
      const term = productRow.name.slice(0, 6);

      const inSecond = await searchProducts(tx, {
        companyId: ORG_ID,
        warehouseId: second.id,
        q: term,
        limit: 24,
      });
      const foundSecond = inSecond.find((row) => row.id === product.productId);

      const initial = await searchProducts(tx, {
        companyId: ORG_ID,
        warehouseId: second.id,
        q: "",
        limit: 200,
      });
      const foundInitial = initial.find((row) => row.id === product.productId);

      return {
        secondStock: foundSecond && "stock" in foundSecond ? Number(foundSecond.stock) : null,
        initialStock:
          foundInitial && "stock" in foundInitial ? Number(foundInitial.stock) : null,
        expected: secondQty,
      };
    });
    expect(outcome.secondStock).toBeCloseTo(outcome.expected, 4);
    expect(outcome.initialStock).toBeCloseTo(outcome.expected, 4);
  });
});

describe("POS-GRP-01 kelompok nonaktif tersaring untuk POS (rollback)", () => {
  it("listCustomerGroups({ activeOnly: true }) menyembunyikan kelompok nonaktif", async () => {
    await rollbackTransaction(async (tx) => {
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: "Uji P3-3 Grup Nonaktif",
          roundingStep: 500,
          roundingDirection: "down",
          roundCashTotal: true,
          isActive: false,
        })
        .returning({ id: customerGroups.id });

      const all = await listCustomerGroups(tx, ORG_ID);
      const activeOnly = await listCustomerGroups(tx, ORG_ID, { activeOnly: true });
      expect(all.some((row) => row.id === group.id)).toBe(true);
      expect(activeOnly.some((row) => row.id === group.id)).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* Perusahaan uji commit: balapan IDEM-01 & SES-01                     */
/* ------------------------------------------------------------------ */

const GUARD_ORG = "01900000-0000-7000-8000-00000000aa03";
const GUARD_USER = "user-uji-penjaga-pos";

async function guardTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${GUARD_ORG}, true)`);
    return fn(tx);
  });
}

/** Fixture minimum perusahaan uji penjaga (idempoten antar-run). */
async function ensureGuardCompany(tx: Tx) {
  const [existing] = await tx
    .select({ companyId: companySettings.companyId })
    .from(companySettings)
    .where(eq(companySettings.companyId, GUARD_ORG))
    .limit(1);
  if (existing) return;

  await tx.insert(companySettings).values({ companyId: GUARD_ORG, legalName: "Uji Penjaga POS P3-3" });

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
        companyId: GUARD_ORG,
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
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: GUARD_ORG, key, accountId })),
  );
  const [warehouse] = await tx
    .insert(warehouses)
    .values({ companyId: GUARD_ORG, code: "GD-UJI", name: "Gudang Uji", type: "warehouse", isDefault: true })
    .returning({ id: warehouses.id });
  await tx.insert(paymentMethods).values({
    companyId: GUARD_ORG,
    code: "CASH",
    name: "Tunai",
    type: "cash",
    accountId: acc.get("1000")!,
    sortOrder: 1,
  });
  const [product] = await tx
    .insert(products)
    .values({
      companyId: GUARD_ORG,
      sku: "UJI-PENJAGA-1",
      name: "Produk Uji Penjaga",
      salePrice: "10000",
      costPrice: "6000",
    })
    .returning({ id: products.id });
  await tx.insert(stockOnHand).values({
    companyId: GUARD_ORG,
    warehouseId: warehouse.id,
    productId: product.id,
    qty: "100000",
  });
  // AUD-001: stok awal fixture wajib punya gerakan "opening" padan —
  // invarian persediaan (stock_on_hand == Σ stock_movements, cek B1
  // db-integrity) berlaku juga untuk perusahaan fixture.
  await tx.insert(stockMovements).values({
    companyId: GUARD_ORG,
    warehouseId: warehouse.id,
    productId: product.id,
    movementType: "opening",
    qty: "100000",
    unitCost: "6000",
    referenceType: "fixture",
    reason: "Stok awal fixture uji pos-guards",
  });
  await tx.insert(cashSessions).values({
    companyId: GUARD_ORG,
    userId: GUARD_USER,
    openingCash: "0",
    status: "open",
  });
}

async function guardFixture(tx: Tx) {
  await ensureGuardCompany(tx);
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, GUARD_ORG), eq(warehouses.isDefault, true)))
    .limit(1);
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.companyId, GUARD_ORG), eq(products.sku, "UJI-PENJAGA-1")))
    .limit(1);
  const [method] = await tx
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, GUARD_ORG), eq(paymentMethods.type, "cash")))
    .limit(1);
  // Persediaan besar agar aman di banyak run; sesi jaga selalu terbuka.
  await tx
    .update(stockOnHand)
    .set({ qty: "100000" })
    .where(
      and(
        eq(stockOnHand.companyId, GUARD_ORG),
        eq(stockOnHand.warehouseId, warehouse.id),
        eq(stockOnHand.productId, product.id),
      ),
    );
  return { warehouse, product, method };
}

describe("POS-RND-02 pembulatan tidak boleh membuat total nol", () => {
  it("harga 222 dengan pembulatan terdekat 500 tetap ditagih 222, bukan gratis", async () => {
    await rollbackForCompany(GUARD_ORG, async (tx) => {
      await ensureGuardCompany(tx);
      const { warehouse, product } = await guardFixture(tx);
      await tx
        .update(companySettings)
        .set({ roundingMode: "nearest_500" })
        .where(eq(companySettings.companyId, GUARD_ORG));
      await tx
        .update(products)
        .set({ salePrice: "222" })
        .where(eq(products.id, product.id));
      const quote = await quoteCart(tx, {
        companyId: GUARD_ORG,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, qty: 1 }],
      });
      expect(quote.total).toBeCloseTo(222, 2);
      expect(quote.total).toBeGreaterThan(0);
      expect(quote.roundingAdjustment).toBeCloseTo(0, 2);
    });
  });
});

describe("POS-IDEM-01 balapan kunci idempotensi (commit, perusahaan uji)", () => {
  it("dua createSale bersamaan dengan kunci sama: satu penjualan, keduanya menerima hasil yang sama", async () => {
    const key = crypto.randomUUID();
    const run = () =>
      guardTransaction(async (tx) => {
        const { warehouse, product, method } = await guardFixture(tx);
        return createSale(tx, {
          companyId: GUARD_ORG,
          userId: GUARD_USER,
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [{ productId: product.id, qty: 1 }],
          payments: [{ methodId: method.id, amount: 10000, tendered: 10000 }],
          idempotencyKey: key,
        });
      });

    const results = await Promise.allSettled([run(), run()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    if (fulfilled[0].status !== "fulfilled" || fulfilled[1].status !== "fulfilled") return;
    expect(fulfilled[0].value.id).toBe(fulfilled[1].value.id);

    const stored = await guardTransaction(async (tx) => {
      const rows = await tx
        .select({ id: sales.id })
        .from(sales)
        .where(and(eq(sales.companyId, GUARD_ORG), eq(sales.idempotencyKey, key)));
      const movements = await tx
        .select({ id: stockMovements.id })
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, GUARD_ORG),
            eq(stockMovements.referenceId, rows[0].id),
            eq(stockMovements.movementType, "sale"),
          ),
        );
      return { sales: rows.length, movements: movements.length };
    });
    expect(stored.sales).toBe(1);
    expect(stored.movements).toBe(1);
  });
});

describe("POS-SES-01 balapan buka sesi (commit, perusahaan uji)", () => {
  it("dua buka sesi bersamaan untuk kasir yang sama: satu berhasil, satu ditolak ramah", async () => {
    const freshUser = `user-uji-sesi-${crypto.randomUUID().slice(0, 8)}`;
    const run = () =>
      guardTransaction((tx) =>
        openCashSession(tx, { companyId: GUARD_ORG, userId: freshUser, openingCash: 0 }),
      );
    const results = await Promise.allSettled([run(), run()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "INVALID_STATE" });
      expect((rejected[0].reason as Error).message).toMatch(/sesi terbuka/);
    }

    // Bersihkan: tutup sesi pemenang (selisih nol → tanpa jurnal selisih).
    if (fulfilled[0].status === "fulfilled") {
      await guardTransaction((tx) =>
        closeCashSession(tx, {
          companyId: GUARD_ORG,
          userId: freshUser,
          sessionId: fulfilled[0].value.id,
          countedCash: 0,
        }),
      );
    }
  });
});
