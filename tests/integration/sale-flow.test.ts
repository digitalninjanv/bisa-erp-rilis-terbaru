import { describe, expect, it } from "vitest";
import { and, asc, desc, eq, gt } from "drizzle-orm";

import {
  accounts,
  cashMovements,
  cashSessions,
  companySettings,
  customerGroupPrices,
  customerGroups,
  journalEntries,
  journalLines,
  paymentMethods,
  products,
  salePayments,
  sales,
  stockOnHand,
  warehouses,
} from "@/db/schema";
import { createSale, quoteCart, voidSale } from "@/server/pos";
import { postJournal, reverseJournalEntry } from "@/server/accounting";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";


const rollbackTransaction = makeRollbackTransaction(ORG_ID);

describe("POS sale flow", () => {
  it("sells, records journals and stock, is idempotent, and voids correctly", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      expect(warehouse).toBeDefined();

      const [stockRow] = await tx
        .select({
          productId: stockOnHand.productId,
          qty: stockOnHand.qty,
          name: products.name,
          salePrice: products.salePrice,
        })
        .from(stockOnHand)
        .innerJoin(products, eq(stockOnHand.productId, products.id))
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            gt(stockOnHand.qty, "5"),
          ),
        )
        .orderBy(asc(products.sku))
        .limit(1);
      expect(stockRow).toBeDefined();

      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
        .limit(1);
      expect(method).toBeDefined();

      const [session] = await tx
        .select()
        .from(cashSessions)
        .where(
          and(
            eq(cashSessions.companyId, ORG_ID),
            eq(cashSessions.userId, USER_ID),
            eq(cashSessions.status, "open"),
          ),
        )
        .orderBy(desc(cashSessions.openedAt))
        .limit(1);
      expect(session).toBeDefined();

      const qty = 2;
      const before = d(stockRow.qty);
      const lines = [{ productId: stockRow.productId, qty }];

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        customerId: null,
        lines,
      });
      expect(quote.total).toBeGreaterThan(0);

      const key = crypto.randomUUID();
      // Tanggal dokumen sengaja di awal bulan berjalan (bukan hari ini)
      // agar pembalik void terbukti memakai tanggal asal, bukan today.
      const saleDate = `${todayISO().slice(0, 8)}01`;
      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: saleDate,
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total + 10_000 }],
        idempotencyKey: key,
      });

      expect(sale.total).toBeCloseTo(quote.total, 2);
      expect(sale.change).toBeCloseTo(10_000, 2);

      const [afterSale] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            eq(stockOnHand.productId, stockRow.productId),
          ),
        );
      expect(d(afterSale.qty).toNumber()).toBeCloseTo(before.minus(qty).toNumber(), 4);

      const payments = await tx
        .select()
        .from(salePayments)
        .where(and(eq(salePayments.companyId, ORG_ID), eq(salePayments.saleId, sale.id)));
      expect(payments).toHaveLength(1);
      expect(Number(payments[0].amount)).toBeCloseTo(quote.total, 2);

      const saleJournal = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "sale"),
            eq(journalEntries.sourceId, sale.id),
          ),
        );
      expect(saleJournal).toHaveLength(1);
      const saleLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, saleJournal[0].id));
      const debit = saleLines.reduce((acc, row) => acc.plus(d(row.debit)), d(0));
      const credit = saleLines.reduce((acc, row) => acc.plus(d(row.credit)), d(0));
      expect(debit.toFixed(4)).toBe(credit.toFixed(4));

      const saleCash = await tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.companyId, ORG_ID),
            eq(cashMovements.sessionId, session.id),
            eq(cashMovements.type, "sale"),
            eq(cashMovements.referenceId, sale.id),
          ),
        );
      expect(saleCash.length).toBe(1);
      expect(Number(saleCash[0].amount)).toBeCloseTo(quote.total, 2);

      const replay = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        date: saleDate,
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total + 10_000 }],
        idempotencyKey: key,
      });
      expect(replay.id).toBe(sale.id);
      const [afterReplay] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            eq(stockOnHand.productId, stockRow.productId),
          ),
        );
      expect(d(afterReplay.qty).toFixed(4)).toBe(d(afterSale.qty).toFixed(4));

      await voidSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        saleId: sale.id,
        reason: "Uji otomatis void",
      });

      const [voided] = await tx
        .select()
        .from(sales)
        .where(and(eq(sales.companyId, ORG_ID), eq(sales.id, sale.id)));
      expect(voided.status).toBe("void");

      const [afterVoid] = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(
          and(
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            eq(stockOnHand.productId, stockRow.productId),
          ),
        );
      expect(d(afterVoid.qty).toFixed(4)).toBe(before.toFixed(4));

      const reversal = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_ID),
            eq(journalEntries.sourceType, "sale_reversal"),
            eq(journalEntries.sourceId, sale.id),
          ),
        );
      expect(reversal).toHaveLength(1);
      expect(String(reversal[0].date).slice(0, 10)).toBe(saleDate);
      const reversalLines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, reversal[0].id));
      const reversalDebit = reversalLines.reduce((acc, row) => acc.plus(d(row.debit)), d(0));
      const reversalCredit = reversalLines.reduce((acc, row) => acc.plus(d(row.credit)), d(0));
      expect(reversalDebit.toFixed(4)).toBe(reversalCredit.toFixed(4));

      return { saleId: sale.id, total: quote.total, product: stockRow.productId };
    });

    expect(outcome.saleId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("applies a product-specific customer group discount and a POS rounding override", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [product] = await tx
        .select({
          id: products.id,
          name: products.name,
          salePrice: products.salePrice,
        })
        .from(products)
        .innerJoin(stockOnHand, eq(stockOnHand.productId, products.id))
        .where(
          and(
            eq(products.companyId, ORG_ID),
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            gt(stockOnHand.qty, "10"),
          ),
        )
        .orderBy(asc(products.sku))
        .limit(1);
      const [method] = await tx
        .select()
        .from(paymentMethods)
        .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
        .limit(1);

      const [discountAccount] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.code, "440101")))
        .limit(1);

      const suffix = crypto.randomUUID().slice(0, 8);
      const [group] = await tx
        .insert(customerGroups)
        .values({
          companyId: ORG_ID,
          name: `Mahasiswa ${suffix}`,
          roundingStep: 500,
          roundingDirection: "down",
          roundCashTotal: true,
          discountAccountId: discountAccount.id,
        })
        .returning({ id: customerGroups.id });

      await tx.insert(customerGroupPrices).values({
        companyId: ORG_ID,
        groupId: group.id,
        productId: product.id,
        ruleType: "percent",
        value: "10",
      });

      const lines = [{ productId: product.id, qty: 3 }];
      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        groupId: group.id,
        lines,
      });

      expect(quote.customerGroupId).toBe(group.id);
      expect(quote.roundingMode).toBe("down_500");
      const line = quote.lines[0];
      const expectedGroupPrice = Math.floor((line.unitPrice * 0.9) / 500) * 500;
      expect(line.groupUnitPrice).toBe(expectedGroupPrice);
      expect(line.groupDiscountAmount).toBeCloseTo((line.unitPrice - expectedGroupPrice) * 3, 2);
      expect(line.discountAmount).toBeCloseTo(line.groupDiscountAmount, 2);
      expect(quote.total % 500).toBe(0);

      const sale = await createSale(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        groupId: group.id,
        date: todayISO(),
        lines,
        payments: [{ methodId: method.id, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });

      const [stored] = await tx
        .select({ roundingMode: sales.roundingMode, groupId: sales.customerGroupId, total: sales.total })
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
        .select({ accountId: journalLines.accountId, debit: journalLines.debit })
        .from(journalLines)
        .where(eq(journalLines.entryId, entry.id));
      const discountLine = journal.find(
        (row) => row.accountId === discountAccount.id && Number(row.debit) > 0,
      );
      return { stored, quoteTotal: quote.total, groupId: group.id, discountLine: Boolean(discountLine) };
    });

    expect(outcome.stored.roundingMode).toBe("down_500");
    expect(outcome.stored.groupId).toBe(outcome.groupId);
    expect(outcome.discountLine).toBe(true);
    expect(Number(outcome.stored.total)).toBeCloseTo(outcome.quoteTotal, 2);
  });

  it("uses normal prices when no group is selected", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      // SET-RND-01: perusahaan demo memasang roundingMode nearest_500;
      // test ini menilai harga normal murni, jadi pembulatan perusahaan
      // dimatikan di dalam transaksi uji (perilaku barunya diuji khusus
      // di pos-guards.test.ts).
      await tx
        .update(companySettings)
        .set({ roundingMode: "none" })
        .where(eq(companySettings.companyId, ORG_ID));
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id, salePrice: products.salePrice })
        .from(products)
        .innerJoin(stockOnHand, eq(stockOnHand.productId, products.id))
        .where(
          and(
            eq(products.companyId, ORG_ID),
            eq(stockOnHand.companyId, ORG_ID),
            eq(stockOnHand.warehouseId, warehouse.id),
            gt(stockOnHand.qty, "2"),
          ),
        )
        .orderBy(asc(products.sku))
        .limit(1);

      const quote = await quoteCart(tx, {
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        lines: [{ productId: product.id, qty: 2 }],
      });
      return { quote, salePrice: Number(product.salePrice) };
    });

    expect(outcome.quote.roundingMode).toBe("none");
    expect(outcome.quote.discountTotal).toBe(0);
    expect(outcome.quote.lines[0].unitPrice).toBe(outcome.salePrice);
    expect(outcome.quote.lines[0].groupUnitPrice).toBe(outcome.salePrice);
    expect(outcome.quote.lines[0].groupDiscountAmount).toBe(0);
    expect(outcome.quote.total).toBeCloseTo(outcome.quote.subtotal, 2);
  });

  it("rejects selling without an open cash session", async () => {
    await expect(
      rollbackTransaction(async (tx) => {
        const [warehouse] = await tx
          .select()
          .from(warehouses)
          .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
          .limit(1);
        // Join products + deterministic order (same pick as the first test
        // in this file): a bare stock_on_hand scan can land on a leftover
        // row whose product master another suite's cleanup removed, and
        // the sale then fails on the product instead of the session.
        const [stockRow] = await tx
          .select({ productId: stockOnHand.productId })
          .from(stockOnHand)
          .innerJoin(products, eq(stockOnHand.productId, products.id))
          .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.warehouseId, warehouse.id), gt(stockOnHand.qty, "1")))
          .orderBy(asc(products.sku))
          .limit(1);
        const [method] = await tx
          .select()
          .from(paymentMethods)
          .where(and(eq(paymentMethods.companyId, ORG_ID), eq(paymentMethods.type, "cash")))
          .limit(1);
        await createSale(tx, {
          companyId: ORG_ID,
          userId: crypto.randomUUID(),
          warehouseId: warehouse.id,
          date: todayISO(),
          lines: [{ productId: stockRow.productId, qty: 1 }],
          payments: [{ methodId: method.id, amount: 1_000_000, tendered: 1_000_000 }],
          idempotencyKey: crypto.randomUUID(),
        });
      }),
    ).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringMatching(/sesi kas/i) });
  });
});


