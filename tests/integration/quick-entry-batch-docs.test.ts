import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import {
  accounts,
  customers,
  expenses,
  partyOpeningBalances,
  sales,
  stockReceipts,
  supplierReturnAllocations,
  supplierReturns,
  suppliers,
  warehouses,
} from "@/db/schema";
import {
  listOpenReceivableDocs,
  listOpenReceivableDocsForCustomers,
  type OpenReceivableDoc,
} from "@/server/quick-entry";
import {
  listSupplierOpenPayableDocs,
  listSupplierOpenPayableDocsForSuppliers,
} from "@/server/supplier-returns";
import { listOpenExpensePayables } from "@/server/payables";
import { toDb } from "@/lib/money";
import { makeRollbackTransaction, type Tx } from "../helpers/rollback-transaction";

/**
 * A-26 Q1b (I-01) — bukti ekuivalensi varian BATCH dokumen terbuka
 * terhadap varian per pihak yang lama.
 *
 * Pemuat pratinjau Catat Transaksi (getQuickEntryBootstrapAction)
 * sebelumnya memanggil fungsi per pihak di dalam loop (N+1: 1 kueri
 * daftar + kueri dokumen per pihak, untuk piutang & utang). Kini ia
 * memakai varian batch. Test ini membuktikan pada fixture terkendali
 * (beberapa pihak, urutan tanggal bersilangan antar-jenis dokumen,
 * alokasi retur yang meng-net utang penerimaan, dokumen bersisa 0
 * yang harus tersisih) DAN pada seluruh pihak perusahaan demo:
 * hasil batch per pihak IDENTIK — isi maupun urutan — dengan hasil
 * fungsi per pihak.
 */

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const USER_ID = "01900000-0000-7000-8000-000000000010";

const C1 = "01900000-0000-7000-8000-00000000b1c1";
const C2 = "01900000-0000-7000-8000-00000000b1c2";
const C3 = "01900000-0000-7000-8000-00000000b1c3";
const S1 = "01900000-0000-7000-8000-00000000b151";
const S2 = "01900000-0000-7000-8000-00000000b152";
const S3 = "01900000-0000-7000-8000-00000000b153";

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

async function seedParties(tx: Tx) {
  await tx.insert(customers).values([
    { id: C1, companyId: ORG_ID, code: "Q1B-C1", name: "Pelanggan Batch Satu" },
    { id: C2, companyId: ORG_ID, code: "Q1B-C2", name: "Pelanggan Batch Dua" },
    { id: C3, companyId: ORG_ID, code: "Q1B-C3", name: "Pelanggan Batch Tiga" },
  ]);
  await tx.insert(suppliers).values([
    { id: S1, companyId: ORG_ID, code: "Q1B-S1", name: "Pemasok Batch Satu" },
    { id: S2, companyId: ORG_ID, code: "Q1B-S2", name: "Pemasok Batch Dua" },
    { id: S3, companyId: ORG_ID, code: "Q1B-S3", name: "Pemasok Batch Tiga" },
  ]);
}

async function seedReceivables(tx: Tx, warehouseId: string) {
  // C1: penjualan 01-03 (sisa 30.000), saldo awal 01-04 (sisa 50.000),
  // penjualan 01-05 (sisa 100.000) — urutan gabungan harus tanggal.
  await tx.insert(sales).values([
    {
      companyId: ORG_ID, warehouseId, number: "Q1B-SALE-2", date: "2026-01-03",
      cashierId: USER_ID, customerId: C1, status: "completed",
      total: "50000", paidTotal: "20000", paymentStatus: "partial",
      createdAt: new Date("2026-01-03T01:00:00Z"),
    },
    {
      companyId: ORG_ID, warehouseId, number: "Q1B-SALE-1", date: "2026-01-05",
      cashierId: USER_ID, customerId: C1, status: "completed",
      total: "100000", paidTotal: "0", paymentStatus: "unpaid",
      createdAt: new Date("2026-01-05T01:00:00Z"),
    },
    // Penjualan lunas & penjualan void tidak boleh muncul.
    {
      companyId: ORG_ID, warehouseId, number: "Q1B-SALE-3", date: "2026-01-02",
      cashierId: USER_ID, customerId: C1, status: "completed",
      total: "70000", paidTotal: "70000", paymentStatus: "paid",
      createdAt: new Date("2026-01-02T01:00:00Z"),
    },
  ]);
  await tx.insert(partyOpeningBalances).values([
    {
      companyId: ORG_ID, number: "Q1B-OPEN-AR-1", kind: "receivable", partyType: "customer",
      partyId: C1, date: "2026-01-04", amount: "75000", paidAmount: "25000", status: "open",
      createdAt: new Date("2026-01-04T01:00:00Z"),
    },
    {
      companyId: ORG_ID, number: "Q1B-OPEN-AR-2", kind: "receivable", partyType: "customer",
      partyId: C2, date: "2026-02-01", amount: "60000", paidAmount: "0", status: "open",
      createdAt: new Date("2026-02-01T01:00:00Z"),
    },
    {
      // Sisa 0 walau status open → tersisih di kedua varian.
      companyId: ORG_ID, number: "Q1B-OPEN-AR-3", kind: "receivable", partyType: "customer",
      partyId: C3, date: "2026-01-01", amount: "40000", paidAmount: "40000", status: "open",
      createdAt: new Date("2026-01-01T01:00:00Z"),
    },
  ]);
}

