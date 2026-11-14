import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { withCompany } from "@/db/tenant";
import {
  accounts,
  accountMonthlyBalances,
  categories,
  journalEntries,
  journalLines,
  products,
  productPackagings,
  saleLines,
  salePayments,
  saleReturnLines,
  saleReturns,
  sales,
  purchaseOrderLines,
  purchaseOrders,
  stockReceiptLines,
  stockReceipts,
  stockBatches,
  stockMovements,
  stockOnHand,
  suppliers,
  units,
  warehouses,
} from "@/db/schema";

const COMPANY_A = "01900000-0000-7000-8000-00000000fca1";
const COMPANY_B = "01900000-0000-7000-8000-00000000fcb1";
const suffix = randomUUID();
const skuPrefix = `TENANT-FK-${suffix}`;

let categoryA = "";
let categoryB = "";
let unitB = "";
let supplierA = "";
let supplierB = "";
let warehouseA = "";
let warehouseB = "";
let accountA = "";
let accountB = "";
let purchaseOrderA = "";
let purchaseOrderB = "";
let productA = "";
let productB = "";
let packagingA = "";
let packagingB = "";
let receiptA = "";
let stockBatchA = "";
let stockBatchB = "";
let journalEntryA = "";
let journalEntryB = "";
let saleA = "";
let saleB = "";
let saleLineA = "";
let saleLineB = "";
let saleReturnA = "";
let saleReturnB = "";

