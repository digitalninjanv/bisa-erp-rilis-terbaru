import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accountMappings,
  accounts,
  companySettings,
  importJobs,
  importRows,
  journalEntries,
  products,
  stockDocuments,
  stockReceipts,
  supplierReturns,
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
  voidReceipt,
} from "@/server/inventory";
import {
  createSupplierReturn,
  postSupplierReturn,
} from "@/server/supplier-returns";
import { commitImportBatchAction } from "@/server/actions/import/commit";
import { POST as postImportParse } from "@/app/api/import/parse/route";
import { hashImportFile } from "@/server/import-files";
import { todayISO } from "@/lib/format";
import { rollbackTransaction } from "../helpers/rollback-transaction";

// FIX-GDG Tahap 1 (A-17) — plafon & kepemilikan:
//   GDG1-01 plafon asal-usul retur pembelian (per pemasok × produk)
//   GDG3-07 validasi kepemilikan setenant referensi dokumen gudang
//   GDG3-16 commit impor dikunci (balapan dua commit)
//   GDG3-15 sidik berkas impor (hash) anti impor ulang
//   GDG3-06 kunci idempotensi dokumen gudang (pola POS)
//   GDG3-04 nomor faktur pemasok duplikat pada penerimaan
// Perusahaan fixture KHUSUS berkas ini (d101 = A, d102 = B); perusahaan
// demo tidak disentuh. Skenario domain dalam transaksi rollback; probe
// konkurensi berkomit di perusahaan fixture dengan SKU unik per larian.

const ORG_A = "01900000-0000-7000-8000-00000000d101";
const ORG_B = "01900000-0000-7000-8000-00000000d102";
const USER_A = "user-fix-gdg1-a";
const TODAY = todayISO();

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = () => ({
    company: { id: ORG_A },
    user: { id: USER_A },
    role: "owner",
  });
  const requirePermission = async () => ctx();
  return { requirePermission, requirePermissionInModule: requirePermission, requireAuth: ctx };
});

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
let SUP1 = "";
let SUP2 = "";
let WH_B = "";
let SUP_B = "";

async function seedCompany(
  tx: Tx,
  companyId: string,
  label: string,
  supplierCount: number,
): Promise<{ wh1: string; wh2: string; supplierIds: string[] }> {
  await tx.insert(companySettings).values({
    companyId,
    legalName: `Uji FIX-GDG1 ${label}`,
    roundingMode: "none",
    taxRate: "0",
    taxEnabled: false,
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
  const supplierIds: string[] = [];
  for (let i = 1; i <= supplierCount; i += 1) {
    const [supplier] = await tx
      .insert(suppliers)
      .values({ companyId, code: `SUP-${label}${i}`, name: `PT Pemasok ${label}${i}` })
      .returning();
    supplierIds.push(supplier.id);
  }
  return { wh1: wh1.id, wh2: wh2.id, supplierIds };
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
      const a = await seedCompany(tx, ORG_A, "A", 2);
      WH1 = a.wh1;
      WH2 = a.wh2;
      SUP1 = a.supplierIds[0];
      SUP2 = a.supplierIds[1];
    } else {
      const whs = await tx
        .select({ id: warehouses.id, code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_A));
      WH1 = whs.find((w) => w.code === "GU-A")!.id;
      WH2 = whs.find((w) => w.code === "GC-A")!.id;
      const sups = await tx
        .select({ id: suppliers.id, code: suppliers.code })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_A));
      SUP1 = sups.find((s) => s.code === "SUP-A1")!.id;
      SUP2 = sups.find((s) => s.code === "SUP-A2")!.id;
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
      const b = await seedCompany(tx, ORG_B, "B", 1);
      WH_B = b.wh1;
      SUP_B = b.supplierIds[0];
    } else {
      const [w] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG_B))
        .limit(1);
      const [s] = await tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(eq(suppliers.companyId, ORG_B))
        .limit(1);
      WH_B = w.id;
      SUP_B = s.id;
    }
  });
}

beforeAll(ensureFixtures);

