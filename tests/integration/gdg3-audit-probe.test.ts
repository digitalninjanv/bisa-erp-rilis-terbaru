import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  fiscalPeriods,
  importJobs,
  importRows,
  journalEntries,
  journalLines,
  products,
  purchaseOrders,
  stockOnHand,
  stockReceipts,
  suppliers,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  createAdjustment,
  createOpname,
  createReceipt,
  createTransfer,
  getStock,
} from "@/server/inventory";
import { createPurchaseRequest, decidePurchaseRequest } from "@/server/purchase-requests";
import { createPurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { createReservation, getReservedQuantities } from "@/server/reservations";
import {
  getControlReconciliation,
  getInventoryValuation,
  getStockCard,
} from "@/server/reports";
import { listMovements } from "@/server/catalog";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { rollbackTransaction } from "../helpers/rollback-transaction";

// GDG-3 (A-17) — probe audit gudang lintas/integrasi/izin/skala.
// Perusahaan fixture KHUSUS berkas ini (f701 = A, f702 = B); perusahaan
// demo tidak disentuh. Skenario domain berjalan dalam transaksi
// rollback; probe konkurensi memakai produk berkomit unik per larian.

const ORG_A = "01900000-0000-7000-8000-00000000f701";
const ORG_B = "01900000-0000-7000-8000-00000000f702";
const USER_A = "user-gdg3-a";
const USER_A2 = "user-gdg3-a2";
const TODAY = todayISO();
const CLOSED_DATE = "2026-03-15";
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const mockState = { role: "owner" as string };
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = () => ({
    company: { id: ORG_A },
    user: { id: USER_A },
    role: mockState.role,
  });
  const requirePermission = async () => ctx();
  return { requirePermission, requirePermissionInModule: requirePermission, requireAuth: ctx };
});

class Rollback extends Error {}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const ACCOUNT_SEEDS: Array<[string, string, string, "debit" | "credit"]> = [
  ["1000", "Kas", "asset", "debit"],
  ["1100", "Bank", "asset", "debit"],
  ["1110", "QRIS Clearing", "asset", "debit"],
  ["1200", "Piutang Usaha", "asset", "debit"],
  ["1300", "Persediaan Barang Dagang", "asset", "debit"],
  ["2000", "Utang Usaha", "liability", "credit"],
  ["3000", "Modal Pemilik", "equity", "credit"],
  ["4000", "Penjualan", "revenue", "credit"],
  ["4020", "Retur Penjualan", "revenue", "debit"],
  ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
  ["6050", "Beban Penyusutan Stok", "expense", "debit"],
  ["6060", "Beban Barang Rusak", "expense", "debit"],
  ["1210", "Kredit Pemasok", "asset", "debit"],
];

const MAPPING_SEEDS: Record<string, string> = {
  cash: "1000",
  bank: "1100",
  qris: "1110",
  receivable: "1200",
  inventory: "1300",
  payable: "2000",
  equity: "3000",
  revenue: "4000",
  sales_return: "4020",
  cogs: "5000",
  inventory_shrink: "6050",
  damaged: "6060",
  supplier_credit: "1210",
};

let WH1 = "";
let WH2 = "";
let SUP_A = "";
let PROD_A = "";
let WH_B = "";
let SUP_B = "";
let PROD_B = "";

async function seedCompany(
  tx: Tx,
  companyId: string,
  label: string,
): Promise<{ wh1: string; wh2: string; supplier: string; product: string }> {
  await tx.insert(companySettings).values({
    companyId,
    legalName: `Uji GDG3 ${label}`,
    roundingMode: "none",
    taxRate: "0",
    taxEnabled: false,
    // adjustmentApprovalThreshold SENGAJA diisi null secara eksplisit
    // (perusahaan warisan: gerbang persetujuan nonaktif) — itu bagian
    // dari yang diuji di probe GDG3-10. Sejak FIX-GDG Tahap 3 migrasi
    // 0045 memasang DEFAULT Rp1.000.000 untuk baris BARU, jadi null
    // harus ditulis eksplisit agar fixture ini tetap perusahaan warisan.
    adjustmentApprovalThreshold: null,
  });
  const accountRows = await tx
    .insert(accounts)
    .values(
      ACCOUNT_SEEDS.map(([code, name, type, normalBalance]) => ({
        companyId,
        code,
        name,
        type,
        normalBalance,
      })),
    )
    .returning();
  const acc = new Map(accountRows.map((row) => [row.code, row.id]));
  await tx.insert(accountMappings).values(
    Object.entries(MAPPING_SEEDS).map(([key, code]) => ({
      companyId,
      key,
      accountId: acc.get(code)!,
    })),
  );
  const [wh1] = await tx
    .insert(warehouses)
    .values({ companyId, name: `Gudang Utama ${label}`, code: `GU-${label}` })
    .returning();
  const [wh2] = await tx
    .insert(warehouses)
    .values({ companyId, name: `Gudang Cabang ${label}`, code: `GC-${label}` })
    .returning();
  const [supplier] = await tx
    .insert(suppliers)
    .values({ companyId, code: `SUP-${label}`, name: `PT Pemasok ${label}` })
    .returning();
  const [product] = await tx
    .insert(products)
    .values({
      companyId,
      sku: `GDG3-${label}-001`,
      name: `Produk Fixture ${label}`,
      costPrice: "0",
      salePrice: "25000",
    })
    .returning();
  return { wh1: wh1.id, wh2: wh2.id, supplier: supplier.id, product: product.id };
}

