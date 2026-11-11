import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  categories,
  products,
  saleLines,
  saleReturnLines,
  saleReturns,
  sales,
  warehouses,
} from "@/db/schema";
import {
  getSalesByCategory,
  getSalesSummary,
  getTopProducts,
} from "@/server/reports";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG_ID);

describe("laporan penjualan — retur dan PPN inklusif", () => {
  it("retur penuh tidak lagi dihitung sebagai omzet/profit; PPN tidak dobel", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [category] = await tx
        .insert(categories)
        .values({ companyId: ORG_ID, name: `Kategori Uji Laporan ${crypto.randomUUID().slice(0, 8)}` })
        .returning({ id: categories.id, name: categories.name });
      const date = todayISO();
      const before = await getSalesSummary(tx, ORG_ID, { from: date, to: date });
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `TST-RPT-${crypto.randomUUID().slice(0, 8)}`,
          name: "Produk Uji Laporan Retur",
          categoryId: category?.id ?? null,
          costPrice: "100",
          salePrice: "200",
        })
        .returning({ id: products.id });
      const saleId = crypto.randomUUID();
      const number = `TST-SALE-${crypto.randomUUID().slice(0, 8)}`;
      await tx.insert(sales).values({
        id: saleId,
        companyId: ORG_ID,
        warehouseId: warehouse.id,
        number,
        date,
        cashierId: USER_ID,
        status: "returned",
        subtotal: "222",
        taxTotal: "22",
        total: "222",
        costTotal: "100",
        paidTotal: "222",
        paymentStatus: "paid",
        createdBy: USER_ID,
      });
      await tx.insert(saleLines).values({
        companyId: ORG_ID,
        saleId,
        productId: product.id,
        qty: "1",
        unitPrice: "200",
        taxAmount: "22",
        lineTotal: "222",
        unitCost: "100",
        productName: "Produk Uji Laporan Retur",
        productSku: "TST-RPT",
        qtyInput: "1",
      });
      const returnId = crypto.randomUUID();
      await tx.insert(saleReturns).values({
        id: returnId,
        companyId: ORG_ID,
        saleId,
        number: `TST-RET-${crypto.randomUUID().slice(0, 8)}`,
        date,
        status: "posted",
        total: "222",
        costTotal: "100",
        reason: "Uji laporan retur",
        createdBy: USER_ID,
      });
      await tx.insert(saleReturnLines).values({
        companyId: ORG_ID,
        returnId,
        productId: product.id,
        qty: "1",
        unitPrice: "200",
        unitCost: "100",
        lineTotal: "222",
        productName: "Produk Uji Laporan Retur",
        qtyInput: "1",
      });

      const summary = await getSalesSummary(tx, ORG_ID, { from: date, to: date });
      expect(summary.total).toBeCloseTo(before.total, 2);
      expect(summary.cost).toBeCloseTo(before.cost, 2);
      expect(summary.tax).toBeCloseTo(before.tax, 2);
      expect(summary.profit).toBeCloseTo(before.profit, 2);

      const byCategory = await getSalesByCategory(tx, ORG_ID, { from: date, to: date });
      const categoryRow = byCategory.find(
        (row) => row.name === (category?.name ?? "Tanpa kategori"),
      );
      expect(categoryRow?.total ?? 0).toBeCloseTo(0, 2);

      const top = await getTopProducts(tx, ORG_ID, { from: date, to: date }, 1000);
      const topRow = top.find((row) => row.productId === product.id);
      expect(topRow?.total ?? 0).toBeCloseTo(0, 2);
      expect(topRow?.qty ?? 0).toBeCloseTo(0, 2);
    });
  });
});