async function seedGoodsPayables(tx: Tx, warehouseId: string) {
  await tx
    .insert(stockReceipts)
    .values([
      {
        companyId: ORG_ID, warehouseId, supplierId: S1, source: "purchase",
        number: "Q1B-RCV-2", date: "2026-01-02", status: "posted",
        total: "80000", paidAmount: "0", taxAmount: "0",
        createdAt: new Date("2026-01-02T01:00:00Z"),
      },
      {
        companyId: ORG_ID, warehouseId, supplierId: S1, source: "purchase",
        number: "Q1B-RCV-1", date: "2026-01-06", status: "posted",
        total: "200000", paidAmount: "50000", taxAmount: "0",
        createdAt: new Date("2026-01-06T01:00:00Z"),
      },
      {
        // Lunas → tersisih; S2 tidak punya dokumen barang terbuka.
        companyId: ORG_ID, warehouseId, supplierId: S2, source: "purchase",
        number: "Q1B-RCV-3", date: "2026-03-01", status: "posted",
        total: "45000", paidAmount: "45000", taxAmount: "0",
        createdAt: new Date("2026-03-01T01:00:00Z"),
      },
    ]);
  const [receiptB] = await tx
    .select({ id: stockReceipts.id })
    .from(stockReceipts)
    .where(and(eq(stockReceipts.companyId, ORG_ID), eq(stockReceipts.number, "Q1B-RCV-2")))
    .limit(1);
  await tx.insert(partyOpeningBalances).values({
    companyId: ORG_ID, number: "Q1B-OPEN-AP-1", kind: "payable", partyType: "supplier",
    partyId: S1, date: "2026-01-04", amount: "90000", paidAmount: "10000", status: "open",
    reference: "FAKTUR-LAMA-1",
    createdAt: new Date("2026-01-04T01:00:00Z"),
  });
  // Alokasi retur 30.000 ke penerimaan 01-02: sisa 80.000 → 50.000.
  // Jalur batch menjumlahkan alokasi lewat satu GROUP BY; jalur lama
  // per dokumen — keduanya harus sepakat pada angka ini.
  const [ret] = await tx
    .insert(supplierReturns)
    .values({
      companyId: ORG_ID, number: "Q1B-RET-1", supplierId: S1, warehouseId,
      date: "2026-01-10", reasonCategory: "damaged", reasonDetail: "Uji batch",
      resolutionType: "next_purchase_credit", status: "posted", totalValue: "30000",
    })
    .returning({ id: supplierReturns.id });
  await tx.insert(supplierReturnAllocations).values({
    companyId: ORG_ID, returnId: ret.id, receiptId: receiptB.id, amount: "30000",
  });
}

async function seedExpensePayables(tx: Tx) {
  const [expenseAccount] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, ORG_ID), eq(accounts.type, "expense")))
    .limit(1);
  expect(expenseAccount).toBeDefined();
  await tx.insert(expenses).values([
    {
      companyId: ORG_ID, number: "Q1B-EXP-1", date: "2026-01-05",
      expenseAccountId: expenseAccount.id, supplierId: S1, description: "Beban batch satu",
      amount: "30000", paidAmount: "0", paymentStatus: "unpaid", status: "posted",
      createdAt: new Date("2026-01-05T01:00:00Z"),
    },
    {
      companyId: ORG_ID, number: "Q1B-EXP-2", date: "2026-01-07",
      expenseAccountId: expenseAccount.id, supplierId: S1, description: "Beban batch dua",
      amount: "25000", paidAmount: "5000", paymentStatus: "partial", status: "posted",
      createdAt: new Date("2026-01-07T01:00:00Z"),
    },
    {
      companyId: ORG_ID, number: "Q1B-EXP-3", date: "2026-02-15",
      expenseAccountId: expenseAccount.id, supplierId: S2, description: "Beban batch tiga",
      amount: "12000", paidAmount: "0", paymentStatus: "unpaid", status: "posted",
      createdAt: new Date("2026-02-15T01:00:00Z"),
    },
    {
      // Lunas → tersisih di kedua varian.
      companyId: ORG_ID, number: "Q1B-EXP-4", date: "2026-01-09",
      expenseAccountId: expenseAccount.id, supplierId: S1, description: "Beban batch lunas",
      amount: "9000", paidAmount: "9000", paymentStatus: "paid", status: "posted",
      createdAt: new Date("2026-01-09T01:00:00Z"),
    },
  ]);
}

const normReceivable = (docs: OpenReceivableDoc[]) =>
  docs.map((doc) => ({
    kind: doc.kind,
    id: doc.id,
    number: doc.number,
    date: doc.date,
    outstanding: toDb(doc.outstanding),
  }));