async function ensureFixtures() {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_A}, true)`);
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_A))
      .limit(1);
    if (!existing) {
      const a = await seedCompany(tx, ORG_A, "A");
      WH1 = a.wh1;
      WH2 = a.wh2;
      SUP_A = a.supplier;
      PROD_A = a.product;
      // Periode Maret 2026 DITUTUP sejak awal fixture: baris ini harus
      // ada sebelum posting 2026 mana pun mematerialisasi tahun 2026
      // (ensureFiscalPeriods memakai onConflictDoNothing).
      await tx.insert(fiscalPeriods).values({
        companyId: ORG_A,
        year: 2026,
        month: 3,
        status: "closed",
      });
    }
  });
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.company_id', ${ORG_B}, true)`);
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG_B))
      .limit(1);
    if (!existing) {
      const b = await seedCompany(tx, ORG_B, "B");
      WH_B = b.wh1;
      SUP_B = b.supplier;
      PROD_B = b.product;
      // Satu penerimaan berkomit milik B untuk probe RLS.
      await tx.insert(stockReceipts).values({
        companyId: ORG_B,
        warehouseId: WH_B,
        supplierId: SUP_B,
        source: "purchase",
        number: "RCV-B-GDG3-001",
        date: TODAY,
        status: "posted",
        total: "500000",
        paidAmount: "0",
        paymentStatus: "unpaid",
      });
    }
  });
  if (!WH1 || !WH_B) {
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG_A}, true)`);
      const whs = await tx
        .select({ id: warehouses.id, code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_A));
      WH1 = whs.find((w) => w.code === "GU-A")!.id;
      WH2 = whs.find((w) => w.code === "GC-A")!.id;
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, ORG_A)).limit(1);
      const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.companyId, ORG_A)).limit(1);
      SUP_A = s.id;
      PROD_A = p.id;
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.company_id', ${ORG_B}, true)`);
      const [w] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.companyId, ORG_B)).limit(1);
      const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.companyId, ORG_B)).limit(1);
      const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.companyId, ORG_B)).limit(1);
      WH_B = w.id;
      SUP_B = s.id;
      PROD_B = p.id;
    });
  }
}

beforeAll(ensureFixtures);

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

async function makeProduct(tx: Tx, companyId: string, sku: string): Promise<string> {
  const [row] = await tx
    .insert(products)
    .values({ companyId, sku, name: `Produk ${sku}`, costPrice: "0", salePrice: "10000" })
    .returning({ id: products.id });
  return row.id;
}

async function glBalance(tx: Tx, companyId: string, code: string): Promise<ReturnType<typeof d>> {
  const [account] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.companyId, companyId), eq(accounts.code, code)))
    .limit(1);
  const rows = await tx
    .select({ debit: journalLines.debit, credit: journalLines.credit })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
    .where(
      and(
        eq(journalLines.companyId, companyId),
        eq(journalLines.accountId, account!.id),
        eq(journalEntries.status, "posted"),
      ),
    );
  return rows.reduce((acc, row) => acc.plus(d(row.debit)).minus(d(row.credit)), d(0));
}

async function journalsFor(tx: Tx, companyId: string, sourceId: string) {
  return tx
    .select({ id: journalEntries.id, sourceType: journalEntries.sourceType })
    .from(journalEntries)
    .where(and(eq(journalEntries.companyId, companyId), eq(journalEntries.sourceId, sourceId)));
}

