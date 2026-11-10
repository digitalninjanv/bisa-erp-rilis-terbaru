import { describe, expect, it } from "vitest";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalLines,
  products,
  purchaseAdvanceAllocations,
  purchaseAdvances,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { createReceipt, voidReceipt } from "@/server/inventory";
import {
  createPurchaseAdvance,
  listOpenPurchaseAdvancesForSupplier,
  voidPurchaseAdvance,
} from "@/server/purchase-advances";
import { listPayables } from "@/server/reports";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const rollbackTransaction = makeRollbackTransaction(ORG_ID);

async function fixture(tx: Tx) {
  const [supplier] = await tx
    .select()
    .from(suppliers)
    .where(eq(suppliers.companyId, ORG_ID))
    .limit(1);
  const [warehouse] = await tx
    .select()
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
    .limit(1);
  const map = await getAccountMap(tx, ORG_ID);
  const suffix = crypto.randomUUID().slice(0, 8);
  const [product] = await tx
    .insert(products)
    .values({
      companyId: ORG_ID,
      sku: `TST-DP-${suffix}`,
      name: `Produk DP ${suffix}`,
      costPrice: "10000",
      salePrice: "15000",
    })
    .returning({ id: products.id });
  return { supplier: supplier!, warehouse: warehouse!, product: product!, map };
}

async function advance(
  tx: Tx,
  input: { supplierId: string; paymentAccountId: string; amount: string },
) {
  return createPurchaseAdvance(tx, {
    companyId: ORG_ID,
    userId: USER_ID,
    supplierId: input.supplierId,
    date: todayISO(),
    amount: input.amount,
    paymentAccountId: input.paymentAccountId,
    taxInvoiceNumber: "FP-DP-UJI",
  });
}

async function journalFor(tx: Tx, sourceId: string, sourceType: string) {
  const [entry] = await tx
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.companyId, ORG_ID),
        eq(journalEntries.sourceId, sourceId),
        eq(journalEntries.sourceType, sourceType),
        isNull(journalEntries.reversalOfId),
        ne(journalEntries.status, "void"),
      ),
    )
    .limit(1);
  if (!entry) return null;
  const lines = await tx
    .select()
    .from(journalLines)
    .where(eq(journalLines.entryId, entry.id));
  return { entry, lines };
}

function accountAmount(
  lines: { accountId: string; debit: string; credit: string }[],
  accountId: string,
) {
  return lines
    .filter((line) => line.accountId === accountId)
    .reduce(
      (acc, line) => ({ debit: acc.debit.plus(d(line.debit)), credit: acc.credit.plus(d(line.credit)) }),
      { debit: d(0), credit: d(0) },
    );
}