async function makeProduct(tx: Tx, companyId: string, sku: string): Promise<string> {
  const [product] = await tx
    .insert(products)
    .values({
      companyId,
      sku,
      name: `Produk ${sku}`,
      costPrice: "0",
      salePrice: "25000",
    })
    .returning({ id: products.id });
  return product.id;
}

async function buy(
  tx: Tx,
  input: {
    supplierId: string;
    productId: string;
    qty: string;
    unitCost?: string;
    warehouseId?: string;
    supplierInvoiceNumber?: string;
  },
) {
  return createReceipt(tx, {
    companyId: ORG_A,
    userId: USER_A,
    warehouseId: input.warehouseId ?? WH1,
    supplierId: input.supplierId,
    source: "purchase",
    date: TODAY,
    supplierInvoiceNumber: input.supplierInvoiceNumber,
    lines: [{ productId: input.productId, qty: input.qty, unitCost: input.unitCost ?? "10000" }],
  });
}

async function makeReturn(
  tx: Tx,
  input: { supplierId: string; productId: string; qty: string },
) {
  return createSupplierReturn(tx, {
    companyId: ORG_A,
    userId: USER_A,
    supplierId: input.supplierId,
    warehouseId: WH1,
    date: TODAY,
    reasonCategory: "damaged",
    reasonDetail: "Barang rusak saat diterima di gudang",
    resolutionType: "next_purchase_credit",
    lines: [{ productId: input.productId, qty: input.qty }],
  });
}

/* ------------------------------------------------------------------ */
/* GDG1-01 — plafon asal-usul retur pembelian                          */
/* ------------------------------------------------------------------ */