/* ------------------------------------------------------------------ */
/* 1. Integrasi gudang ↔ akuntansi                                     */
/* ------------------------------------------------------------------ */

describe("GDG3 integrasi", () => {
  it("GDG3-01 transfer netral nilai: tanpa jurnal, GL persediaan tetap, stok berpindah", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T01");
      const glStart = await glBalance(tx, ORG_A, "1300");
      const receipt = await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 100, unitCost: 10000 }],
      });
      expect(receipt.number).toBeTruthy();
      const glBefore = await glBalance(tx, ORG_A, "1300");
      expect(glBefore.minus(glStart).toString()).toBe("1000000");

      const doc = await createTransfer(tx, {
        companyId: ORG_A,
        userId: USER_A,
        fromWarehouseId: WH1,
        toWarehouseId: WH2,
        date: TODAY,
        lines: [{ productId, qty: 40 }],
      });
      const docJournals = await journalsFor(tx, ORG_A, doc.id);
      expect(docJournals.length).toBe(0);
      const glAfter = await glBalance(tx, ORG_A, "1300");
      expect(glAfter.toString()).toBe(glBefore.toString());
      const stock = await getStock(tx, ORG_A, WH1, [productId]);
      const stock2 = await getStock(tx, ORG_A, WH2, [productId]);
      expect(stock.get(productId)).toBe(60);
      expect(stock2.get(productId)).toBe(40);
    });
  });

  // DIPERBARUI oleh FIX-GDG Tahap 2: probe audit asli menegaskan
  // perilaku cacat (transfer/opname neto-nol/penerimaan nol bertanggal
  // periode tertutup LOLOS karena tak menjurnal). Kini assertPeriodOpen
  // ditegakkan pada tanggal dokumen stok itu sendiri — semua bentuk
  // dokumen di bawah ditolak dan stok tidak bergerak.
  it("GDG3-02 periode tertutup: SEMUA dokumen stok ditolak, termasuk transfer / opname neto-nol / penerimaan nol (FIX-GDG Tahap 2)", async () => {
    // Kontrol: penerimaan bernilai pada periode tertutup DITOLAK.
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T02A");
      let error = "";
      try {
        await createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_A,
          date: CLOSED_DATE,
          lines: [{ productId, qty: 5, unitCost: 10000 }],
        });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      expect(error).toMatch(/tertutup|ditutup|Periode/i);
    });

    // Transfer bertanggal periode tertutup: dulu lolos karena tidak
    // menjurnal; kini ditolak dari tanggal dokumennya, stok tetap.
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T02B");
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 10, unitCost: 10000 }],
      });
      await expect(
        createTransfer(tx, {
          companyId: ORG_A,
          userId: USER_A,
          fromWarehouseId: WH1,
          toWarehouseId: WH2,
          date: CLOSED_DATE,
          lines: [{ productId, qty: 4 }],
        }),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      const stock2 = await getStock(tx, ORG_A, WH2, [productId]);
      expect(stock2.get(productId) ?? 0).toBe(0);
    });

    // Opname neto-nol (selisih +5 dan −5 bernilai sama) bertanggal
    // periode tertutup: dulu mutasi tetap tercatat; kini ditolak.
    await rollbackTransaction(ORG_A, async (tx) => {
      const p1 = await makeProduct(tx, ORG_A, "GDG3-T02C1");
      const p2 = await makeProduct(tx, ORG_A, "GDG3-T02C2");
      for (const p of [p1, p2]) {
        await createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_A,
          date: TODAY,
          lines: [{ productId: p, qty: 10, unitCost: 100000 }],
        });
      }
      await expect(
        createOpname(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          date: CLOSED_DATE,
          lines: [
            { productId: p1, countedQty: 15 },
            { productId: p2, countedQty: 5 },
          ],
        }),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      const s1 = await getStock(tx, ORG_A, WH1, [p1]);
      const s2 = await getStock(tx, ORG_A, WH1, [p2]);
      expect(s1.get(p1)).toBe(10);
      expect(s2.get(p2)).toBe(10);
    });

    // Penerimaan bernilai nol (harga 0) bertanggal periode tertutup:
    // dulu stok tetap masuk; kini ditolak.
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T02D");
      await expect(
        createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_A,
          date: CLOSED_DATE,
          lines: [{ productId, qty: 7, unitCost: 0 }],
        }),
      ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });
      const stock = await getStock(tx, ORG_A, WH1, [productId]);
      expect(stock.get(productId) ?? 0).toBe(0);
    });
  });

  // DIPERBARUI oleh FIX-GDG Tahap 2: probe audit asli menegaskan
  // selisih palsu Rp1.000.000 (subledger dari createdAt + costPrice
  // berjalan). Kini subledger membaca mutasi bertanggal dokumen pada
  // unitCost gerakannya — delta selisih as-of lampau = 0.
  it("GDG3-03 rekonsiliasi kontrol persediaan: penerimaan backdated selaras pada as-of lampau, selisih 0 (FIX-GDG Tahap 2)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T03");
      const asOfMid = daysAgo(15);
      // Baseline SEBELUM penerimaan ini, dalam transaksi yang sama —
      // selisih perusahaan fixture dari probe lain (termasuk residu
      // balapan GDG3-16) tidak mengotori asersi: yang diuji adalah
      // DELTA yang disumbang penerimaan backdated ini.
      const baseMid = (await getControlReconciliation(tx, ORG_A, asOfMid)).legs.find(
        (l) => l.key === "inventory",
      )!;
      const baseToday = (await getControlReconciliation(tx, ORG_A, TODAY)).legs.find(
        (l) => l.key === "inventory",
      )!;
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: daysAgo(30),
        lines: [{ productId, qty: 10, unitCost: 100000 }],
      });
      const leg = (await getControlReconciliation(tx, ORG_A, asOfMid)).legs.find(
        (l) => l.key === "inventory",
      )!;
      // Kedua kaki kini bertanggal dokumen: GL bertambah Rp1.000.000
      // DAN subledger (mutasi bertanggal dokumen × unitCost gerakan)
      // bertambah Rp1.000.000 — selisih tidak bergerak.
      expect(leg.gl - baseMid.gl).toBe(1000000);
      expect(leg.subledger - baseMid.subledger).toBe(1000000);
      expect(leg.difference - baseMid.difference).toBe(0);
      // Kontrol: per hari ini penerimaan yang sama selaras sempurna.
      const legToday = (await getControlReconciliation(tx, ORG_A, TODAY)).legs.find(
        (l) => l.key === "inventory",
      )!;
      expect(legToday.difference - baseToday.difference).toBe(0);
    });
  });

  // DIPERBARUI oleh FIX-GDG Tahap 1: probe audit asli menegaskan
  // perilaku cacat (faktur sama diterima dua kali, utang ganda). Kini
  // probe yang sama menjadi test regresi perilaku sesudah perbaikan.
  it("GDG3-04 nomor faktur pemasok yang sama DITOLAK pada penerimaan kedua (FIX-GDG Tahap 1)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T04");
      const first = await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        supplierInvoiceNumber: "INV-GDG3-001",
        date: TODAY,
        lines: [{ productId, qty: 5, unitCost: 20000 }],
      });
      const receiptIds: string[] = [first.id];
      await expect(
        createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_A,
          supplierInvoiceNumber: "INV-GDG3-001",
          date: TODAY,
          lines: [{ productId, qty: 5, unitCost: 20000 }],
        }),
      ).rejects.toThrow(new RegExp(`sudah dipakai pada penerimaan ${first.number}`));
      const receipts = await tx
        .select({ id: stockReceipts.id })
        .from(stockReceipts)
        .where(
          and(
            eq(stockReceipts.companyId, ORG_A),
            eq(stockReceipts.supplierInvoiceNumber, "INV-GDG3-001"),
          ),
        );
      expect(receipts.length).toBe(1);
      // Utang yang dibukukan untuk kedua dokumen ini (tercakup dokumen):
      const [payableAccount] = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_A), eq(accountMappings.key, "payable")))
        .limit(1);
      const lines = await tx
        .select({ credit: journalLines.credit })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalLines.companyId, ORG_A),
            eq(journalLines.accountId, payableAccount.accountId),
            inArray(journalEntries.sourceId, receiptIds),
          ),
        );
      const credited = lines.reduce((acc, row) => acc.plus(d(row.credit)), d(0));
      expect(credited.toString()).toBe("100000"); // utang tercatat SATU kali
    });
  });

  it("GDG3-05 opname menjaring selisih antar produk: susut Rp500rb + surplus Rp500rb tanpa jurnal sama sekali", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const p1 = await makeProduct(tx, ORG_A, "GDG3-T05A");
      const p2 = await makeProduct(tx, ORG_A, "GDG3-T05B");
      for (const p of [p1, p2]) {
        await createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_A,
          date: TODAY,
          lines: [{ productId: p, qty: 10, unitCost: 100000 }],
        });
      }
      const doc = await createOpname(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        lines: [
          { productId: p1, countedQty: 5 },
          { productId: p2, countedQty: 15 },
        ],
      });
      const docJournals = await journalsFor(tx, ORG_A, doc.id);
      expect(docJournals.length).toBe(0); // neto 0 → tidak ada jurnal susut/surplus
      // Mutasinya sendiri tetap terjadi dua arah:
      const s1 = await getStock(tx, ORG_A, WH1, [p1]);
      const s2 = await getStock(tx, ORG_A, WH1, [p2]);
      expect(s1.get(p1)).toBe(5);
      expect(s2.get(p2)).toBe(15);
    });
  });

  it("GDG3-06 submit ganda penerimaan: dua dokumen, stok ganda, jurnal ganda (tanpa kunci idempotensi)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T06");
      const input = {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 10, unitCost: 10000 }],
      };
      const r1 = await createReceipt(tx, input);
      const r2 = await createReceipt(tx, input);
      expect(r1.id).not.toBe(r2.id);
      const stock = await getStock(tx, ORG_A, WH1, [productId]);
      expect(stock.get(productId)).toBe(20);
      const j1 = await journalsFor(tx, ORG_A, r1.id);
      const j2 = await journalsFor(tx, ORG_A, r2.id);
      expect(j1.length + j2.length).toBe(2);
    });
  });

  // DIPERBARUI oleh FIX-GDG Tahap 1: probe audit asli menegaskan
  // perilaku cacat (referensi lintas perusahaan diterima). Kini probe
  // yang sama menjadi test regresi perilaku sesudah perbaikan.
  it("GDG3-07 gudang & pemasok perusahaan lain DITOLAK (FIX-GDG Tahap 1)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T07");
      // Gudang milik perusahaan B pada penerimaan perusahaan A ditolak.
      await expect(
        createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH_B,
          supplierId: SUP_A,
          date: TODAY,
          lines: [{ productId, qty: 6, unitCost: 10000 }],
        }),
      ).rejects.toThrow(/Gudang tidak ditemukan di perusahaan ini/);
      // Pemasok milik perusahaan B pada penerimaan perusahaan A ditolak.
      await expect(
        createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP_B,
          date: TODAY,
          lines: [{ productId, qty: 6, unitCost: 10000 }],
        }),
      ).rejects.toThrow(/Pemasok tidak ditemukan di perusahaan ini/);
      const stock = await getStock(tx, ORG_A, WH_B, [productId]);
      expect(stock.get(productId) ?? 0).toBe(0);
    });
  });

  // DIPERBARUI oleh FIX-GDG Tahap 2 (GDG1-08): probe audit asli
  // menegaskan qty negatif di domain MEMBALIK arah mutasi. Kini domain
  // menolak qty ≤ 0 seperti lapisan aksi — arah mutasi tidak terbalik
  // dan stok tidak bergerak.
  it("GDG3-08 transfer qty negatif DITOLAK di lapisan domain (FIX-GDG Tahap 2)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T08");
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH2,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 10, unitCost: 10000 }],
      });
      await expect(
        createTransfer(tx, {
          companyId: ORG_A,
          userId: USER_A,
          fromWarehouseId: WH1,
          toWarehouseId: WH2,
          date: TODAY,
          lines: [{ productId, qty: -5 }],
        }),
      ).rejects.toMatchObject({ code: "VALIDATION" });
      const s1 = await getStock(tx, ORG_A, WH1, [productId]);
      const s2 = await getStock(tx, ORG_A, WH2, [productId]);
      expect(s1.get(productId) ?? 0).toBe(0);
      expect(s2.get(productId)).toBe(10);
    });
  });
});

