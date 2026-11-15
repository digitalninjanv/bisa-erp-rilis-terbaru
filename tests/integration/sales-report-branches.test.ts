import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  categories,
  customers,
  paymentMethods,
  productPackagings,
  products,
  saleLines,
  salePayments,
  saleReturnLines,
  saleReturns,
  sales,
  warehouses,
} from "@/db/schema";
import {
  getPaymentBreakdown,
  getSaleDetail,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getTopProducts,
  listSales,
} from "@/server/reports";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * Cabang laporan penjualan dengan bentuk data yang berbeda: baris tanpa
 * kategori/kemasan, kasir tanpa user, retur pada tanggal tanpa penjualan,
 * metode pembayaran tanpa master, dan status yang harus dikecualikan.
 */
const ORG = "01900000-0000-7000-8000-000000000001";
const rollback = makeRollbackTransaction(ORG);
const DATE = "2026-05-10";

describe("laporan penjualan — variasi data", () => {
  it("ringkasan, per hari/kasir/kategori, produk terlaris, dan pembayaran", async () => {
    await rollback(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      const [category] = await tx
        .insert(categories)
        .values({ companyId: ORG, name: `Kategori Laporan ${suffix}` })
        .returning({ id: categories.id });
      const [productWithCategory] = await tx
        .insert(products)
        .values({
          companyId: ORG,
          sku: `LAP-CAT-${suffix}`,
          name: `Produk Kategori ${suffix}`,
          categoryId: category.id,
          salePrice: "15000",
          costPrice: "10000",
        })
        .returning({ id: products.id });
      const [productNoCategory] = await tx
        .insert(products)
        .values({
          companyId: ORG,
          sku: `LAP-NOCAT-${suffix}`,
          name: `Produk Tanpa Kategori ${suffix}`,
          salePrice: "10000",
          costPrice: "6000",
        })
        .returning({ id: products.id });
      const [packaging] = await tx
        .insert(productPackagings)
        .values({
          companyId: ORG,
          productId: productWithCategory.id,
          name: `Dus ${suffix}`,
          isi: "10",
          salePrice: "150000",
        })
        .returning({ id: productPackagings.id });
      const [cashMethod] = await tx
        .insert(paymentMethods)
        .values({
          companyId: ORG,
          code: `LAP-CASH-${suffix}`,
          name: `Tunai ${suffix}`,
          type: "cash",
        })
        .returning({ id: paymentMethods.id });
      const [customer] = await tx
        .insert(customers)
        .values({ companyId: ORG, code: `LAP-CUST-${suffix}`, name: `Pelanggan Laporan ${suffix}` })
        .returning({ id: customers.id });

      const [completed] = await tx
        .insert(sales)
        .values({
          companyId: ORG,
          warehouseId: warehouse.id,
          number: `LAP-${suffix}-1`,
          date: DATE,
          cashierId: "kasir-tanpa-user",
          customerId: customer.id,
          status: "completed",
          subtotal: "25000",
          discountTotal: "1000",
          taxTotal: "2500",
          total: "26500",
          costTotal: "16000",
        })
        .returning({ id: sales.id });
      const [returned] = await tx
        .insert(sales)
        .values({
          companyId: ORG,
          warehouseId: warehouse.id,
          number: `LAP-${suffix}-2`,
          date: DATE,
          cashierId: "kasir-lain",
          status: "returned",
          subtotal: "15000",
          taxTotal: "1500",
          total: "16500",
          costTotal: "10000",
        })
        .returning({ id: sales.id });
      await tx.insert(sales).values([
        {
          companyId: ORG,
          warehouseId: warehouse.id,
          number: `LAP-${suffix}-3`,
          date: DATE,
          cashierId: "kasir-lain",
          status: "void",
          total: "999",
        },
      ]);

      await tx.insert(saleLines).values([
        {
          companyId: ORG,
          saleId: completed.id,
          productId: productWithCategory.id,
          lineNo: 0,
          qty: "1",
          unitPrice: "15000",
          lineTotal: "15000",
          unitCost: "10000",
          productName: `Produk Kategori ${suffix}`,
          productSku: `LAP-CAT-${suffix}`,
          packagingId: packaging.id,
          qtyInput: "1",
          isiSnapshot: "10",
        },
        {
          companyId: ORG,
          saleId: completed.id,
          productId: productNoCategory.id,
          lineNo: 1,
          qty: "1",
          unitPrice: "10000",
          lineTotal: "10000",
          unitCost: "6000",
          productName: `Produk Tanpa Kategori ${suffix}`,
          productSku: `LAP-NOCAT-${suffix}`,
          qtyInput: "1",
        },
        {
          companyId: ORG,
          saleId: returned.id,
          productId: productWithCategory.id,
          lineNo: 0,
          qty: "1",
          unitPrice: "15000",
          lineTotal: "15000",
          unitCost: "10000",
          productName: `Produk Kategori ${suffix}`,
          productSku: `LAP-CAT-${suffix}`,
          qtyInput: "1",
        },
      ]);

      const [postedReturn] = await tx
        .insert(saleReturns)
        .values({
          companyId: ORG,
          saleId: returned.id,
          number: `RET-LAP-${suffix}`,
          date: "2026-05-11",
          status: "posted",
          total: "5000",
          costTotal: "3000",
          reason: "Uji laporan",
        })
        .returning({ id: saleReturns.id });
      await tx.insert(saleReturns).values({
        companyId: ORG,
        saleId: returned.id,
        number: `RET-LAP-V-${suffix}`,
        date: DATE,
        status: "void",
        total: "1000",
        reason: "Tidak dihitung",
      });
      await tx.insert(saleReturnLines).values({
        companyId: ORG,
        returnId: postedReturn.id,
        productId: productNoCategory.id,
        qty: "1",
        unitPrice: "5000",
        unitCost: "3000",
        lineTotal: "5000",
        productName: `Produk Tanpa Kategori ${suffix}`,
        qtyInput: "1",
      });

      await tx.insert(salePayments).values([
        {
          companyId: ORG,
          saleId: completed.id,
          methodId: cashMethod.id,
          amount: "16500",
          tendered: "20000",
        },
        {
          companyId: ORG,
          saleId: completed.id,
          methodId: crypto.randomUUID(),
          amount: "10000",
          tendered: "10000",
          feeAmount: "500",
        },
      ]);

      const summary = await getSalesSummary(tx, ORG, { from: DATE, to: "2026-05-31" });
      expect(summary.transactions).toBe(2);
      expect(summary.returned).toBe(5000);
      expect(summary.average).toBeGreaterThan(0);

      const byDay = await getSalesByDay(tx, ORG, { from: DATE, to: "2026-05-31" });
      expect(byDay.some((row) => row.date === "2026-05-11")).toBe(true);
      const byCashier = await getSalesByCashier(tx, ORG, { from: DATE, to: "2026-05-31" });
      expect(byCashier.some((row) => row.name === "—")).toBe(true);
      const byCategory = await getSalesByCategory(tx, ORG, { from: DATE, to: "2026-05-31" });
      expect(byCategory.some((row) => row.name === "Tanpa kategori")).toBe(true);
      const byCashierFiltered = await getSalesByCategory(
        tx,
        ORG,
        { from: DATE, to: "2026-05-31" },
        "kasir-lain",
      );
      expect(byCashierFiltered.length).toBeGreaterThanOrEqual(0);

      const top = await getTopProducts(tx, ORG, { from: DATE, to: "2026-05-31" }, 5);
      expect(top.length).toBeGreaterThan(0);
      const payments = await getPaymentBreakdown(tx, ORG, { from: DATE, to: "2026-05-31" });
      expect(payments.some((row) => row.name === "—" && row.type === "cash")).toBe(true);

      const listed = await listSales(tx, {
        companyId: ORG,
        q: suffix,
        status: "completed",
        from: DATE,
        to: "2026-05-31",
      });
      expect(listed.total).toBe(1);
      const detail = await getSaleDetail(tx, ORG, completed.id);
      expect(detail?.lines.some((line) => line.packagingName?.startsWith("Dus"))).toBe(true);
      expect(detail?.lines.some((line) => line.packagingName === null)).toBe(true);
      expect(detail?.customer?.name).toContain("Pelanggan Laporan");
      expect(detail?.cashier).toBeNull();
      expect(await getSaleDetail(tx, ORG, crypto.randomUUID())).toBeNull();
    });
  });
});
