import { describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { products, suppliers, warehouses } from "@/db/schema";
import { createAdjustment, createReceipt } from "@/server/inventory";
import { createPurchaseOrder } from "@/server/purchasing";
import { createSupplierReturn, getSupplierReturnDetail } from "@/server/supplier-returns";
import { todayISO } from "@/lib/format";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

/**
 * SIM-2 S7 REM-02 (sumber: §2 S0-B): baris dokumen gudang & pembelian
 * dulunya hanya membekukan HARGA — nama produk dibaca dari master saat
 * tampil, jadi mengganti nama produk mengubah dokumen historis. Test ini
 * mengunci snapshot nama+SKU pada keempat tabel baris dan permukaan
 * bacanya: sesudah produk diganti nama, dokumen lama tetap menampilkan
 * nama saat dokumen dibuat.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";
const NAME_BEFORE = "Nama Awal REM02";
const NAME_AFTER = "Nama Baru REM02";


type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const rollbackTransaction = makeRollbackTransaction(ORG_ID);

/**
 * Isolasi penomoran: perusahaan fixture bersama `…0001` menyimpan dokumen
 * ter-commit dari program-program terdahulu (mis. PO-2026-00001) sementara
 * baris penomoran serinya tidak ada/tertinggal, sehingga penerbitan nomor
 * di dalam transaksi rollback bisa bertabrakan dengan residu itu. Di dalam
 * transaksi uji (ikut ter-rollback), samakan penomoran seri yang dipakai
 * skenario ini ke max(nomor ter-commit)+1 agar test deterministik di
 * urutan larian apa pun.
 */
async function alignSequences(tx: Tx) {
  const series: [string, string, string][] = [
    ["PURCHASE_ORDER", "purchase_orders", "PO"],
    ["RECEIPT", "stock_receipts", "RCV"],
    ["ADJUSTMENT", "stock_documents", "ADJ"],
    ["SUPPLIER_RETURN", "supplier_returns", "RTB"],
  ];
  for (const [docType, table, prefix] of series) {
    await tx.execute(sql`
      insert into document_sequences (company_id, doc_type, fiscal_year, prefix, next_number)
      select ${ORG_ID}, ${docType}, 2026, ${prefix},
             coalesce(max(cast(substring(number from '[0-9]+$') as integer)), 0) + 1
        from ${sql.raw(table)}
       where company_id = ${ORG_ID} and number like ${`${prefix}-2026-%`}
      on conflict (company_id, doc_type, fiscal_year)
      do update set next_number = greatest(document_sequences.next_number, excluded.next_number)
    `);
  }
}

async function lineSnapshots(tx: Tx, productId: string) {
  const rows = (await tx.execute(sql`
    select 'po' src, product_name, product_sku from purchase_order_lines where company_id = ${ORG_ID} and product_id = ${productId}
    union all
    select 'receipt', product_name, product_sku from stock_receipt_lines where company_id = ${ORG_ID} and product_id = ${productId}
    union all
    select 'document', product_name, product_sku from stock_document_lines where company_id = ${ORG_ID} and product_id = ${productId}
    union all
    select 'supplier_return', product_name, product_sku from supplier_return_lines where company_id = ${ORG_ID} and product_id = ${productId}
  `)) as unknown as { src: string; product_name: string | null; product_sku: string | null }[];
  return rows;
}

describe("REM-02 product name/SKU snapshot on warehouse & purchasing lines", () => {
  it("freezes the name at document creation and keeps it after a rename", async () => {
    await rollbackTransaction(async (tx) => {
      await alignSequences(tx);
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
      const sku = `REM02-${Date.now()}`;
      const [product] = await tx
        .insert(products)
        .values({
          companyId: ORG_ID,
          sku,
          name: NAME_BEFORE,
          costPrice: "1000",
          salePrice: "2000",
        })
        .returning({ id: products.id });
      const productId = product!.id;
      const date = todayISO();

      await createPurchaseOrder(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier!.id,
        date,
        lines: [{ productId, qty: "10", unitCost: "1000" }],
      });
      await createReceipt(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse!.id,
        supplierId: supplier!.id,
        date,
        lines: [{ productId, qty: "10", unitCost: "1000" }],
      });
      await createAdjustment(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        warehouseId: warehouse!.id,
        date,
        type: "adjustment",
        reason: "Koreksi uji REM-02",
        lines: [{ productId, qty: "1", unitCost: "1000" }],
      });
      const ret = await createSupplierReturn(tx, {
        companyId: ORG_ID,
        userId: USER_ID,
        supplierId: supplier!.id,
        warehouseId: warehouse!.id,
        date,
        reasonCategory: "damaged",
        reasonDetail: "Barang rusak untuk uji REM-02",
        resolutionType: "refund",
        lines: [{ productId, qty: "1" }],
      });

      // Snapshot tercatat di keempat tabel baris sejak pembuatan.
      const before = await lineSnapshots(tx, productId);
      expect(before.map((r) => r.src).sort()).toEqual(["document", "po", "receipt", "supplier_return"]);
      for (const row of before) {
        expect(row.product_name).toBe(NAME_BEFORE);
        expect(row.product_sku).toBe(sku);
      }

      // Ganti nama master — dokumen historis tidak boleh ikut berubah.
      await tx
        .update(products)
        .set({ name: NAME_AFTER })
        .where(and(eq(products.companyId, ORG_ID), eq(products.id, productId)));

      const after = await lineSnapshots(tx, productId);
      for (const row of after) {
        expect(row.product_name).toBe(NAME_BEFORE);
        expect(row.product_sku).toBe(sku);
      }

      // Permukaan baca detail retur memakai snapshot, bukan nama master.
      const detail = await getSupplierReturnDetail(tx, ORG_ID, ret.id);
      expect(detail).not.toBeNull();
      expect(detail!.lines[0]!.productName).toBe(NAME_BEFORE);
    });
  });
});