describe("GDG1-01 plafon retur pembelian per pemasok × produk", () => {
  it("retur 40 ke pemasok yang hanya menjual 5 ditolak walau pemasok lain menjual 50", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG1-PLAFON-1");
      await buy(tx, { supplierId: SUP2, productId, qty: "50" });
      await buy(tx, { supplierId: SUP1, productId, qty: "5" });

      await expect(
        makeReturn(tx, { supplierId: SUP1, productId, qty: "40" }),
      ).rejects.toThrow(/melebihi sisa yang dapat diretur/);
      await expect(
        makeReturn(tx, { supplierId: SUP1, productId, qty: "40" }),
      ).rejects.toThrow(/pernah diterima 5/);

      // Batas persis tetap sah: retur tepat sebesar yang diterima.
      const ok = await makeReturn(tx, { supplierId: SUP1, productId, qty: "5" });
      expect(ok.id).toBeTruthy();
      // Pemasok lain tetap bisa diretur sampai batas penerimaannya sendiri.
      const okB = await makeReturn(tx, { supplierId: SUP2, productId, qty: "40" });
      expect(okB.id).toBeTruthy();
    });
  });

  it("retur kumulatif terposting dihitung: 3 + 3 atas 5, yang kedua ditolak", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG1-PLAFON-2");
      await buy(tx, { supplierId: SUP1, productId, qty: "5" });

      const first = await makeReturn(tx, { supplierId: SUP1, productId, qty: "3" });
      await postSupplierReturn(tx, { companyId: ORG_A, userId: USER_A, returnId: first.id });

      await expect(
        makeReturn(tx, { supplierId: SUP1, productId, qty: "3" }),
      ).rejects.toThrow(/sisa yang dapat diretur 2/);

      const second = await makeReturn(tx, { supplierId: SUP1, productId, qty: "2" });
      await postSupplierReturn(tx, { companyId: ORG_A, userId: USER_A, returnId: second.id });

      await expect(
        makeReturn(tx, { supplierId: SUP1, productId, qty: "1" }),
      ).rejects.toThrow(/sisa yang dapat diretur 0/);

      const stock = await getStock(tx, ORG_A, WH1, [productId]);
      expect(stock.get(productId)).toBe(0);
    });
  });

  it("balapan: dua posting retur 4 + 4 atas penerimaan 5 — tepat satu lolos", async () => {
    const sku = `GDG1-RACE-${Date.now()}`;
    let productId = "";
    let returnA = "";
    let returnB = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
      await buy(tx, { supplierId: SUP1, productId, qty: "5" });
      const a = await makeReturn(tx, { supplierId: SUP1, productId, qty: "4" });
      const b = await makeReturn(tx, { supplierId: SUP1, productId, qty: "4" });
      returnA = a.id;
      returnB = b.id;
    });

    const results = await Promise.allSettled([
      withCompany(ORG_A, (tx) =>
        postSupplierReturn(tx, { companyId: ORG_A, userId: USER_A, returnId: returnA }),
      ),
      withCompany(ORG_A, (tx) =>
        postSupplierReturn(tx, { companyId: ORG_A, userId: USER_A, returnId: returnB }),
      ),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);

    const stock = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(stock.get(productId)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-07 — validasi kepemilikan setenant                             */
/* ------------------------------------------------------------------ */

describe("GDG3-07 referensi lintas perusahaan ditolak", () => {
  it("penerimaan: gudang & pemasok perusahaan lain ditolak, milik sendiri lolos", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-OWN-1");
      await expect(
        buy(tx, { supplierId: SUP1, productId, qty: "2", warehouseId: WH_B }),
      ).rejects.toThrow(/Gudang tidak ditemukan di perusahaan ini/);
      await expect(
        buy(tx, { supplierId: SUP_B, productId, qty: "2" }),
      ).rejects.toThrow(/Pemasok tidak ditemukan di perusahaan ini/);
      const ok = await buy(tx, { supplierId: SUP1, productId, qty: "2" });
      expect(ok.id).toBeTruthy();
    });
  });

  it("penyesuaian, transfer, opname: gudang/pemasok asing ditolak", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-OWN-2");
      await buy(tx, { supplierId: SUP1, productId, qty: "10" });

      await expect(
        createAdjustment(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH_B,
          date: TODAY,
          type: "damaged",
          reason: "Barang rusak di rak",
          lines: [{ productId, qty: "1" }],
        }),
      ).rejects.toThrow(/Gudang tidak ditemukan di perusahaan ini/);

      await expect(
        createAdjustment(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          date: TODAY,
          type: "damaged",
          reason: "Barang rusak di rak",
          supplierId: SUP_B,
          lines: [{ productId, qty: "1" }],
        }),
      ).rejects.toThrow(/Pemasok tidak ditemukan di perusahaan ini/);

      await expect(
        createTransfer(tx, {
          companyId: ORG_A,
          userId: USER_A,
          fromWarehouseId: WH1,
          toWarehouseId: WH_B,
          date: TODAY,
          lines: [{ productId, qty: "1" }],
        }),
      ).rejects.toThrow(/Gudang tujuan tidak ditemukan di perusahaan ini/);

      await expect(
        createTransfer(tx, {
          companyId: ORG_A,
          userId: USER_A,
          fromWarehouseId: WH_B,
          toWarehouseId: WH1,
          date: TODAY,
          lines: [{ productId, qty: "1" }],
        }),
      ).rejects.toThrow(/Gudang asal tidak ditemukan di perusahaan ini/);

      await expect(
        createOpname(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH_B,
          date: TODAY,
          lines: [{ productId, countedQty: "9" }],
        }),
      ).rejects.toThrow(/Gudang tidak ditemukan di perusahaan ini/);
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-04 — nomor faktur pemasok duplikat                             */
/* ------------------------------------------------------------------ */

