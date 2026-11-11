import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  journalEntries,
  journalLines,
  products,
  stockOnHand,
  suppliers,
  warehouses,
} from "@/db/schema";
import { getAccountMap } from "@/server/accounting";
import { createReceipt, voidReceipt } from "@/server/inventory";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const rollbackTransaction = makeRollbackTransaction(ORG_ID);

describe("void penerimaan — nilai persediaan mengikuti DPP/diskon", () => {
  it("void memakai biaya neto baris, bukan harga bruto, dan AVCO kembali ke GL", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [supplier] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: `TST-VOID-${crypto.randomUUID().slice(0, 8)}`,
          name: "Produk Uji Void Diskon",
          costPrice: "0",
          salePrice: "3000",
        })
        .returning({ id: products.id });
      const map = await getAccountMap(tx, ORG_ID);
      const date = todayISO();
      const [glBefore] = await tx
        .select({ balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ORG_ID),
            eq(journalLines.accountId, map.inventory),
            eq(journalEntries.status, "posted"),
          ),
        );
      const before = d(glBefore?.balance ?? 0);

      const first = await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date,
        lines: [
          {
            productId: product.id,
            qty: 10,
            unitCost: 1000,
            discountType: "nominal",
            discountValue: 1000,
          },
        ],
      });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase",
        date,
        lines: [{ productId: product.id, qty: 10, unitCost: 2000 }],
      });

      await voidReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        receiptId: first.id,
        reason: "Uji void diskon penerimaan",
        date,
      });

      const [row] = await tx
        .select({ qty: stockOnHand.qty, cost: products.costPrice })
        .from(stockOnHand)
        .innerJoin(products, eq(stockOnHand.productId, products.id))
        .where(and(eq(stockOnHand.companyId, ORG_ID), eq(stockOnHand.productId, product.id)))
        .limit(1);
      expect(d(row?.qty ?? 0).toFixed(4)).toBe("10.0000");
      expect(d(row?.cost ?? 0).toFixed(4)).toBe("2000.0000");

      const [gl] = await tx
        .select({ balance: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ORG_ID),
            eq(journalLines.accountId, map.inventory),
            eq(journalEntries.status, "posted"),
          ),
        );
      expect(d(gl?.balance ?? 0).minus(before).toFixed(4)).toBe("20000.0000");
    });
  });
});