describe("Uang muka pembelian (DP)", () => {
  it("membuat dokumen + jurnal Dr uang muka / Cr kas", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, map } = await fixture(tx);
      const created = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "100000",
      });
      const [row] = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.id, created.id));
      expect(d(row.amount).toFixed(2)).toBe("100000.00");
      expect(d(row.remainingAmount).toFixed(2)).toBe("100000.00");
      expect(row.status).toBe("open");

      const journal = await journalFor(tx, created.id, "purchase_advance");
      expect(journal).not.toBeNull();
      const advanceAccount = await accountAmount(journal!.lines, map.purchase_advance);
      expect(advanceAccount.debit.toFixed(2)).toBe("100000.00");
      expect(accountAmount(journal!.lines, map.cash).credit.toFixed(2)).toBe("100000.00");
    });
  });

  it("memotong uang muka saat penerimaan dan menyisakan utang", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, warehouse, product, map } = await fixture(tx);
      const created = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "100000",
      });
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        advanceAmount: "60000",
        lines: [{ productId: product.id, qty: 10, unitCost: 10000 }],
      });

      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(d(stored.paidAmount).toFixed(2)).toBe("60000.00");
      expect(stored.paymentStatus).toBe("partial");

      const [advanceRow] = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.id, created.id));
      expect(d(advanceRow.remainingAmount).toFixed(2)).toBe("40000.00");
      expect(advanceRow.status).toBe("partial");

      const allocations = await tx
        .select()
        .from(purchaseAdvanceAllocations)
        .where(eq(purchaseAdvanceAllocations.receiptId, receipt.id));
      expect(allocations).toHaveLength(1);
      expect(d(allocations[0].amount).toFixed(2)).toBe("60000.00");

      const journal = await journalFor(tx, receipt.id, "purchase");
      expect(journal).not.toBeNull();
      expect(accountAmount(journal!.lines, map.inventory).debit.toFixed(2)).toBe("100000.00");
      expect(accountAmount(journal!.lines, map.purchase_advance).credit.toFixed(2)).toBe("60000.00");
      expect(accountAmount(journal!.lines, map.payable).credit.toFixed(2)).toBe("40000.00");

      const payables = await listPayables(tx, ORG_ID);
      expect(payables.find((row) => row.id === receipt.id)?.outstanding).toBe(40000);
    });
  });

  it("uang muka + PPN: PPN tetap masuk, utang hanya sisa tagihan", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, warehouse, product, map } = await fixture(tx);
      await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "60000",
      });
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        taxPercent: "11",
        advanceAmount: "60000",
        lines: [{ productId: product.id, qty: 10, unitCost: 10000 }],
      });
      const [stored] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(d(stored.total).toFixed(2)).toBe("111000.00");
      expect(d(stored.paidAmount).toFixed(2)).toBe("60000.00");
      expect(stored.paymentStatus).toBe("partial");
      const journal = await journalFor(tx, receipt.id, "purchase");
      expect(journal).not.toBeNull();
      expect(accountAmount(journal!.lines, map.inventory).debit.toFixed(2)).toBe("100000.00");
      expect(accountAmount(journal!.lines, map.tax_input).debit.toFixed(2)).toBe("11000.00");
      expect(accountAmount(journal!.lines, map.purchase_advance).credit.toFixed(2)).toBe("60000.00");
      expect(accountAmount(journal!.lines, map.payable).credit.toFixed(2)).toBe("51000.00");
    });
  });

  it("memakai FIFO dari uang muka terlama", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, warehouse, product, map } = await fixture(tx);
      const first = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "30000",
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const second = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "50000",
      });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        advanceAmount: "60000",
        lines: [{ productId: product.id, qty: 6, unitCost: 10000 }],
      });
      const rows = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.supplierId, supplier.id));
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(d(byId.get(first.id)!.remainingAmount).toFixed(2)).toBe("0.00");
      expect(byId.get(first.id)!.status).toBe("used");
      expect(d(byId.get(second.id)!.remainingAmount).toFixed(2)).toBe("20000.00");
      expect(byId.get(second.id)!.status).toBe("partial");
    });
  });

  it("menolak potongan melebihi saldo uang muka", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, warehouse, product, map } = await fixture(tx);
      await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "10000",
      });
      await expect(
        createReceipt(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          warehouseId: warehouse.id,
          supplierId: supplier.id,
          source: "purchase",
          date: todayISO(),
          advanceAmount: "20000",
          lines: [{ productId: product.id, qty: 2, unitCost: 10000 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
    });
  });

  it("void penerimaan mengembalikan saldo uang muka", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, warehouse, product, map } = await fixture(tx);
      const created = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "100000",
      });
      const receipt = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        advanceAmount: "100000",
        lines: [{ productId: product.id, qty: 10, unitCost: 10000 }],
      });
      const [paid] = await tx
        .select()
        .from(stockReceipts)
        .where(eq(stockReceipts.id, receipt.id));
      expect(paid.paymentStatus).toBe("paid");

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: receipt.id,
        date: todayISO(),
        reason: "Uji pembatalan penerimaan DP",
      });

      const [restored] = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.id, created.id));
      expect(d(restored.remainingAmount).toFixed(2)).toBe("100000.00");
      expect(restored.status).toBe("open");
      const allocations = await tx
        .select()
        .from(purchaseAdvanceAllocations)
        .where(eq(purchaseAdvanceAllocations.receiptId, receipt.id));
      expect(allocations).toHaveLength(0);
    });
  });

  it("void uang muka yang sudah dipakai ditolak; yang belum dipakai dibalik", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, map } = await fixture(tx);
      const unused = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "50000",
      });
      await voidPurchaseAdvance(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        advanceId: unused.id,
        date: todayISO(),
        reason: "DP salah input",
      });
      const [voided] = await tx
        .select()
        .from(purchaseAdvances)
        .where(eq(purchaseAdvances.id, unused.id));
      expect(voided.status).toBe("void");

      const used = await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "30000",
      });
      // Pakai sebagian lewat penerimaan, lalu coba void.
      const { warehouse, product } = await fixture(tx);
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date: todayISO(),
        advanceAmount: "10000",
        lines: [{ productId: product.id, qty: 1, unitCost: 10000 }],
      });
      await expect(
        voidPurchaseAdvance(tx, {
          companyId: ORG_ID,
          userId: USER_ID,
          advanceId: used.id,
          date: todayISO(),
          reason: "Coba batalkan DP terpakai",
        }),
      ).rejects.toMatchObject({ code: "INVALID_STATE" });
    });
  });

  it("daftar saldo terbuka hanya mengembalikan sisa yang bisa dipakai", async () => {
    await rollbackTransaction(async (tx) => {
      const { supplier, map } = await fixture(tx);
      await advance(tx, {
        supplierId: supplier.id,
        paymentAccountId: map.cash,
        amount: "25000",
      });
      const open = await listOpenPurchaseAdvancesForSupplier(tx, ORG_ID, supplier.id);
      expect(open.some((row) => d(row.remainingAmount).eq(25000))).toBe(true);
    });
  });
});