/* ------------------------------------------------------------------ */
/* 2. Izin peran warehouse                                             */
/* ------------------------------------------------------------------ */

describe("GDG3 izin", () => {
  it("GDG3-09 PR: pembuat tidak bisa menyetujui PR sendiri; PO: pembuat yang sama bisa membuat + mengirim tanpa checker", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-T09");
      const pr = await createPurchaseRequest(tx, {
        companyId: ORG_A,
        userId: USER_A,
        date: TODAY,
        lines: [{ productId, qty: 2, estimatedPrice: 5000 }],
      });
      let error = "";
      try {
        await decidePurchaseRequest(tx, {
          companyId: ORG_A,
          actor: { userId: USER_A, role: "warehouse" },
          requestId: pr.id,
          approve: true,
        });
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      expect(error).toMatch(/maker-checker|tidak boleh mengesahkan/i);
      // Kontrol: pengguna lain boleh memutuskan.
      const decided = await decidePurchaseRequest(tx, {
        companyId: ORG_A,
        actor: { userId: USER_A2, role: "warehouse" },
        requestId: pr.id,
        approve: true,
      });
      expect(decided.status).toBe("approved");

      // PO tidak punya gerbang persetujuan sama sekali: pengguna yang
      // sama membuat draft lalu mengirimnya sendiri.
      const po = await createPurchaseOrder(tx, {
        companyId: ORG_A,
        userId: USER_A,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 1, unitCost: 5000 }],
      });
      await sendPurchaseOrder(tx, {
        companyId: ORG_A,
        userId: USER_A,
        orderId: po.id,
      });
      const [poRow] = await tx
        .select({ status: purchaseOrders.status })
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, po.id))
        .limit(1);
      expect(poRow.status).toBe("sent");
    });
  });

  it("GDG3-10 tanpa ambang persetujuan terkonfigurasi, penghapusan stok Rp50jt langsung posted oleh satu pengguna", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const [settings] = await tx
        .select({ threshold: companySettings.adjustmentApprovalThreshold })
        .from(companySettings)
        .where(eq(companySettings.companyId, ORG_A))
        .limit(1);
      expect(settings?.threshold ?? null).toBeNull(); // perusahaan warisan: null eksplisit (perusahaan BARU kini berambang bawaan — FIX-GDG Tahap 3)

      const productId = await makeProduct(tx, ORG_A, "GDG3-T10");
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 100, unitCost: 1000000 }],
      });
      const result = await createAdjustment(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        type: "damaged",
        reason: "Rusak di gudang",
        lines: [{ productId, qty: 50 }],
      });
      expect(result.status).toBe("posted"); // bukan "pending"
      const docJournals = await journalsFor(tx, ORG_A, result.id);
      expect(docJournals.length).toBe(1);
      const [damagedAccount] = await tx
        .select({ accountId: accountMappings.accountId })
        .from(accountMappings)
        .where(and(eq(accountMappings.companyId, ORG_A), eq(accountMappings.key, "damaged")))
        .limit(1);
      const lines = await tx
        .select({ debit: journalLines.debit })
        .from(journalLines)
        .where(
          and(
            eq(journalLines.companyId, ORG_A),
            eq(journalLines.accountId, damagedAccount.accountId),
            eq(journalLines.entryId, docJournals[0].id),
          ),
        );
      const debited = lines.reduce((acc, row) => acc.plus(d(row.debit)), d(0));
      expect(debited.toString()).toBe("50000000");
    });
  });

  it("GDG3-11 peran warehouse DITOLAK mengubah harga jual produk lewat aksi simpan produk (FIX-GDG Tahap 3)", async () => {
    const before = await withCompanyReadOnly(ORG_A, async (tx) => {
      const [row] = await tx
        .select({ salePrice: products.salePrice, name: products.name, sku: products.sku, costPrice: products.costPrice })
        .from(products)
        .where(eq(products.id, PROD_A))
        .limit(1);
      return row;
    });
    // Mock sesi probe tidak membawa daftar izin, jadi can() di dalam
    // aksi jatuh ke katalog peran bawaan sungguhan lewat role — persis
    // jalur yang membuktikan seed peran warehouse tidak (lagi) memuat
    // izin inventory.price.
    mockState.role = "warehouse";
    try {
      const result = await saveProductAction({
        id: PROD_A,
        name: before.name,
        sku: before.sku,
        costPrice: before.costPrice,
        salePrice: "777000",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe("FORBIDDEN");
      const after = await withCompanyReadOnly(ORG_A, async (tx) => {
        const [row] = await tx
          .select({ salePrice: products.salePrice })
          .from(products)
          .where(eq(products.id, PROD_A))
          .limit(1);
        return row;
      });
      expect(after.salePrice).toBe(before.salePrice);
    } finally {
      mockState.role = "owner";
    }
  });

  it("GDG3-12 RLS: perusahaan A tidak dapat membaca/menulis baris perusahaan B", async () => {
    const outcome = { read: -1, updated: -1, insertError: "" };
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.company_id', ${ORG_A}, true)`);
        const rows = await tx
          .select({ id: stockReceipts.id })
          .from(stockReceipts)
          .where(eq(stockReceipts.companyId, ORG_B));
        outcome.read = rows.length;
        const updated = await tx
          .update(products)
          .set({ name: "DIBAJAK" })
          .where(eq(products.id, PROD_B))
          .returning({ id: products.id });
        outcome.updated = updated.length;
        try {
          await tx.insert(stockOnHand).values({
            companyId: ORG_B,
            warehouseId: WH_B,
            productId: PROD_B,
            qty: "1",
          });
        } catch (e) {
          const err = e as Error & { cause?: Error };
          outcome.insertError = `${err.message} :: ${err.cause?.message ?? ""}`;
        }
        throw new Rollback("selesai probe RLS");
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(outcome.read).toBe(0);
    expect(outcome.updated).toBe(0);
    expect(outcome.insertError).toMatch(/row-level security/i);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Ketahanan & konkurensi                                           */
/* ------------------------------------------------------------------ */

describe("GDG3 ketahanan", () => {
  it("GDG3-13 dua penyesuaian bersamaan berebut stok yang sama: tepat satu yang berhasil", async () => {
    const sku = `GDG3-CC1-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 10, unitCost: 10000 }],
      });
    });
    const attempt = (userId: string) =>
      withCompany(ORG_A, (tx) =>
        createAdjustment(tx, {
          companyId: ORG_A,
          userId,
          warehouseId: WH1,
          date: TODAY,
          type: "damaged",
          reason: "Rusak bersamaan",
          lines: [{ productId, qty: 7 }],
        }),
      );
    const results = await Promise.allSettled([attempt(USER_A), attempt(USER_A2)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(1);
    const stock = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(stock.get(productId)).toBe(3);
  });

  it("GDG3-14 dua reservasi bersamaan dapat melebihi stok tersedia (baca tanpa kunci)", async () => {
    const sku = `GDG3-CC2-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
      await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP_A,
        date: TODAY,
        lines: [{ productId, qty: 10, unitCost: 10000 }],
      });
    });
    const attempt = (userId: string) =>
      withCompany(ORG_A, (tx) =>
        createReservation(tx, {
          companyId: ORG_A,
          userId,
          warehouseId: WH1,
          productId,
          qty: 8,
          date: TODAY,
        }),
      );
    const results = await Promise.allSettled([attempt(USER_A), attempt(USER_A2)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const reserved = await withCompanyReadOnly(ORG_A, (tx) =>
      getReservedQuantities(tx, ORG_A, WH1, [productId]),
    );
    // Dicatat apa adanya: fulfilled=2 & reserved=16 berarti over-reservasi
    // terbukti; fulfilled=1 berarti balapan tidak terpicu pada larian ini.
    console.log(`GDG3-14 fulfilled=${fulfilled} reserved=${reserved.get(productId)?.toString() ?? "0"}`);
    expect(fulfilled).toBeGreaterThanOrEqual(1);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Impor: berkas duplikat & commit bersamaan                        */
/* ------------------------------------------------------------------ */

const IMPORT_MAPPING = {
  name: "Nama",
  sku: "SKU",
  costPrice: "Harga Beli",
  salePrice: "Harga Jual",
  stock: "Stok",
  minStock: "Stok Minimum",
};

async function makeImportJob(sku: string, fileName: string): Promise<string> {
  let jobId = "";
  await withCompany(ORG_A, async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        companyId: ORG_A,
        entity: "products",
        fileName,
        status: "preview",
        totalRows: 1,
        mapping: IMPORT_MAPPING,
        createdBy: USER_A,
      })
      .returning({ id: importJobs.id });
    jobId = job.id;
    await tx.insert(importRows).values({
      companyId: ORG_A,
      jobId: job.id,
      rowNumber: 1,
      status: "pending",
      data: {
        Nama: `Produk Impor ${sku}`,
        SKU: sku,
        "Harga Beli": "10000",
        "Harga Jual": "15000",
        Stok: "10",
        "Stok Minimum": "0",
      },
    });
  });
  return jobId;
}

describe("GDG3 impor", () => {
  it("GDG3-15 berkas yang sama diimpor dua kali (job baru) menggandakan stok awal & jurnal modal", async () => {
    const sku = `GDG3-IMP-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
    });
    const commit = async (jobId: string) => {
      const result = await commitImportBatchAction({
        jobId,
        mapping: IMPORT_MAPPING,
        limit: 250,
        updateExisting: true,
        importStock: true,
        warehouseId: WH1,
      });
      expect(result.ok).toBe(true);
    };
    const job1 = await makeImportJob(sku, "gdg3-dup.csv");
    await commit(job1);
    const afterFirst = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(afterFirst.get(productId)).toBe(10);

    const job2 = await makeImportJob(sku, "gdg3-dup.csv");
    await commit(job2);
    const afterSecond = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(afterSecond.get(productId)).toBe(20); // stok awal tercatat DUA kali

    const openingJournals = await withCompanyReadOnly(ORG_A, async (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_A),
            eq(journalEntries.sourceType, "opening"),
            inArray(journalEntries.sourceId, [job1, job2]),
          ),
        ),
    );
    expect(openingJournals.length).toBe(2);
  });

  it("GDG3-16 dua commit bersamaan atas job yang sama", async () => {
    const sku = `GDG3-IMPCC-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
    });
    const jobId = await makeImportJob(sku, "gdg3-race.csv");
    const commit = () =>
      commitImportBatchAction({
        jobId,
        mapping: IMPORT_MAPPING,
        limit: 250,
        updateExisting: true,
        importStock: true,
        warehouseId: WH1,
      });
    const results = await Promise.allSettled([commit(), commit()]);
    const stock = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    const openingJournals = await withCompanyReadOnly(ORG_A, async (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.companyId, ORG_A),
            eq(journalEntries.sourceType, "opening"),
            eq(journalEntries.sourceId, jobId),
          ),
        ),
    );
    const okCount = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
    console.log(
      `GDG3-16 ok=${okCount} stok=${stock.get(productId)} jurnalPembuka=${openingJournals.length}`,
    );
    expect(stock.get(productId)).toBeGreaterThanOrEqual(10);
  });
});