describe("A-26 Q1b (I-01) — batch dokumen terbuka ≡ per pihak", () => {
  it("piutang: batch per pelanggan identik isi & urutan dengan per pelanggan", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      await seedParties(tx);
      await seedReceivables(tx, warehouse.id);

      const batch = await listOpenReceivableDocsForCustomers(tx, ORG_ID, [C1, C2, C3]);
      for (const customerId of [C1, C2, C3]) {
        const single = await listOpenReceivableDocs(tx, ORG_ID, customerId);
        expect(normReceivable(batch.get(customerId) ?? [])).toEqual(normReceivable(single));
      }

      // Bukti fixture tidak trivial: C1 tiga dokumen terurut tanggal
      // lintas jenis (penjualan, saldo awal, penjualan).
      const c1 = normReceivable(batch.get(C1) ?? []);
      expect(c1.map((doc) => doc.number)).toEqual(["Q1B-SALE-2", "Q1B-OPEN-AR-1", "Q1B-SALE-1"]);
      expect(c1.map((doc) => doc.outstanding)).toEqual(["30000.0000", "50000.0000", "100000.0000"]);
      expect(batch.get(C2) ?? []).toHaveLength(1);
      expect(batch.get(C3) ?? []).toEqual([]);

      // Sapuan seluruh pelanggan perusahaan (termasuk data seed):
      // setiap pelanggan dari tabel dibandingkan batch vs tunggal.
      const allCustomers = await tx
        .select({ id: customers.id })
        .from(customers)
        .where(eq(customers.companyId, ORG_ID));
      const batchAll = await listOpenReceivableDocsForCustomers(
        tx,
        ORG_ID,
        allCustomers.map((row) => row.id),
      );
      for (const row of allCustomers) {
        const single = await listOpenReceivableDocs(tx, ORG_ID, row.id);
        expect(normReceivable(batchAll.get(row.id) ?? [])).toEqual(normReceivable(single));
      }
    });
  });

  it("utang barang: batch per pemasok identik (termasuk netting alokasi retur & nomor dokumen)", async () => {
    await rollbackTransaction(async (tx) => {
      const warehouse = await defaultWarehouse(tx);
      await seedParties(tx);
      await seedGoodsPayables(tx, warehouse.id);

      const batch = await listSupplierOpenPayableDocsForSuppliers(tx, ORG_ID, [S1, S2, S3]);
      for (const supplierId of [S1, S2, S3]) {
        const single = await listSupplierOpenPayableDocs(tx, ORG_ID, supplierId);
        expect(batch.get(supplierId) ?? []).toEqual(single);
      }

      const s1 = batch.get(S1) ?? [];
      expect(s1.map((doc) => doc.number)).toEqual(["Q1B-RCV-2", "Q1B-OPEN-AP-1", "Q1B-RCV-1"]);
      expect(s1.map((doc) => doc.outstanding)).toEqual(["50000.0000", "80000.0000", "150000.0000"]);
      // Alokasi retur 30.000 ter-net pada penerimaan pertama di batch.
      expect(s1[0].allocated).toBe("30000.0000");
      expect(s1[1].reference).toBe("FAKTUR-LAMA-1");
      expect(batch.get(S2) ?? []).toEqual([]);
      expect(batch.get(S3) ?? []).toEqual([]);

      const allSuppliers = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_ID));
      const batchAll = await listSupplierOpenPayableDocsForSuppliers(
        tx,
        ORG_ID,
        allSuppliers.map((row) => row.id),
      );
      for (const row of allSuppliers) {
        const single = await listSupplierOpenPayableDocs(tx, ORG_ID, row.id);
        expect(batchAll.get(row.id) ?? []).toEqual(single);
      }
    });
  });

  it("utang beban: satu panggilan tanpa pemasok dikelompokkan ≡ per pemasok", async () => {
    await rollbackTransaction(async (tx) => {
      await seedParties(tx);
      await seedExpensePayables(tx);

      // Persis pengelompokan yang dilakukan aksi bootstrap kini.
      const all = await listOpenExpensePayables(tx, ORG_ID);
      const bySupplier = new Map<string, typeof all>();
      for (const row of all) {
        if (!row.supplierId) continue;
        const list = bySupplier.get(row.supplierId) ?? [];
        list.push(row);
        bySupplier.set(row.supplierId, list);
      }
      const norm = (rows: typeof all) =>
        rows.map((row) => ({ id: row.id, outstanding: toDb(row.outstanding) }));
      for (const supplierId of [S1, S2, S3]) {
        const single = await listOpenExpensePayables(tx, ORG_ID, supplierId);
        expect(norm(bySupplier.get(supplierId) ?? [])).toEqual(norm(single));
      }
      expect((bySupplier.get(S1) ?? []).map((row) => row.number)).toEqual(["Q1B-EXP-1", "Q1B-EXP-2"]);
      expect(bySupplier.get(S3) ?? []).toEqual([]);
    });
  });
});