describe("GDG3-04 nomor faktur pemasok duplikat", () => {
  it("faktur sama untuk pemasok sama ditolak menyebut dokumen pertama; pemasok lain & sesudah void tetap sah", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-INV-1");
      const first = await buy(tx, {
        supplierId: SUP1,
        productId,
        qty: "2",
        supplierInvoiceNumber: "INV-GDG-900",
      });

      await expect(
        buy(tx, { supplierId: SUP1, productId, qty: "2", supplierInvoiceNumber: "INV-GDG-900" }),
      ).rejects.toThrow(new RegExp(`sudah dipakai pada penerimaan ${first.number}`));

      // Normalisasi: spasi & huruf besar/kecil tidak mengelabui.
      await expect(
        buy(tx, { supplierId: SUP1, productId, qty: "2", supplierInvoiceNumber: " inv-gdg-900 " }),
      ).rejects.toThrow(/sudah dipakai pada penerimaan/);

      // Pemasok berbeda dengan nomor faktur sama adalah hal yang sah.
      const other = await buy(tx, {
        supplierId: SUP2,
        productId,
        qty: "2",
        supplierInvoiceNumber: "INV-GDG-900",
      });
      expect(other.id).toBeTruthy();

      // Sesudah penerimaan pertama di-void, nomor faktur bebas dipakai lagi.
      await voidReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        receiptId: first.id,
        reason: "Faktur salah catat, diterima ulang",
        date: TODAY,
      });
      const again = await buy(tx, {
        supplierId: SUP1,
        productId,
        qty: "2",
        supplierInvoiceNumber: "INV-GDG-900",
      });
      expect(again.id).toBeTruthy();
    });
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-06 — kunci idempotensi dokumen gudang                          */
/* ------------------------------------------------------------------ */