beforeAll(async () => {
  const [a] = await withCompany(COMPANY_A, (tx) =>
    tx
      .insert(categories)
      .values({ companyId: COMPANY_A, name: `Uji kategori A ${suffix}` })
      .returning({ id: categories.id }),
  );
  categoryA = a.id;

  await withCompany(COMPANY_A, async (tx) => {
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: COMPANY_A, code: `TFA-${suffix.slice(0, 12)}`, name: `Pemasok A ${suffix}` })
      .returning({ id: suppliers.id });
    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: COMPANY_A, code: `TFA-${suffix.slice(0, 12)}`, name: `Gudang A ${suffix}` })
      .returning({ id: warehouses.id });
    const [account] = await tx
      .insert(accounts)
      .values({
        companyId: COMPANY_A,
        code: `TFA-${suffix.slice(0, 12)}`,
        name: `Akun A ${suffix}`,
        type: "asset",
        normalBalance: "debit",
      })
      .returning({ id: accounts.id });
    const [product] = await tx
      .insert(products)
      .values({ companyId: COMPANY_A, sku: `${skuPrefix}-base-a`, name: `Produk A ${suffix}` })
      .returning({ id: products.id });
    const [packaging] = await tx
      .insert(productPackagings)
      .values({ companyId: COMPANY_A, productId: product.id, name: `Dus A ${suffix}`, isi: "2" })
      .returning({ id: productPackagings.id });
    const [sale] = await tx
      .insert(sales)
      .values({ companyId: COMPANY_A, warehouseId: warehouse.id, number: `TFA-SALE-${suffix}`, date: "2026-11-14", cashierId: "tenant-fk-test" })
      .returning({ id: sales.id });
    const [saleLine] = await tx
      .insert(saleLines)
      .values({ companyId: COMPANY_A, saleId: sale.id, productId: product.id, packagingId: packaging.id, lineNo: 1, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Produk uji A", productSku: `${skuPrefix}-sale-a`, qtyInput: "1" })
      .returning({ id: saleLines.id });
    const [saleReturn] = await tx
      .insert(saleReturns)
      .values({ companyId: COMPANY_A, saleId: sale.id, number: `TFA-RETURN-${suffix}`, date: "2026-11-14", reason: "Uji tenant" })
      .returning({ id: saleReturns.id });
    await tx.insert(saleReturnLines).values({ companyId: COMPANY_A, returnId: saleReturn.id, saleLineId: saleLine.id, productId: product.id, packagingId: packaging.id, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Produk uji A", qtyInput: "1" });
    await tx.insert(salePayments).values({ companyId: COMPANY_A, saleId: sale.id, methodId: randomUUID(), amount: "10000" });
    const [batch] = await tx
      .insert(stockBatches)
      .values({ companyId: COMPANY_A, productId: product.id, warehouseId: warehouse.id, batchNumber: `BATCH-A-${suffix}` })
      .returning({ id: stockBatches.id });
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({ companyId: COMPANY_A, number: `TFA-JE-${suffix}`, date: "2026-11-14", description: "Uji tenant", status: "draft" })
      .returning({ id: journalEntries.id });
    await tx.insert(journalLines).values([
      { companyId: COMPANY_A, entryId: journalEntry.id, accountId: account.id, lineNo: 1, debit: "1" },
      { companyId: COMPANY_A, entryId: journalEntry.id, accountId: account.id, lineNo: 2, credit: "1" },
    ]);
    const [order] = await tx
      .insert(purchaseOrders)
      .values({ companyId: COMPANY_A, number: `TFA-${suffix}`, supplierId: supplier.id, date: "2026-11-14" })
      .returning({ id: purchaseOrders.id });
    const [receipt] = await tx
      .insert(stockReceipts)
      .values({
        companyId: COMPANY_A,
        number: `TFA-${suffix}`,
        date: "2026-11-14",
        warehouseId: warehouse.id,
        purchaseOrderId: order.id,
        supplierId: supplier.id,
        paymentAccountId: account.id,
      })
      .returning({ id: stockReceipts.id });
    supplierA = supplier.id;
    warehouseA = warehouse.id;
    accountA = account.id;
    purchaseOrderA = order.id;
    productA = product.id;
    packagingA = packaging.id;
    stockBatchA = batch.id;
    receiptA = receipt.id;
    journalEntryA = journalEntry.id;
    saleA = sale.id;
    saleLineA = saleLine.id;
    saleReturnA = saleReturn.id;
  });

  await withCompany(COMPANY_B, async (tx) => {
    const [category] = await tx
      .insert(categories)
      .values({ companyId: COMPANY_B, name: `Uji kategori B ${suffix}` })
      .returning({ id: categories.id });
    const [unit] = await tx
      .insert(units)
      .values({ companyId: COMPANY_B, code: `TFK${suffix.slice(0, 12)}`, name: `Uji unit ${suffix}` })
      .returning({ id: units.id });
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId: COMPANY_B, code: `TFK-${suffix.slice(0, 12)}`, name: `Uji pemasok ${suffix}` })
      .returning({ id: suppliers.id });
    const [warehouse] = await tx
      .insert(warehouses)
      .values({ companyId: COMPANY_B, code: `TFK-${suffix.slice(0, 12)}`, name: `Uji gudang ${suffix}` })
      .returning({ id: warehouses.id });
    const [account] = await tx
      .insert(accounts)
      .values({
        companyId: COMPANY_B,
        code: `TFK-${suffix.slice(0, 12)}`,
        name: `Uji akun ${suffix}`,
        type: "asset",
        normalBalance: "debit",
      })
      .returning({ id: accounts.id });
    const [product] = await tx
      .insert(products)
      .values({ companyId: COMPANY_B, sku: `${skuPrefix}-base-b`, name: `Produk B ${suffix}` })
      .returning({ id: products.id });
    const [packaging] = await tx
      .insert(productPackagings)
      .values({ companyId: COMPANY_B, productId: product.id, name: `Dus B ${suffix}`, isi: "2" })
      .returning({ id: productPackagings.id });
    const [sale] = await tx
      .insert(sales)
      .values({ companyId: COMPANY_B, warehouseId: warehouse.id, number: `TFB-SALE-${suffix}`, date: "2026-11-14", cashierId: "tenant-fk-test" })
      .returning({ id: sales.id });
    const [saleLine] = await tx
      .insert(saleLines)
      .values({ companyId: COMPANY_B, saleId: sale.id, productId: product.id, packagingId: packaging.id, lineNo: 1, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Produk uji B", productSku: `${skuPrefix}-sale-b`, qtyInput: "1" })
      .returning({ id: saleLines.id });
    const [saleReturn] = await tx
      .insert(saleReturns)
      .values({ companyId: COMPANY_B, saleId: sale.id, number: `TFB-RETURN-${suffix}`, date: "2026-11-14", reason: "Uji tenant" })
      .returning({ id: saleReturns.id });
    const [batch] = await tx
      .insert(stockBatches)
      .values({ companyId: COMPANY_B, productId: product.id, warehouseId: warehouse.id, batchNumber: `BATCH-B-${suffix}` })
      .returning({ id: stockBatches.id });
    const [journalEntry] = await tx
      .insert(journalEntries)
      .values({ companyId: COMPANY_B, number: `TFK-JE-${suffix}`, date: "2026-11-14", description: "Uji tenant", status: "draft" })
      .returning({ id: journalEntries.id });
    await tx.insert(journalLines).values([
      { companyId: COMPANY_B, entryId: journalEntry.id, accountId: account.id, lineNo: 1, debit: "1" },
      { companyId: COMPANY_B, entryId: journalEntry.id, accountId: account.id, lineNo: 2, credit: "1" },
    ]);
    const [order] = await tx
      .insert(purchaseOrders)
      .values({ companyId: COMPANY_B, number: `TFK-${suffix}`, supplierId: supplier.id, date: "2026-11-14" })
      .returning({ id: purchaseOrders.id });
    categoryB = category.id;
    unitB = unit.id;
    supplierB = supplier.id;
    warehouseB = warehouse.id;
    accountB = account.id;
    purchaseOrderB = order.id;
    productB = product.id;
    packagingB = packaging.id;
    stockBatchB = batch.id;
    journalEntryB = journalEntry.id;
    saleB = sale.id;
    saleLineB = saleLine.id;
    saleReturnB = saleReturn.id;
  });
});

