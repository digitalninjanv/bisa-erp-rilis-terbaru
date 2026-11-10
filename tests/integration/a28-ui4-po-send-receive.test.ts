import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  products,
  purchaseOrders,
  stockMovements,
  suppliers,
  warehouses,
} from "@/db/schema";
import { createReceipt } from "@/server/inventory";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID, { before: alignSequences });

/** Samakan penomoran seri PO/RCV ke max ter-commit + 1 di dalam
 * transaksi uji — pola yang sama dengan purchase-order.test.ts agar
 * deterministik terhadap dokumen ter-commit di perusahaan demo. */
async function alignSequences(tx: Tx) {
  const year = new Date().getUTCFullYear();
  const series: [string, string, string][] = [
    ["PURCHASE_ORDER", "purchase_orders", "PO"],
    ["RECEIPT", "stock_receipts", "RCV"],
  ];
  for (const [docType, table, prefix] of series) {
    await tx.execute(sql`
      insert into document_sequences (company_id, doc_type, fiscal_year, prefix, next_number)
      select ${ORG_ID}, ${docType}, ${year}, ${prefix},
             coalesce(max(cast(substring(number from '[0-9]+$') as integer)), 0) + 1
        from ${sql.raw(table)}
       where company_id = ${ORG_ID} and number like ${`${prefix}-${year}-%`}
      on conflict (company_id, doc_type, fiscal_year)
      do update set next_number = greatest(document_sequences.next_number, excluded.next_number)
    `);
  }
}

/**
 * A-28 UI-4 (UX-C01) — jalur domain di balik aksi "Kirim & terima"
 * pada PO Draf. Aksi UI menjalankan sendPurchaseOrderAction yang
 * sama dengan Kirim PO biasa lalu membuka formulir penerimaan;
 * test ini membuktikan kontrak domainnya ujung-ke-ujung:
 * 1. Penerimaan terhadap PO yang MASIH Draf ditolak — tidak ada
 *    penerimaan yang menembus status secara diam-diam. Sesudah transisi kirim eksplisit, status = sent dan audit
 *    `purchase_order.send` tercatat seperti transisi biasa. Penerimaan penuh atas PO yang baru terkirim itu terposting,
 *    PO menjadi received, dan pergerakan stok merujuk penerimaan.
 */
describe("A-28 UI-4 — Kirim & terima dari PO Draf (jalur domain)", () => {
  it("draf menolak penerimaan; sesudah kirim eksplisit + audit, penerimaan terposting penuh", async () => {
    await rollbackTransaction(async (tx) => {
      const [warehouse] = await tx
        .select()
        .from(warehouses)
        .where(and(eq(warehouses.companyId, ORG_ID), eq(warehouses.isDefault, true)))
        .limit(1);
      const [supplier] = await tx
        .select()
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID))
        .limit(1);
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku: "TEST-UI4-001",
          name: "Produk Uji UI-4",
          supplierId: supplier.id,
          costPrice: "2500",
          salePrice: "3000",
          minStock: "0",
          trackStock: true,
          isActive: true,
        })
        .returning();

      const order = await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "10", unitCost: "2500" }],
      });

      const receiptInput = {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse.id,
        supplierId: supplier.id,
        source: "purchase" as const,
        purchaseOrderId: order.id,
        date: todayISO(),
        lines: [{ productId: product.id, qty: "10", unitCost: "2500" }],
      };

      // (1) Masih draf: penerimaan ditolak, PO tetap draf.
      await expect(createReceipt(tx, receiptInput)).rejects.toThrow(/PO|Terkirim|draft/i);
      const [stillDraft] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, ORG_ID), eq(purchaseOrders.id, order.id)));
      expect(stillDraft.status).toBe("draft");

      // (2) Transisi kirim eksplisit — fungsi domain yang sama
      // dengan yang dijalankan aksi "Kirim & terima".
      await sendPurchaseOrder(tx, { companyId: ORG_ID, userId: USER_ID, orderId: order.id });
      const [sent] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, ORG_ID), eq(purchaseOrders.id, order.id)));
      expect(sent.status).toBe("sent");

      const audits = await tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG_ID),
            eq(auditLog.action, "purchase_order.send"),
            eq(auditLog.entityId, order.id),
          ),
        );
      expect(audits).toHaveLength(1);
      expect(audits[0].userId).toBe(USER_ID);

      // (3) Penerimaan penuh terposting; PO received; stok bergerak
      // dengan referensi penerimaan.
      const receipt = await createReceipt(tx, receiptInput);
      const [received] = await tx
        .select()
        .from(purchaseOrders)
        .where(and(eq(purchaseOrders.companyId, ORG_ID), eq(purchaseOrders.id, order.id)));
      expect(received.status).toBe("received");

      const movements = await tx
        .select()
        .from(stockMovements)
        .where(
          and(
            eq(stockMovements.companyId, ORG_ID),
            eq(stockMovements.referenceId, receipt.id),
          ),
        );
      expect(movements).toHaveLength(1);
      expect(movements[0].referenceType).toBe("stock_receipt");
      expect(movements[0].referenceNumber).toBe(receipt.number);
    });
  });
});