describe("GDG3-06 kunci idempotensi dokumen gudang", () => {
  it("submit ganda berkunci sama mengembalikan dokumen pertama (penerimaan & retur)", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-IDEM-1");
      const key = "11111111-1111-4111-8111-111111111111";
      const first = await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        idempotencyKey: key,
        lines: [{ productId, qty: "10", unitCost: "10000" }],
      });
      const replay = await createReceipt(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        supplierId: SUP1,
        source: "purchase",
        date: TODAY,
        idempotencyKey: key,
        lines: [{ productId, qty: "10", unitCost: "10000" }],
      });
      expect(replay.id).toBe(first.id);
      expect(replay.number).toBe(first.number);
      const stock = await getStock(tx, ORG_A, WH1, [productId]);
      expect(stock.get(productId)).toBe(10);
      const [counted] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReceipts)
        .where(and(eq(stockReceipts.companyId, ORG_A), eq(stockReceipts.idempotencyKey, key)));
      expect(counted.value).toBe(1);

      const returnKey = "22222222-2222-4222-8222-222222222222";
      const draft = await createSupplierReturn(tx, {
        companyId: ORG_A,
        userId: USER_A,
        supplierId: SUP1,
        warehouseId: WH1,
        date: TODAY,
        reasonCategory: "damaged",
        reasonDetail: "Barang rusak saat diterima di gudang",
        resolutionType: "refund",
        idempotencyKey: returnKey,
        lines: [{ productId, qty: "2" }],
      });
      const draftReplay = await createSupplierReturn(tx, {
        companyId: ORG_A,
        userId: USER_A,
        supplierId: SUP1,
        warehouseId: WH1,
        date: TODAY,
        reasonCategory: "damaged",
        reasonDetail: "Barang rusak saat diterima di gudang",
        resolutionType: "refund",
        idempotencyKey: returnKey,
        lines: [{ productId, qty: "2" }],
      });
      expect(draftReplay.id).toBe(draft.id);
      const [returnCount] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(supplierReturns)
        .where(and(eq(supplierReturns.companyId, ORG_A), eq(supplierReturns.idempotencyKey, returnKey)));
      expect(returnCount.value).toBe(1);
    });
  });

  it("submit ganda berkunci sama: penyesuaian, transfer, opname masing-masing satu dokumen", async () => {
    await rollbackTransaction(ORG_A, async (tx) => {
      const productId = await makeProduct(tx, ORG_A, "GDG3-IDEM-2");
      await buy(tx, { supplierId: SUP1, productId, qty: "20" });

      const adjKey = "33333333-3333-4333-8333-333333333333";
      const adj = await createAdjustment(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        type: "damaged",
        reason: "Barang pecah di rak pajang",
        idempotencyKey: adjKey,
        lines: [{ productId, qty: "2" }],
      });
      const adjReplay = await createAdjustment(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        type: "damaged",
        reason: "Barang pecah di rak pajang",
        idempotencyKey: adjKey,
        lines: [{ productId, qty: "2" }],
      });
      expect(adjReplay.id).toBe(adj.id);

      const trKey = "44444444-4444-4444-8444-444444444444";
      const transfer = await createTransfer(tx, {
        companyId: ORG_A,
        userId: USER_A,
        fromWarehouseId: WH1,
        toWarehouseId: WH2,
        date: TODAY,
        idempotencyKey: trKey,
        lines: [{ productId, qty: "3" }],
      });
      const transferReplay = await createTransfer(tx, {
        companyId: ORG_A,
        userId: USER_A,
        fromWarehouseId: WH1,
        toWarehouseId: WH2,
        date: TODAY,
        idempotencyKey: trKey,
        lines: [{ productId, qty: "3" }],
      });
      expect(transferReplay.id).toBe(transfer.id);

      const opKey = "55555555-5555-4555-8555-555555555555";
      const opname = await createOpname(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        idempotencyKey: opKey,
        lines: [{ productId, countedQty: "14" }],
      });
      const opnameReplay = await createOpname(tx, {
        companyId: ORG_A,
        userId: USER_A,
        warehouseId: WH1,
        date: TODAY,
        idempotencyKey: opKey,
        lines: [{ productId, countedQty: "14" }],
      });
      expect(opnameReplay.id).toBe(opname.id);

      const [docCount] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocuments)
        .where(
          and(
            eq(stockDocuments.companyId, ORG_A),
            sql`${stockDocuments.idempotencyKey} in (${adjKey}, ${trKey}, ${opKey})`,
          ),
        );
      expect(docCount.value).toBe(3);

      // Stok bergerak tepat sekali per dokumen: 20 − 2 rusak − 3 pindah
      // − 1 selisih opname (15 tercatat → dihitung 14) = 14 di WH1, 3 di WH2.
      const stock1 = await getStock(tx, ORG_A, WH1, [productId]);
      const stock2 = await getStock(tx, ORG_A, WH2, [productId]);
      expect(stock1.get(productId)).toBe(14);
      expect(stock2.get(productId)).toBe(3);
    });
  });

  it("balapan: dua submit penerimaan bersamaan berkunci sama menghasilkan satu dokumen", async () => {
    const sku = `GDG3-IDEM-RACE-${Date.now()}`;
    // Kunci harus unik per larian: test ini berkomit, dan replay atas
    // kunci larian sebelumnya memang WAJIB mengembalikan dokumen lama.
    const key = `idem-race-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
    });
    const submit = () =>
      withCompany(ORG_A, (tx) =>
        createReceipt(tx, {
          companyId: ORG_A,
          userId: USER_A,
          warehouseId: WH1,
          supplierId: SUP1,
          source: "purchase",
          date: TODAY,
          idempotencyKey: key,
          lines: [{ productId, qty: "7", unitCost: "10000" }],
        }),
      );
    const results = await Promise.allSettled([submit(), submit()]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(2);
    const ids = new Set(
      fulfilled.map((r) => (r as PromiseFulfilledResult<{ id: string }>).value.id),
    );
    expect(ids.size).toBe(1);
    const stock = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(stock.get(productId)).toBe(7);
  });
});

/* ------------------------------------------------------------------ */
/* GDG3-15 & GDG3-16 — impor: sidik berkas & kunci commit              */
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

async function commitJob(jobId: string) {
  return commitImportBatchAction({
    jobId,
    mapping: IMPORT_MAPPING,
    limit: 250,
    updateExisting: true,
    importStock: true,
    warehouseId: WH1,
  });
}

describe("GDG3-16 commit impor dikunci", () => {
  it("dua commit bersamaan atas job yang sama menerapkan stok & jurnal tepat sekali", async () => {
    const sku = `GDG3-LOCK-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
    });
    const jobId = await makeImportJob(sku, "gdg-lock.csv");
    const results = await Promise.allSettled([commitJob(jobId), commitJob(jobId)]);
    const okCount = results.filter(
      (r) => r.status === "fulfilled" && (r.value as { ok: boolean }).ok,
    ).length;
    expect(okCount).toBeGreaterThanOrEqual(1);

    const stock = await withCompanyReadOnly(ORG_A, (tx) => getStock(tx, ORG_A, WH1, [productId]));
    expect(stock.get(productId)).toBe(10);
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
    expect(openingJournals).toHaveLength(1);
  });
});