/* ------------------------------------------------------------------ */
/* 5. Performa pada data fabrikasi (di dalam transaksi rollback)       */
/* ------------------------------------------------------------------ */

describe("GDG3 performa", () => {
  it(
    "GDG3-17 kartu stok halaman dalam, daftar pergerakan, dan valuasi pada 30rb mutasi / 5rb produk",
    async () => {
      const timings: Record<string, number> = {};
      await rollbackTransaction(ORG_A, async (tx) => {
        const targetId = await makeProduct(tx, ORG_A, "GDG3-PERF-TARGET");
        await tx.execute(sql`
          insert into products (company_id, sku, name, cost_price, sale_price)
          select ${ORG_A}, 'PERF-' || g, 'Produk Perf ' || g, 1000, 2000
          from generate_series(1, 5000) as g
        `);
        await tx.execute(sql`
          insert into stock_on_hand (company_id, warehouse_id, product_id, qty)
          select ${ORG_A}, ${WH1}, p.id, 3
          from products p
          where p.company_id = ${ORG_A} and p.sku like 'PERF-%'
        `);
        await tx.execute(sql`
          insert into stock_movements (company_id, warehouse_id, product_id, movement_type, qty, unit_cost, created_at)
          select ${ORG_A}, ${WH1}, ${targetId}, 'purchase', 1, 1000,
                 timestamp '2026-01-01 00:00:00' + (g || ' minutes')::interval
          from generate_series(1, 30000) as g
        `);

        const time = async (label: string, fn: () => Promise<unknown>) => {
          const start = performance.now();
          await fn();
          timings[label] = Math.round(performance.now() - start);
        };

        await time("stockCardPage1", () =>
          getStockCard(tx, ORG_A, targetId, { warehouseId: WH1, page: 1, pageSize: 100 }),
        );
        await time("stockCardPage300", () =>
          getStockCard(tx, ORG_A, targetId, { warehouseId: WH1, page: 300, pageSize: 100 }),
        );
        await time("listMovementsSearch", () =>
          listMovements(tx, { companyId: ORG_A, q: "GDG3-PERF-TARGET", page: 1, pageSize: 30 }),
        );
        await time("valuationPage1", () =>
          getInventoryValuation(tx, ORG_A, undefined, { page: 1, pageSize: 50 }),
        );
        await time("valuationFull", () => getInventoryValuation(tx, ORG_A));
      });
      console.log("GDG3-17 timings(ms):", JSON.stringify(timings));
      expect(timings.stockCardPage1).toBeGreaterThan(0);
    },
    300000,
  );
});