afterAll(async () => {
  await withCompany(COMPANY_A, async (tx) => {
    if (saleReturnA) await tx.delete(saleReturnLines).where(and(eq(saleReturnLines.companyId, COMPANY_A), eq(saleReturnLines.returnId, saleReturnA)));
    if (saleA) await tx.delete(salePayments).where(and(eq(salePayments.companyId, COMPANY_A), eq(salePayments.saleId, saleA)));
    if (saleLineA) await tx.delete(saleLines).where(and(eq(saleLines.companyId, COMPANY_A), eq(saleLines.id, saleLineA)));
    if (saleReturnA) await tx.delete(saleReturns).where(and(eq(saleReturns.companyId, COMPANY_A), eq(saleReturns.id, saleReturnA)));
    if (saleA) await tx.delete(sales).where(and(eq(sales.companyId, COMPANY_A), eq(sales.id, saleA)));
    await tx.delete(stockOnHand).where(and(eq(stockOnHand.companyId, COMPANY_A), eq(stockOnHand.productId, productA), eq(stockOnHand.warehouseId, warehouseA)));
    if (journalEntryA) {
      await tx.delete(journalLines).where(and(eq(journalLines.companyId, COMPANY_A), eq(journalLines.entryId, journalEntryA)));
      await tx.delete(accountMonthlyBalances).where(and(eq(accountMonthlyBalances.companyId, COMPANY_A), eq(accountMonthlyBalances.accountId, accountA)));
      await tx.delete(journalEntries).where(and(eq(journalEntries.companyId, COMPANY_A), eq(journalEntries.id, journalEntryA)));
    }
    if (stockBatchA) await tx.delete(stockBatches).where(and(eq(stockBatches.companyId, COMPANY_A), eq(stockBatches.id, stockBatchA)));
    if (receiptA) await tx.delete(stockReceiptLines).where(and(eq(stockReceiptLines.companyId, COMPANY_A), eq(stockReceiptLines.receiptId, receiptA)));
    if (purchaseOrderA) await tx.delete(purchaseOrderLines).where(and(eq(purchaseOrderLines.companyId, COMPANY_A), eq(purchaseOrderLines.orderId, purchaseOrderA)));
    if (receiptA) await tx.delete(stockReceipts).where(and(eq(stockReceipts.companyId, COMPANY_A), eq(stockReceipts.id, receiptA)));
    if (packagingA) await tx.delete(productPackagings).where(and(eq(productPackagings.companyId, COMPANY_A), eq(productPackagings.id, packagingA)));
    await tx.delete(products).where(and(eq(products.companyId, COMPANY_A), eq(products.sku, `${skuPrefix}-valid`)));
    if (productA) await tx.delete(products).where(and(eq(products.companyId, COMPANY_A), eq(products.id, productA)));
    if (purchaseOrderA) await tx.delete(purchaseOrders).where(and(eq(purchaseOrders.companyId, COMPANY_A), eq(purchaseOrders.id, purchaseOrderA)));
    if (supplierA) await tx.delete(suppliers).where(and(eq(suppliers.companyId, COMPANY_A), eq(suppliers.id, supplierA)));
    if (warehouseA) await tx.delete(warehouses).where(and(eq(warehouses.companyId, COMPANY_A), eq(warehouses.id, warehouseA)));
    if (accountA) await tx.delete(accounts).where(and(eq(accounts.companyId, COMPANY_A), eq(accounts.id, accountA)));
    if (categoryA) await tx.delete(categories).where(and(eq(categories.companyId, COMPANY_A), eq(categories.id, categoryA)));
  });
  await withCompany(COMPANY_B, async (tx) => {
    if (saleLineB) await tx.delete(saleLines).where(and(eq(saleLines.companyId, COMPANY_B), eq(saleLines.id, saleLineB)));
    if (saleReturnB) await tx.delete(saleReturns).where(and(eq(saleReturns.companyId, COMPANY_B), eq(saleReturns.id, saleReturnB)));
    if (saleB) await tx.delete(sales).where(and(eq(sales.companyId, COMPANY_B), eq(sales.id, saleB)));
    if (journalEntryB) await tx.delete(journalEntries).where(and(eq(journalEntries.companyId, COMPANY_B), eq(journalEntries.id, journalEntryB)));
    if (stockBatchB) await tx.delete(stockBatches).where(and(eq(stockBatches.companyId, COMPANY_B), eq(stockBatches.id, stockBatchB)));
    if (packagingB) await tx.delete(productPackagings).where(and(eq(productPackagings.companyId, COMPANY_B), eq(productPackagings.id, packagingB)));
    if (productB) await tx.delete(products).where(and(eq(products.companyId, COMPANY_B), eq(products.id, productB)));
    if (purchaseOrderB) await tx.delete(purchaseOrders).where(and(eq(purchaseOrders.companyId, COMPANY_B), eq(purchaseOrders.id, purchaseOrderB)));
    if (categoryB) await tx.delete(categories).where(and(eq(categories.companyId, COMPANY_B), eq(categories.id, categoryB)));
    if (unitB) await tx.delete(units).where(and(eq(units.companyId, COMPANY_B), eq(units.id, unitB)));
    if (supplierB) await tx.delete(suppliers).where(and(eq(suppliers.companyId, COMPANY_B), eq(suppliers.id, supplierB)));
    if (warehouseB) await tx.delete(warehouses).where(and(eq(warehouses.companyId, COMPANY_B), eq(warehouses.id, warehouseB)));
    if (accountB) await tx.delete(accounts).where(and(eq(accounts.companyId, COMPANY_B), eq(accounts.id, accountB)));
  });
});