describe("GDG3-15 sidik berkas impor", () => {
  it("hash isi berkas stabil dan peka terhadap isi", () => {
    const a = Buffer.from("Nama,SKU\nProduk A,SKU-1\n");
    const b = Buffer.from("Nama,SKU\nProduk A,SKU-1\n");
    const c = Buffer.from("Nama,SKU\nProduk A,SKU-2\n");
    expect(hashImportFile(a)).toBe(hashImportFile(b));
    expect(hashImportFile(a)).not.toBe(hashImportFile(c));
    expect(hashImportFile(a)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("berkas identik sesudah diterapkan ditolak di unggah & di commit; berkas berbeda tetap jalan", async () => {
    const sku = `GDG3-HASH-${Date.now()}`;
    let productId = "";
    await withCompany(ORG_A, async (tx) => {
      productId = await makeProduct(tx, ORG_A, sku);
    });

    const csvText = [
      "Nama,SKU,Harga Beli,Harga Jual,Stok,Stok Minimum",
      `Produk Hash,${sku},10000,15000,10,0`,
    ].join("\n");
    const upload = async (name: string, text: string) => {
      const form = new FormData();
      form.set("entity", "products");
      form.set("file", new File([text], name, { type: "text/csv" }));
      const res = await postImportParse(
        new Request("http://localhost/api/import/parse", { method: "POST", body: form }),
      );
      return { status: res.status, body: (await res.json()) as { jobId?: string; error?: string } };
    };

    const first = await upload("berkas-sama.csv", csvText);
    expect(first.status).toBe(200);
    const job1 = first.body.jobId!;
    const [job1Row] = await withCompanyReadOnly(ORG_A, async (tx) =>
      tx
        .select({ fileHash: importJobs.fileHash })
        .from(importJobs)
        .where(eq(importJobs.id, job1)),
    );
    expect(job1Row.fileHash).toBe(hashImportFile(Buffer.from(csvText)));

    // Job kedua dari berkas yang sama BOLEH dibuat selama belum ada
    // yang diterapkan (pratinjau yang terbengkalai tidak mengunci).
    const second = await upload("berkas-sama.csv", csvText);
    expect(second.status).toBe(200);
    const job2 = second.body.jobId!;

    const committed = await commitJob(job1);
    expect(committed.ok).toBe(true);
    const stockAfterFirst = await withCompanyReadOnly(ORG_A, (tx) =>
      getStock(tx, ORG_A, WH1, [productId]),
    );
    expect(stockAfterFirst.get(productId)).toBe(10);

    // Unggah ketiga dari berkas yang sama: ditolak, menyebut job asal.
    const third = await upload("berkas-sama.csv", csvText);
    expect(third.status).toBe(409);
    expect(third.body.error).toContain("berkas-sama.csv");

    // Commit job kedua (dibuat sebelum job pertama diterapkan) juga
    // tertahan oleh penjaga commit — stok tidak boleh ganda.
    const blockedCommit = await commitJob(job2);
    expect(blockedCommit.ok).toBe(false);
    if (!blockedCommit.ok) expect(blockedCommit.code).toBe("CONFLICT");
    const stockFinal = await withCompanyReadOnly(ORG_A, (tx) =>
      getStock(tx, ORG_A, WH1, [productId]),
    );
    expect(stockFinal.get(productId)).toBe(10);

    // Berkas yang isinya berbeda tetap dapat diunggah.
    const otherSku = `GDG3-HASH-LAIN-${Date.now()}`;
    const otherText = [
      "Nama,SKU,Harga Beli,Harga Jual,Stok,Stok Minimum",
      `Produk Lain,${otherSku},10000,15000,5,0`,
    ].join("\n");
    const other = await upload("berkas-lain.csv", otherText);
    expect(other.status).toBe(200);
  });
});