describe("journal corrections", () => {
  it("creates a linked reversal and rejects a second reversal", async () => {
    const outcome = await rollbackTransaction(async (tx) => {
      const rows = await tx
        .select({ id: accounts.id, code: accounts.code })
        .from(accounts)
        .where(eq(accounts.companyId, ORG_ID));
      const cash = rows.find((row) => row.code === "110107");
      const equity = rows.find((row) => row.code === "300001");
      expect(cash).toBeDefined();
      expect(equity).toBeDefined();

      const original = await postJournal(tx, {
        companyId: ORG_ID,
        date: todayISO(),
        description: "Uji jurnal pembalik",
        sourceType: "manual",
        createdBy: USER_ID,
        lines: [
          { accountId: cash!.id, debit: 1_000, description: "Kas" },
          { accountId: equity!.id, credit: 1_000, description: "Modal" },
        ],
      });

      const { reversal } = await reverseJournalEntry(tx, {
        companyId: ORG_ID,
        entryId: original.id,
        date: todayISO(),
        description: "Koreksi uji",
        createdBy: USER_ID,
      });

      const [stored] = await tx
        .select()
        .from(journalEntries)
        .where(and(eq(journalEntries.companyId, ORG_ID), eq(journalEntries.id, reversal.id)));
      expect(stored.reversalOfId).toBe(original.id);
      expect(stored.status).toBe("posted");

      const lines = await tx
        .select()
        .from(journalLines)
        .where(eq(journalLines.entryId, reversal.id));
      expect(lines).toHaveLength(2);
      const debit = lines.reduce((acc, row) => acc + Number(row.debit), 0);
      const credit = lines.reduce((acc, row) => acc + Number(row.credit), 0);
      expect(debit).toBeCloseTo(credit, 2);

      let error: unknown;
      try {
        await reverseJournalEntry(tx, {
          companyId: ORG_ID,
          entryId: original.id,
          date: todayISO(),
          createdBy: USER_ID,
        });
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: "CONFLICT" });
      return { reversalId: reversal.id };
    });

    expect(outcome.reversalId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