describe("tenant-aware product master references", () => {
  it("accepts POS sale, payment, and return rows whose document, product, and packaging share the company", () => {
    expect([saleA, saleLineA, saleReturnA]).toHaveLength(3);
  });

  it("rejects cross-company POS document, product, and packaging references", async () => {
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleLines).values({ companyId: COMPANY_A, saleId: saleB, productId: productA, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", productSku: "INVALID", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleLines).values({ companyId: COMPANY_A, saleId: saleA, productId: productB, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", productSku: "INVALID", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleLines).values({ companyId: COMPANY_A, saleId: saleA, productId: productA, packagingId: packagingB, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", productSku: "INVALID", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(salePayments).values({ companyId: COMPANY_A, saleId: saleB, methodId: randomUUID(), amount: "10000" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleReturns).values({ companyId: COMPANY_A, saleId: saleB, number: `TFA-CROSS-RETURN-${suffix}`, date: "2026-11-14", reason: "Uji silang" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleReturnLines).values({ companyId: COMPANY_A, returnId: saleReturnB, productId: productA, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleReturnLines).values({ companyId: COMPANY_A, returnId: saleReturnA, saleLineId: saleLineB, productId: productA, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleReturnLines).values({ companyId: COMPANY_A, returnId: saleReturnA, saleLineId: saleLineA, productId: productB, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", qtyInput: "1" }))).rejects.toThrow();
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(saleReturnLines).values({ companyId: COMPANY_A, returnId: saleReturnA, saleLineId: saleLineA, productId: productA, packagingId: packagingB, qty: "1", unitPrice: "10000", lineTotal: "10000", productName: "Invalid", qtyInput: "1" }))).rejects.toThrow();
  });

  it.each([
    ["category", "categoryId", () => categoryB],
    ["unit", "unitId", () => unitB],
    ["supplier", "supplierId", () => supplierB],
  ] as const)("rejects a %s owned by another company at the database boundary", async (_label, field, getId) => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(products).values({
          companyId: COMPANY_A,
          sku: `${skuPrefix}-${field}`,
          name: `Uji ${field}`,
          [field]: getId(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("accepts a product reference owned by the same company", async () => {
    const [product] = await withCompany(COMPANY_A, (tx) =>
      tx
        .insert(products)
        .values({
          companyId: COMPANY_A,
          sku: `${skuPrefix}-valid`,
          name: "Uji produk dengan kategori sendiri",
          categoryId: categoryA,
        })
        .returning({ id: products.id }),
    );
    expect(product.id).toBeTruthy();
  });

  it("rejects a purchase order supplier owned by another company", async () => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(purchaseOrders).values({
          companyId: COMPANY_A,
          number: `TFA-CROSS-${suffix}`,
          supplierId: supplierB,
          date: "2026-11-14",
        }),
      ),
    ).rejects.toThrow();
  });

  it.each([
    ["warehouse", { warehouseId: () => warehouseB }],
    ["purchase order", { purchaseOrderId: () => purchaseOrderB }],
    ["supplier", { supplierId: () => supplierB }],
    ["payment account", { paymentAccountId: () => accountB }],
  ] as const)("rejects a receipt reference to another company's %s", async (_label, foreignRef) => {
    const values = {
      companyId: COMPANY_A,
      number: `TFA-${suffix}`,
      date: "2026-11-14",
      warehouseId: warehouseA,
      purchaseOrderId: purchaseOrderA,
      supplierId: supplierA,
      paymentAccountId: accountA,
      ...Object.fromEntries(Object.entries(foreignRef).map(([key, getId]) => [key, getId()])),
    };
    await expect(withCompany(COMPANY_A, (tx) => tx.insert(stockReceipts).values(values))).rejects.toThrow();
  });

  it("accepts a receipt whose warehouse, order, supplier, and payment account share its company", () => {
    expect(receiptA).toBeTruthy();
  });

  it("accepts PO and receipt lines whose document, product, and packaging share their company", async () => {
    const [poLine] = await withCompany(COMPANY_A, (tx) =>
      tx
        .insert(purchaseOrderLines)
        .values({
          companyId: COMPANY_A,
          orderId: purchaseOrderA,
          productId: productA,
          packagingId: packagingA,
          qty: "2",
          unitCost: "5000",
          lineTotal: "10000",
          qtyInput: "1",
          isiSnapshot: "2",
        })
        .returning({ id: purchaseOrderLines.id }),
    );
    const [receiptLine] = await withCompany(COMPANY_A, (tx) =>
      tx
        .insert(stockReceiptLines)
        .values({
          companyId: COMPANY_A,
          receiptId: receiptA,
          productId: productA,
          packagingId: packagingA,
          qty: "2",
          unitCost: "5000",
          lineTotal: "10000",
          qtyInput: "1",
          isiSnapshot: "2",
        })
        .returning({ id: stockReceiptLines.id }),
    );
    expect(poLine.id).toBeTruthy();
    expect(receiptLine.id).toBeTruthy();
  });

  it("rejects PO and receipt lines that reference another company's product", async () => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(purchaseOrderLines).values({
          companyId: COMPANY_A,
          orderId: purchaseOrderA,
          productId: productB,
          qty: "1",
          unitCost: "10000",
          lineTotal: "10000",
          qtyInput: "1",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockReceiptLines).values({
          companyId: COMPANY_A,
          receiptId: receiptA,
          productId: productB,
          qty: "1",
          unitCost: "10000",
          lineTotal: "10000",
          qtyInput: "1",
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects packaging and line references owned by another company", async () => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(productPackagings).values({
          companyId: COMPANY_A,
          productId: productB,
          name: `Paket silang ${suffix}`,
          isi: "2",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockReceiptLines).values({
          companyId: COMPANY_A,
          receiptId: receiptA,
          productId: productA,
          packagingId: packagingB,
          qty: "2",
          unitCost: "5000",
          lineTotal: "10000",
          qtyInput: "1",
          isiSnapshot: "2",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(purchaseOrderLines).values({
          companyId: COMPANY_A,
          orderId: purchaseOrderA,
          productId: productA,
          packagingId: packagingB,
          qty: "2",
          unitCost: "5000",
          lineTotal: "10000",
          qtyInput: "1",
          isiSnapshot: "2",
        }),
      ),
    ).rejects.toThrow();
  });

  it("accepts stock balances, batches, and movements scoped to one company", async () => {
    const [balance] = await withCompany(COMPANY_A, (tx) =>
      tx
        .insert(stockOnHand)
        .values({ companyId: COMPANY_A, warehouseId: warehouseA, productId: productA, qty: "3" })
        .returning({ productId: stockOnHand.productId }),
    );
    const rollbackFixture = new Error("rollback fixture mutasi append-only");
    await expect(
      withCompany(COMPANY_A, async (tx) => {
        const [movement] = await tx
          .insert(stockMovements)
          .values({
          companyId: COMPANY_A,
          warehouseId: warehouseA,
          productId: productA,
          batchId: stockBatchA,
          movementType: "purchase",
          qty: "3",
          unitCost: "10000",
          referenceType: "tenant-test",
          referenceNumber: skuPrefix,
        })
          .returning({ id: stockMovements.id });
        expect(movement.id).toBeTruthy();
        throw rollbackFixture;
      }),
    ).rejects.toBe(rollbackFixture);
    expect(balance.productId).toBe(productA);
  });

  it("rejects cross-company products, warehouses, and batches in stock ledgers", async () => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockOnHand).values({ companyId: COMPANY_A, warehouseId: warehouseA, productId: productB, qty: "1" }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockOnHand).values({ companyId: COMPANY_A, warehouseId: warehouseB, productId: productA, qty: "1" }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockBatches).values({ companyId: COMPANY_A, productId: productB, warehouseId: warehouseA, batchNumber: `CROSS-P-${suffix}` }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(stockBatches).values({ companyId: COMPANY_A, productId: productA, warehouseId: warehouseB, batchNumber: `CROSS-W-${suffix}` }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx
          .insert(stockMovements)
          .values({
            companyId: COMPANY_A,
            warehouseId: warehouseA,
            productId: productA,
            batchId: stockBatchB,
            movementType: "purchase",
            qty: "1",
            unitCost: "10000",
            referenceNumber: `${skuPrefix}-foreign-batch`,
          }),
      ),
    ).rejects.toThrow();
  });

  it("keeps journal lines and monthly account balances in the journal's company", async () => {
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(journalLines).values({ companyId: COMPANY_A, entryId: journalEntryB, accountId: accountA, lineNo: 1, debit: "1" }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(journalLines).values({ companyId: COMPANY_A, entryId: journalEntryA, accountId: accountB, lineNo: 1, debit: "1" }),
      ),
    ).rejects.toThrow();
    await expect(
      withCompany(COMPANY_A, (tx) =>
        tx.insert(accountMonthlyBalances).values({ companyId: COMPANY_A, accountId: accountB, yearMonth: "2026-11" }),
      ),
    ).rejects.toThrow();

    const lines = await withCompany(COMPANY_A, (tx) =>
      tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.companyId, COMPANY_A), eq(journalLines.entryId, journalEntryA))),
    );
    const [balance] = await withCompany(COMPANY_A, (tx) =>
      tx
        .insert(accountMonthlyBalances)
        .values({ companyId: COMPANY_A, accountId: accountA, yearMonth: "2026-11", totalDebit: "1" })
        .returning({ id: accountMonthlyBalances.id }),
    );
    expect(lines).toHaveLength(2);
    expect(balance.id).toBeTruthy();
  });
});
