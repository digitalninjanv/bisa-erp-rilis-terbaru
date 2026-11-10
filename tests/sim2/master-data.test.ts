import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  auditLog,
  branches,
  categories,
  companySettings,
  customers,
  member,
  organization,
  products,
  stockOnHand,
  suppliers,
  units,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import {
  PRODUCT_EXPORT_HEADERS,
  listCustomersFiltered,
  listProductsForExport,
  listSuppliersFiltered,
  toProductExportRow,
} from "@/server/catalog";
import { ENTITY_FIELDS, suggestMapping, suggestMappingFor } from "@/lib/import-parse";
import {
  saveCustomerAction,
  saveSupplierAction,
} from "@/server/actions/inventory/pihak";
import {
  applyBulkEditProducts,
  findPartyDuplicates,
  findSimilarParties,
  getPartyDetail,
  mergeParties,
  previewBulkEditProducts,
  previewPartyMerge,
} from "@/server/master-data";
import { createOpeningBalance } from "@/server/opening-balances";
import { createReceipt } from "@/server/inventory";
import { listPayables, listReceivables } from "@/server/reports";
import { payPayableFifo } from "@/server/quick-entry";
import {
  applyBulkEditProductsAction,
  previewBulkEditProductsAction,
} from "@/server/actions/master-data";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 Fase S3 — Master Data Management (§18).
 *
 * Perusahaan fixture khusus (…cc03) yang tidak dipakai suite lain;
 * beforeAll/afterAll membersihkan seluruh perusahaan fixture (pola
 * sim-bisnis.test.ts). Setiap batch S3 punya blok describe sendiri;
 * ekspektasi nominal dihitung tangan dari data fixture.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000cc03" },
    user: { id: "01900000-0000-7000-8000-00000000cc13" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000cc03";
const OWNER = "01900000-0000-7000-8000-00000000cc13";
const TODAY = todayISO();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function run<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withCompany(ORG, fn);
}
function read<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withCompanyReadOnly(ORG, fn);
}


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

const F = {
  wh: "",
  catMinuman: "",
  catMinumanRingan: "",
  catMakanan: "",
  unit: "",
  sup1: "",
  cashAccount: "",
  prod: {} as Record<string, string>,
};

async function bootstrapFixture() {
  await wipeFixture();

  await adminDb.insert(user).values({
    id: OWNER,
    name: "Dewi Masterdata",
    email: "owner@masterdata.id",
    emailVerified: true,
    role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(),
    accountId: OWNER,
    providerId: "credential",
    userId: OWNER,
    password: "x",
  });
  await adminDb.insert(organization).values({
    id: ORG,
    name: "MasterData Mart",
    slug: "masterdata-mart",
    createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(),
    organizationId: ORG,
    userId: OWNER,
    role: "owner",
    createdAt: new Date(),
  });

  const [branch] = await adminDb
    .insert(branches)
    .values({ companyId: ORG, code: "BR-MD", name: "MD Pusat", isDefault: true })
    .returning();
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, branchId: branch.id, code: "WH-MD", name: "Gudang MD", type: "warehouse", isDefault: true })
    .returning();
  F.wh = wh.id;

  await adminDb.insert(companySettings).values({
    companyId: ORG,
    legalName: "MasterData Mart",
    defaultWarehouseId: wh.id,
    roundingMode: "none",
    taxRate: "0",
    allowNegativeStock: false,
  });

  const accountSeeds: Array<[string, string, string, "debit" | "credit"]> = [
    ["1000", "Kas", "asset", "debit"],
    ["1100", "Bank BCA", "asset", "debit"],
    ["1110", "QRIS Clearing", "asset", "debit"],
    ["1200", "Piutang Usaha", "asset", "debit"],
    ["1210", "Kredit Pemasok", "asset", "debit"],
    ["1220", "Piutang Karyawan", "asset", "debit"],
    ["1300", "Persediaan Barang Dagang", "asset", "debit"],
    ["2000", "Utang Usaha", "liability", "credit"],
    ["2100", "Utang Gaji", "liability", "credit"],
    ["2200", "PPN Keluaran", "liability", "credit"],
    ["2300", "Kredit Pelanggan", "liability", "credit"],
    ["3000", "Modal Pemilik", "equity", "credit"],
    ["4000", "Penjualan", "revenue", "credit"],
    ["4010", "Diskon Penjualan", "revenue", "debit"],
    ["4020", "Retur Penjualan", "revenue", "debit"],
    ["5000", "Harga Pokok Penjualan", "cogs", "debit"],
    ["5010", "Selisih Persediaan", "cogs", "debit"],
    ["5020", "Barang Rusak dan Kedaluwarsa", "cogs", "debit"],
    ["6000", "Beban Gaji Karyawan", "expense", "debit"],
    ["6060", "Beban Administrasi Bank", "expense", "debit"],
    ["8000", "Selisih Kas Kurang", "expense", "debit"],
    ["8001", "Selisih Kas Lebih", "revenue", "credit"],
    ["9000", "Pembulatan Penjualan (Laba)", "revenue", "credit"],
    ["9001", "Selisih Pembulatan (Rugi)", "expense", "debit"],
  ];
  const accountRows = await adminDb
    .insert(accounts)
    .values(
      accountSeeds.map(([code, name, type, normalBalance]) => ({
        companyId: ORG, code, name, type, normalBalance,
        // A-27 B2: akun terpetakan cash/bank/qris berkelas (invariant B1).
        cashBankKind: code === "1000" ? "cash" : code === "1100" ? "bank" : code === "1110" ? "clearing" : null,
      })),
    )
    .returning();
  const acc: Record<string, string> = {};
  for (const row of accountRows) acc[row.code] = row.id;
  const mapping: Record<string, string> = {
    cash: acc["1000"], bank: acc["1100"], qris: acc["1110"],
    receivable: acc["1200"], supplier_credit: acc["1210"],
    employee_receivable: acc["1220"], inventory: acc["1300"],
    payable: acc["2000"], revenue: acc["4000"],
    sales_discount: acc["4010"], sales_return: acc["4020"],
    cogs: acc["5000"], inventory_shrink: acc["5010"], damaged: acc["5020"],
    tax_output: acc["2200"], rounding_gain: acc["9000"],
    rounding_loss: acc["9001"], cash_short: acc["8000"],
    cash_over: acc["8001"], salary_expense: acc["6000"],
    salary_payable: acc["2100"], bank_fee: acc["6060"],
    equity: acc["3000"], customer_credit: acc["2300"],
  };
  await adminDb.insert(accountMappings).values(
    Object.entries(mapping).map(([key, accountId]) => ({ companyId: ORG, key, accountId })),
  );
  F.cashAccount = acc["1000"];

  const [catMinuman] = await adminDb.insert(categories).values({ companyId: ORG, name: "MD Minuman" }).returning();
  const [catRingan] = await adminDb
    .insert(categories)
    .values({ companyId: ORG, name: "MD Minuman Ringan", parentId: catMinuman.id })
    .returning();
  const [catMakanan] = await adminDb.insert(categories).values({ companyId: ORG, name: "MD Makanan" }).returning();
  F.catMinuman = catMinuman.id;
  F.catMinumanRingan = catRingan.id;
  F.catMakanan = catMakanan.id;

  const [unit] = await adminDb.insert(units).values({ companyId: ORG, code: "PCS", name: "Pieces" }).returning();
  F.unit = unit.id;

  const [sup1] = await adminDb
    .insert(suppliers)
    .values({ companyId: ORG, code: "MD-SUP-1", name: "PT MD Sumber Satu", phone: "0811000111" })
    .returning();
  F.sup1 = sup1.id;
  await adminDb.insert(suppliers).values([
    { companyId: ORG, code: "MD-SUP-2", name: "PT MD Sumber Dua", phone: "0822000222", isActive: false },
    { companyId: ORG, code: "MD-SUP-3", name: "CV MD Tiga", phone: "0833000333" },
  ]);
  await adminDb.insert(customers).values([
    { companyId: ORG, code: "MD-CUS-1", name: "Toko MD Berkah", phone: "0844000444", creditLimit: "2000000" },
    { companyId: ORG, code: "MD-CUS-2", name: "Ibu MD Sari", phone: "0855000555", isActive: false },
  ]);

  const productSeeds = [
    { key: "aqua", sku: "MD-001", name: "MD Aqua 600ml", categoryId: catRingan.id, costPrice: "2500", salePrice: "4000", minStock: "10", stock: "100", isActive: true },
    { key: "teh", sku: "MD-002", name: "MD Teh Botol", categoryId: catRingan.id, costPrice: "3000", salePrice: "5000", minStock: "50", stock: "10", isActive: true },
    { key: "indomie", sku: "MD-003", name: "MD Indomie Goreng", categoryId: catMakanan.id, costPrice: "2800", salePrice: "3500", minStock: "0", stock: "5", isActive: true },
    { key: "galon", sku: "MD-004", name: "MD Aqua Galon", categoryId: catMinuman.id, costPrice: "15000", salePrice: "20000", minStock: "0", stock: "0", isActive: false },
    { key: "kopi", sku: "MD-005", name: "MD Kopi Sachet", categoryId: null, costPrice: "1200", salePrice: "2000", minStock: "0", stock: "0", isActive: true },
  ];
  for (const seed of productSeeds) {
    const [row] = await adminDb
      .insert(products)
      .values({
        companyId: ORG,
        sku: seed.sku,
        name: seed.name,
        categoryId: seed.categoryId,
        unitId: unit.id,
        supplierId: sup1.id,
        costPrice: seed.costPrice,
        salePrice: seed.salePrice,
        minStock: seed.minStock,
        isActive: seed.isActive,
      })
      .returning();
    F.prod[seed.key] = row.id;
    if (seed.stock !== "0") {
      await adminDb.insert(stockOnHand).values({
        companyId: ORG,
        warehouseId: wh.id,
        productId: row.id,
        qty: seed.stock,
      });
    }
  }
}

beforeAll(bootstrapFixture);
afterAll(wipeFixture);

/* ------------------------------------------------------------------ */
/* Batch 1 — ekspor mengikuti filter + ekspor produk                   */
/* ------------------------------------------------------------------ */

describe("S3 Batch 1 — ekspor master mengikuti filter", () => {
  it("ekspor produk tanpa filter memuat semua produk termasuk nonaktif", async () => {
    const rows = await read((tx) =>
      listProductsForExport(tx, { companyId: ORG, warehouseId: F.wh, activeOnly: false }),
    );
    expect(rows.map((r) => r.sku)).toEqual(["MD-001", "MD-004", "MD-003", "MD-005", "MD-002"]);
    const aqua = rows.find((r) => r.sku === "MD-001")!;
    expect(aqua.categoryName).toBe("MD Minuman Ringan");
    expect(aqua.unitName).toBe("Pieces");
    expect(aqua.supplierName).toBe("PT MD Sumber Satu");
  });

  it("ekspor produk menghormati kata kunci q", async () => {
    const rows = await read((tx) =>
      listProductsForExport(tx, { companyId: ORG, warehouseId: F.wh, q: "aqua", activeOnly: false }),
    );
    expect(rows.map((r) => r.sku).sort()).toEqual(["MD-001", "MD-004"]);
  });

  it("ekspor produk menghormati filter kategori termasuk keturunannya", async () => {
    const rows = await read((tx) =>
      listProductsForExport(tx, {
        companyId: ORG,
        warehouseId: F.wh,
        categoryId: F.catMinuman,
        activeOnly: false,
      }),
    );
    expect(rows.map((r) => r.sku).sort()).toEqual(["MD-001", "MD-002", "MD-004"]);
  });

  it("ekspor produk menghormati filter stok menipis (aturan D-4)", async () => {
    const rows = await read((tx) =>
      listProductsForExport(tx, { companyId: ORG, warehouseId: F.wh, lowStock: true, activeOnly: false }),
    );
    // Teh: stok 10 <= minimum 50. Galon (0 <= 0) dan Kopi (0 <= 0) ikut
    // menurut aturan D-4 (qty <= minStock) — sama seperti daftar produk
    // dan observasi OBS-1 pada S1.
    expect(rows.map((r) => r.sku).sort()).toEqual(["MD-002", "MD-004", "MD-005"]);
  });

  it("header ekspor produk terpetakan penuh oleh pemetaan impor (round-trip)", () => {
    const mapping = suggestMapping([...PRODUCT_EXPORT_HEADERS]);
    expect(mapping.sku).toBe("Kode Barang");
    expect(mapping.name).toBe("Nama Barang");
    expect(mapping.barcode).toBe("Barcode");
    expect(mapping.category).toBe("Kategori");
    expect(mapping.unit).toBe("Satuan");
    expect(mapping.supplier).toBe("Pemasok");
    expect(mapping.costPrice).toBe("Harga Beli");
    expect(mapping.salePrice).toBe("Harga Jual");
    expect(mapping.minStock).toBe("Stok Minimum");
    expect(mapping.notes).toBe("Keterangan");
    // Kolom stok awal TIDAK boleh terpetakan: ekspor master tidak boleh
    // memposting stok awal saat diimpor kembali.
    expect(mapping.stock).toBeUndefined();
  });

  it("baris ekspor produk membawa nilai master yang dapat diimpor ulang", async () => {
    const rows = await read((tx) =>
      listProductsForExport(tx, { companyId: ORG, warehouseId: F.wh, q: "MD-001", activeOnly: false }),
    );
    const cells = toProductExportRow(rows[0]);
    expect(cells[0]).toBe("MD-001");
    expect(cells[6]).toBe("2500.00");
    expect(cells[7]).toBe("4000.00");
    expect(cells[8]).toBe("10");
    expect(cells[11]).toBe("Aktif");
  });

  it("daftar pihak tersaring q + status dipakai bersama halaman & ekspor", async () => {
    const all = await read((tx) => listSuppliersFiltered(tx, ORG, {}));
    expect(all).toHaveLength(3);
    const aktif = await read((tx) => listSuppliersFiltered(tx, ORG, { status: "aktif" }));
    expect(aktif.map((r) => r.code).sort()).toEqual(["MD-SUP-1", "MD-SUP-3"]);
    const nonaktif = await read((tx) => listSuppliersFiltered(tx, ORG, { status: "nonaktif" }));
    expect(nonaktif.map((r) => r.code)).toEqual(["MD-SUP-2"]);
    const byPhone = await read((tx) => listSuppliersFiltered(tx, ORG, { q: "0822000222" }));
    expect(byPhone.map((r) => r.code)).toEqual(["MD-SUP-2"]);
    const byName = await read((tx) => listSuppliersFiltered(tx, ORG, { q: "sumber" }));
    expect(byName.map((r) => r.code).sort()).toEqual(["MD-SUP-1", "MD-SUP-2"]);

    const customersAktif = await read((tx) => listCustomersFiltered(tx, ORG, { status: "aktif" }));
    expect(customersAktif.map((r) => r.code)).toEqual(["MD-CUS-1"]);
    expect(d(customersAktif[0].creditLimit).toNumber()).toBe(2000000);
  });
});

/* ------------------------------------------------------------------ */
/* Batch 2 — audit create/update pihak                                 */
/* ------------------------------------------------------------------ */

describe("S3 Batch 2 — audit create/update pihak", () => {
  it("membuat pemasok menulis audit supplier.create berisi snapshot", async () => {
    const result = await saveSupplierAction({
      code: "MD-AUD-1",
      name: "PT Audit Satu",
      phone: "0861000001",
      email: "audit1@contoh.id",
      address: "Jl. Audit No. 1",
      notes: "pemasok uji audit",
    });
    expect(result.ok).toBe(true);
    const audits = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.companyId, ORG), eq(auditLog.action, "supplier.create")))
        .orderBy(asc(auditLog.createdAt)),
    );
    const mine = audits.filter((row) => (row.after as { code?: string })?.code === "MD-AUD-1");
    expect(mine).toHaveLength(1);
    expect(mine[0].entityType).toBe("supplier");
    expect(mine[0].userId).toBe(OWNER);
    expect(mine[0].before).toBeNull();
    expect((mine[0].after as { name?: string }).name).toBe("PT Audit Satu");
    if (result.ok) {
      expect(mine[0].entityId).toBe(result.data.id);
    }
  });

  it("mengubah pemasok menulis audit supplier.update berisi before/after", async () => {
    const created = await saveSupplierAction({ code: "MD-AUD-2", name: "PT Audit Dua", phone: "0861000002" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await saveSupplierAction({
      id: created.data.id,
      code: "MD-AUD-2",
      name: "PT Audit Dua Revisi",
      phone: "0861000999",
    });
    expect(updated.ok).toBe(true);
    const audits = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG),
            eq(auditLog.action, "supplier.update"),
            eq(auditLog.entityId, created.data.id),
          ),
        ),
    );
    expect(audits).toHaveLength(1);
    expect((audits[0].before as { name?: string }).name).toBe("PT Audit Dua");
    expect((audits[0].after as { name?: string }).name).toBe("PT Audit Dua Revisi");
    expect((audits[0].after as { phone?: string }).phone).toBe("0861000999");
  });

  it("membuat & mengubah pelanggan menulis audit, termasuk perubahan batas kredit", async () => {
    const created = await saveCustomerAction({
      code: "MD-AUD-C1",
      name: "Toko Audit Pelanggan",
      phone: "0862000001",
      creditLimit: "1000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const updated = await saveCustomerAction({
      id: created.data.id,
      code: "MD-AUD-C1",
      name: "Toko Audit Pelanggan",
      phone: "0862000001",
      creditLimit: "7500000",
    });
    expect(updated.ok).toBe(true);
    const rows = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.companyId, ORG), eq(auditLog.entityId, created.data.id)))
        .orderBy(asc(auditLog.createdAt)),
    );
    const actions = rows.map((row) => row.action);
    expect(actions).toContain("customer.create");
    expect(actions).toContain("customer.update");
    const update = rows.find((row) => row.action === "customer.update")!;
    expect(d((update.before as { creditLimit: string }).creditLimit).toNumber()).toBe(1000000);
    expect(d((update.after as { creditLimit: string }).creditLimit).toNumber()).toBe(7500000);
  });
});

/* ------------------------------------------------------------------ */
/* Batch 3 — bulk edit produk berpreview                               */
/* ------------------------------------------------------------------ */

describe("S3 Batch 3 — bulk edit produk berpreview", () => {
  it("pratinjau kenaikan harga persen menampilkan sebelum→sesudah TANPA mengubah data", async () => {
    const preview = await read((tx) =>
      previewBulkEditProducts(tx, {
        companyId: ORG,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.aqua, F.prod.teh] },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "5" },
      }),
    );
    expect(preview.totalSelected).toBe(2);
    expect(preview.changedCount).toBe(2);
    expect(preview.errorCount).toBe(0);
    const aqua = preview.changes.find((row) => row.id === F.prod.aqua)!;
    expect(aqua.changes[0]).toMatchObject({ field: "salePrice", before: "4000.00", after: "4200.00" });
    const teh = preview.changes.find((row) => row.id === F.prod.teh)!;
    expect(teh.changes[0].after).toBe("5250.00");

    // Pratinjau murni baca: harga di basis data tidak berubah.
    const [row] = await read((tx) =>
      tx.select({ salePrice: products.salePrice }).from(products).where(eq(products.id, F.prod.aqua)),
    );
    expect(row.salePrice).toBe("4000.0000");
  });

  it("terapkan +5% ke 200 produk hasil filter cocok hitungan & teraudit satu baris per batch", async () => {
    const [category] = await adminDb
      .insert(categories)
      .values({ companyId: ORG, name: "MD Massal" })
      .returning();
    await adminDb.insert(products).values(
      Array.from({ length: 200 }, (_, index) => ({
        companyId: ORG,
        sku: `MD-BULK-${String(index + 1).padStart(3, "0")}`,
        name: `MD Produk Massal ${index + 1}`,
        categoryId: category.id,
        unitId: F.unit,
        costPrice: "8000",
        salePrice: "10000",
        minStock: "0",
      })),
    );

    const result = await run((tx) =>
      applyBulkEditProducts(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        selection: { mode: "filter", categoryId: category.id },
        operation: { kind: "price", target: "salePrice", mode: "percent", value: "5" },
      }),
    );
    expect(result.applied).toHaveLength(200);
    expect(result.skipped).toHaveLength(0);

    const rows = await read((tx) =>
      tx
        .select({ salePrice: products.salePrice })
        .from(products)
        .where(eq(products.categoryId, category.id)),
    );
    expect(rows).toHaveLength(200);
    for (const row of rows) expect(row.salePrice).toBe("10500.0000");

    const audits = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.companyId, ORG), eq(auditLog.action, "product.bulk_edit"))),
    );
    const batch = audits.filter(
      (row) => (row.after as { appliedCount?: number })?.appliedCount === 200,
    );
    expect(batch).toHaveLength(1);
    expect((batch[0].after as { appliedIds: string[] }).appliedIds).toHaveLength(200);
  });

  it("baris yang membuat harga negatif dilewati & dilaporkan, baris lain tetap diterapkan", async () => {
    const preview = await read((tx) =>
      previewBulkEditProducts(tx, {
        companyId: ORG,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.kopi, F.prod.indomie] },
        operation: { kind: "price", target: "salePrice", mode: "nominal", value: "-2500" },
      }),
    );
    // Kopi 2000 − 2500 = negatif → error. Indomie 3500 − 2500 = 1000 → berubah.
    expect(preview.errorCount).toBe(1);
    expect(preview.errors[0].sku).toBe("MD-005");
    expect(preview.changedCount).toBe(1);

    const result = await run((tx) =>
      applyBulkEditProducts(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.kopi, F.prod.indomie] },
        operation: { kind: "price", target: "salePrice", mode: "nominal", value: "-2500" },
      }),
    );
    expect(result.applied.map((row) => row.sku)).toEqual(["MD-003"]);
    expect(result.skipped.map((row) => row.sku)).toEqual(["MD-005"]);

    const prices = await read((tx) =>
      tx
        .select({ sku: products.sku, salePrice: products.salePrice })
        .from(products)
        .where(and(eq(products.companyId, ORG), eq(products.sku, "MD-003"))),
    );
    expect(prices[0].salePrice).toBe("1000.0000");
    const kopi = await read((tx) =>
      tx.select({ salePrice: products.salePrice }).from(products).where(eq(products.id, F.prod.kopi)),
    );
    expect(kopi[0].salePrice).toBe("2000.0000");

    // Kembalikan harga Indomie untuk test berikutnya.
    await adminDb.update(products).set({ salePrice: "3500" }).where(eq(products.id, F.prod.indomie));
  });

  it("operasi kategori, status aktif, dan stok minimum berjalan lewat jalur yang sama", async () => {
    const result = await run((tx) =>
      applyBulkEditProducts(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.kopi] },
        operation: { kind: "category", categoryId: F.catMakanan },
      }),
    );
    expect(result.applied).toHaveLength(1);
    const [kopi] = await read((tx) => tx.select().from(products).where(eq(products.id, F.prod.kopi)));
    expect(kopi.categoryId).toBe(F.catMakanan);

    // Operasi yang sama dua kali: kedua kalinya tercatat "tidak berubah".
    const again = await run((tx) =>
      applyBulkEditProducts(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.kopi] },
        operation: { kind: "category", categoryId: F.catMakanan },
      }),
    );
    expect(again.applied).toHaveLength(0);
    expect(again.unchangedCount).toBe(1);

    const minStock = await run((tx) =>
      applyBulkEditProducts(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        selection: { mode: "ids", ids: [F.prod.kopi] },
        operation: { kind: "minStock", value: "7" },
      }),
    );
    expect(minStock.applied).toHaveLength(1);
    const [after] = await read((tx) => tx.select().from(products).where(eq(products.id, F.prod.kopi)));
    expect(d(after.minStock).toNumber()).toBe(7);
    await adminDb.update(products).set({ categoryId: null, minStock: "0" }).where(eq(products.id, F.prod.kopi));
  });

  it("aksi penerapan menolak tanpa konfirmasi eksplisit", async () => {
    const result = await applyBulkEditProductsAction({
      selection: { mode: "ids", ids: [F.prod.aqua] },
      operation: { kind: "active", isActive: false },
      // @ts-expect-error — confirm sengaja dihilangkan untuk membuktikan penjaga server
      confirm: undefined,
    });
    expect(result.ok).toBe(false);
  });

  it("aksi pratinjau & terapkan berjalan ujung-ke-ujung lewat sesi", async () => {
    const preview = await previewBulkEditProductsAction({
      selection: { mode: "ids", ids: [F.prod.galon] },
      operation: { kind: "active", isActive: true },
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.data.changedCount).toBe(1);
      expect(preview.data.changes[0].changes[0]).toMatchObject({ before: "Nonaktif", after: "Aktif" });
    }
    const applied = await applyBulkEditProductsAction({
      selection: { mode: "ids", ids: [F.prod.galon] },
      operation: { kind: "active", isActive: true },
      confirm: true,
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) expect(applied.data.appliedCount).toBe(1);
    const [galon] = await read((tx) => tx.select().from(products).where(eq(products.id, F.prod.galon)));
    expect(galon.isActive).toBe(true);
    await adminDb.update(products).set({ isActive: false }).where(eq(products.id, F.prod.galon));
  });
});

/* ------------------------------------------------------------------ */
/* Batch 4 — deteksi duplikat + halaman detail pihak                   */
/* ------------------------------------------------------------------ */

describe("S3 Batch 4 — deteksi duplikat & detail pihak", () => {
  const dup = { a: "", b: "", control: "" };

  beforeAll(async () => {
    const rows = await adminDb
      .insert(suppliers)
      .values([
        { companyId: ORG, code: "MD-DUP-A", name: "PT Sumber Makmur Abadi", phone: "0812-3456-7890" },
        { companyId: ORG, code: "MD-DUP-B", name: "PT Sumber Makmur Abadii", phone: "+62 812-3456-7890" },
        { companyId: ORG, code: "MD-DUP-C", name: "UD Bintang Timur Sejahtera", phone: "0899-1111-2222" },
      ])
      .returning();
    dup.a = rows[0].id;
    dup.b = rows[1].id;
    dup.control = rows[2].id;
  });

  it("pasangan nama mirip + telepon sama format berbeda terdeteksi sebagai duplikat", async () => {
    const pairs = await read((tx) => findPartyDuplicates(tx, ORG, "supplier"));
    const mine = pairs.filter(
      (pair) =>
        [pair.a.id, pair.b.id].includes(dup.a) && [pair.a.id, pair.b.id].includes(dup.b),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].reasons.join(" ")).toMatch(/telepon sama/i);
    expect(mine[0].reasons.join(" ")).toMatch(/nama mirip/i);
    expect(mine[0].nameSimilarity).toBeGreaterThan(0.8);
    // Pihak kontrol yang jelas berbeda tidak boleh muncul berpasangan
    // dengan siapa pun.
    const controlPairs = pairs.filter(
      (pair) => pair.a.id === dup.control || pair.b.id === dup.control,
    );
    expect(controlPairs).toHaveLength(0);
  });

  it("pencarian kemiripan untuk nama baru menemukan pihak yang sudah ada (peringatan lembut)", async () => {
    const matches = await read((tx) =>
      findSimilarParties(tx, ORG, "supplier", { name: "PT Sumber Makmur Abadi" }),
    );
    const ids = matches.map((match) => match.id);
    expect(ids).toContain(dup.a);
    expect(ids).toContain(dup.b);
    expect(ids).not.toContain(dup.control);
    // Pihak itu sendiri dikecualikan saat edit.
    const selfExcluded = await read((tx) =>
      findSimilarParties(tx, ORG, "supplier", {
        name: "PT Sumber Makmur Abadi",
        excludeId: dup.a,
      }),
    );
    expect(selfExcluded.map((match) => match.id)).not.toContain(dup.a);
  });

  it("detail pemasok: saldo sama dengan subledger utang & riwayat terbaca", async () => {
    const created = await saveSupplierAction({
      code: "MD-DET-1",
      name: "PT Detail Utang",
      phone: "0871000001",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const supplierId = created.data.id;

    // Saldo awal utang 1.500.000 + penerimaan kredit 10 × 3.000 = 30.000.
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG,
        userId: OWNER,
        kind: "payable",
        partyId: supplierId,
        date: TODAY,
        amount: "1500000",
        reference: "FAKTUR-LAMA-1",
      }),
    );
    await run((tx) =>
      createReceipt(tx, {
        companyId: ORG,
        userId: OWNER,
        warehouseId: F.wh,
        supplierId,
        source: "purchase",
        date: TODAY,
        lines: [{ productId: F.prod.teh, qty: "10", unitCost: "3000" }],
      }),
    );

    const detail = await read((tx) => getPartyDetail(tx, ORG, "supplier", supplierId));
    expect(detail).not.toBeNull();
    expect(d(detail!.outstanding).toNumber()).toBe(1530000);

    // Saldo detail = jumlah baris subledger global untuk pihak ini.
    const subledger = await read((tx) => listPayables(tx, ORG));
    const subTotal = subledger
      .filter((row) => row.supplierId === supplierId)
      .reduce((sum, row) => sum + row.outstanding, 0);
    expect(subTotal).toBe(1530000);
    expect(d(detail!.outstanding).toNumber()).toBe(subTotal);

    expect(detail!.receipts).toHaveLength(1);
    expect(detail!.openings).toHaveLength(1);
    expect(d(detail!.openings[0].amount).toNumber()).toBe(1500000);
    // Riwayat perubahan memuat supplier.create dari aksi simpan.
    expect(detail!.auditTrail.map((row) => row.action)).toContain("supplier.create");
  });

  it("detail pelanggan: saldo piutang dari saldo awal terbaca & pihak tak dikenal null", async () => {
    const created = await saveCustomerAction({
      code: "MD-DET-C1",
      name: "Toko Detail Piutang",
      creditLimit: "5000000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG,
        userId: OWNER,
        kind: "receivable",
        partyId: created.data.id,
        date: TODAY,
        amount: "275000",
      }),
    );
    const detail = await read((tx) => getPartyDetail(tx, ORG, "customer", created.data.id));
    expect(detail).not.toBeNull();
    expect(d(detail!.outstanding).toNumber()).toBe(275000);
    const subledger = await read((tx) => listReceivables(tx, ORG));
    const subTotal = subledger
      .filter((row) => row.customerId === created.data.id)
      .reduce((sum, row) => sum + row.outstanding, 0);
    expect(d(detail!.outstanding).toNumber()).toBe(subTotal);

    const missing = await read((tx) =>
      getPartyDetail(tx, ORG, "customer", "01900000-0000-7000-8000-00000000dead"),
    );
    expect(missing).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Batch 5 — merge supplier/customer                                   */
/* ------------------------------------------------------------------ */

describe("S3 Batch 5 — merge pihak", () => {
  const M = { primary: "", duplicate: "", other: "" };

  beforeAll(async () => {
    const [primary] = await adminDb
      .insert(suppliers)
      .values({ companyId: ORG, code: "MD-MRG-U", name: "PT Merge Utama" })
      .returning();
    const [duplicate] = await adminDb
      .insert(suppliers)
      .values({ companyId: ORG, code: "MD-MRG-D", name: "PT Merge Utama (duplikat)" })
      .returning();
    const [other] = await adminDb
      .insert(suppliers)
      .values({ companyId: ORG, code: "MD-MRG-E", name: "PT Merge Lain" })
      .returning();
    M.primary = primary.id;
    M.duplicate = duplicate.id;
    M.other = other.id;

    // Utama: saldo awal utang 500.000.
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "payable", partyId: M.primary,
        date: TODAY, amount: "500000",
      }),
    );
    // Duplikat: saldo awal 300.000 + penerimaan kredit 10 × 3.000 = 30.000
    // + satu produk yang pemasok utamanya duplikat.
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "payable", partyId: M.duplicate,
        date: TODAY, amount: "300000",
      }),
    );
    await run((tx) =>
      createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: F.wh, supplierId: M.duplicate,
        source: "purchase", date: TODAY,
        lines: [{ productId: F.prod.indomie, qty: "10", unitCost: "3000" }],
      }),
    );
    await adminDb
      .update(products)
      .set({ supplierId: M.duplicate })
      .where(eq(products.id, F.prod.kopi));
  });

  it("pratinjau merge menampilkan saldo gabungan & hitungan referensi tanpa mengubah data", async () => {
    const preview = await read((tx) =>
      previewPartyMerge(tx, ORG, "supplier", M.primary, M.duplicate),
    );
    expect(d(preview.primary.outstanding).toNumber()).toBe(500000);
    expect(d(preview.duplicate.outstanding).toNumber()).toBe(330000);
    expect(d(preview.combinedOutstanding).toNumber()).toBe(830000);
    const refs = Object.fromEntries(preview.references.map((ref) => [ref.key, ref.count]));
    expect(refs.partyOpeningBalances).toBe(1);
    expect(refs.stockReceipts).toBe(1);
    expect(refs.products).toBe(1);
    expect(preview.duplicateAlreadyMerged).toBe(false);
    // Pratinjau murni baca.
    const [dup] = await read((tx) => tx.select().from(suppliers).where(eq(suppliers.id, M.duplicate)));
    expect(dup.isActive).toBe(true);
  });

  it("merge memetakan ulang referensi, saldo gabungan utuh, duplikat nonaktif bercatatan", async () => {
    const result = await run((tx) =>
      mergeParties(tx, {
        companyId: ORG, userId: OWNER, kind: "supplier",
        primaryId: M.primary, duplicateId: M.duplicate, today: TODAY,
      }),
    );
    expect(d(result.combinedOutstanding).toNumber()).toBe(830000);
    expect(result.references.stockReceipts).toBe(1);
    expect(result.references.partyOpeningBalances).toBe(1);
    expect(result.references.products).toBe(1);

    // Saldo subledger: semua kini di utama, duplikat nol.
    const payables = await read((tx) => listPayables(tx, ORG));
    const forPrimary = payables.filter((row) => row.supplierId === M.primary);
    const forDuplicate = payables.filter((row) => row.supplierId === M.duplicate);
    expect(forPrimary.reduce((sum, row) => sum + row.outstanding, 0)).toBe(830000);
    expect(forDuplicate).toHaveLength(0);

    const [dup] = await read((tx) => tx.select().from(suppliers).where(eq(suppliers.id, M.duplicate)));
    expect(dup.isActive).toBe(false);
    expect(dup.notes).toContain("Digabung ke PT Merge Utama (MD-MRG-U)");

    const [kopi] = await read((tx) => tx.select().from(products).where(eq(products.id, F.prod.kopi)));
    expect(kopi.supplierId).toBe(M.primary);
    await adminDb.update(products).set({ supplierId: F.sup1 }).where(eq(products.id, F.prod.kopi));

    // Audit lengkap di kedua record.
    const audits = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.companyId, ORG),
            inArray(auditLog.entityId, [M.primary, M.duplicate]),
          ),
        ),
    );
    const actions = audits.map((row) => row.action);
    expect(actions).toContain("party.merge");
    expect(actions).toContain("party.merged_into");
  });

  it("pembayaran FIFO sesudah merge melunasi utang gabungan secara normal", async () => {
    const result = await run((tx) =>
      payPayableFifo(tx, {
        companyId: ORG, userId: OWNER, supplierId: M.primary,
        date: TODAY, amount: "830000", accountId: F.cashAccount,
      }),
    );
    expect(result.allocations.length).toBeGreaterThanOrEqual(2);
    const payables = await read((tx) => listPayables(tx, ORG));
    expect(payables.filter((row) => row.supplierId === M.primary)).toHaveLength(0);
  });

  it("merge ke diri sendiri, merge ulang duplikat yang sama, dan merge lintas perusahaan ditolak", async () => {
    await expect(
      run((tx) =>
        mergeParties(tx, {
          companyId: ORG, userId: OWNER, kind: "supplier",
          primaryId: M.primary, duplicateId: M.primary, today: TODAY,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    // Duplikat yang sudah digabung tidak bisa digabung lagi ke pihak lain.
    await expect(
      run((tx) =>
        mergeParties(tx, {
          companyId: ORG, userId: OWNER, kind: "supplier",
          primaryId: M.other, duplicateId: M.duplicate, today: TODAY,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Id pihak dari perusahaan lain tidak ditemukan dalam cakupan ini.
    await expect(
      run((tx) =>
        mergeParties(tx, {
          companyId: ORG, userId: OWNER, kind: "supplier",
          primaryId: M.primary, duplicateId: "01900000-0000-7000-8000-00000000cc99", today: TODAY,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("merge pelanggan menggabungkan piutang saldo awal ke record utama", async () => {
    const [utama] = await adminDb
      .insert(customers)
      .values({ companyId: ORG, code: "MD-MRG-CU", name: "Toko Merge Utama" })
      .returning();
    const [duplikat] = await adminDb
      .insert(customers)
      .values({ companyId: ORG, code: "MD-MRG-CD", name: "Toko Merge Utama 2" })
      .returning();
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "receivable", partyId: utama.id,
        date: TODAY, amount: "120000",
      }),
    );
    await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "receivable", partyId: duplikat.id,
        date: TODAY, amount: "80000",
      }),
    );
    const result = await run((tx) =>
      mergeParties(tx, {
        companyId: ORG, userId: OWNER, kind: "customer",
        primaryId: utama.id, duplicateId: duplikat.id, today: TODAY,
      }),
    );
    expect(d(result.combinedOutstanding).toNumber()).toBe(200000);
    const receivables = await read((tx) => listReceivables(tx, ORG));
    const total = receivables
      .filter((row) => row.customerId === utama.id)
      .reduce((sum, row) => sum + row.outstanding, 0);
    expect(total).toBe(200000);
    const [dup] = await read((tx) => tx.select().from(customers).where(eq(customers.id, duplikat.id)));
    expect(dup.isActive).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Batch 6 — field pihak §18D (NPWP, rekening, termin)                 */
/* ------------------------------------------------------------------ */

describe("S3 Batch 6 — field pihak §18D", () => {
  it("NPWP, rekening & termin pemasok tersimpan, teraudit, dan tidak terhapus edit parsial", async () => {
    const created = await saveSupplierAction({
      code: "MD-FLD-1",
      name: "PT Field Lengkap",
      taxId: "01.234.567.8-901.000",
      bankName: "BCA",
      bankAccountNumber: "1234567890",
      bankAccountName: "PT Field Lengkap",
      paymentTermDays: 30,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const [row] = await read((tx) => tx.select().from(suppliers).where(eq(suppliers.id, created.data.id)));
    expect(row.taxId).toBe("01.234.567.8-901.000");
    expect(row.bankName).toBe("BCA");
    expect(row.bankAccountNumber).toBe("1234567890");
    expect(row.bankAccountName).toBe("PT Field Lengkap");
    expect(row.paymentTermDays).toBe(30);

    const audits = await read((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.companyId, ORG), eq(auditLog.entityId, created.data.id))),
    );
    const create = audits.find((entry) => entry.action === "supplier.create")!;
    expect((create.after as { taxId?: string }).taxId).toBe("01.234.567.8-901.000");
    expect((create.after as { paymentTermDays?: number }).paymentTermDays).toBe(30);

    // Edit yang tidak mengirim field §18D tidak boleh mengosongkannya.
    const updated = await saveSupplierAction({
      id: created.data.id,
      code: "MD-FLD-1",
      name: "PT Field Lengkap Revisi",
    });
    expect(updated.ok).toBe(true);
    const [after] = await read((tx) => tx.select().from(suppliers).where(eq(suppliers.id, created.data.id)));
    expect(after.name).toBe("PT Field Lengkap Revisi");
    expect(after.taxId).toBe("01.234.567.8-901.000");
    expect(after.paymentTermDays).toBe(30);
  });

  it("NPWP & termin pelanggan tersimpan; NPWP sama terdeteksi sebagai duplikat", async () => {
    const first = await saveCustomerAction({
      code: "MD-FLD-C1",
      name: "Toko Field Satu",
      taxId: "09.876.543.2-109.000",
      paymentTermDays: 14,
    });
    const second = await saveCustomerAction({
      code: "MD-FLD-C2",
      name: "Warung Berbeda Total",
      taxId: "098765432109000",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    const [row] = await read((tx) => tx.select().from(customers).where(eq(customers.id, first.data.id)));
    expect(row.taxId).toBe("09.876.543.2-109.000");
    expect(row.paymentTermDays).toBe(14);

    const pairs = await read((tx) => findPartyDuplicates(tx, ORG, "customer"));
    const mine = pairs.filter(
      (pair) =>
        [pair.a.id, pair.b.id].includes(first.data.id) &&
        [pair.a.id, pair.b.id].includes(second.data.id),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0].reasons.join(" ")).toMatch(/NPWP sama/);
  });

  it("termin pihak menjadi bawaan jatuh tempo saldo awal; jatuh tempo eksplisit selalu menang", async () => {
    const supplier = await saveSupplierAction({
      code: "MD-FLD-2",
      name: "PT Termin Empat Belas",
      paymentTermDays: 14,
    });
    expect(supplier.ok).toBe(true);
    if (!supplier.ok) return;

    const doc = await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "payable", partyId: supplier.data.id,
        date: "2026-01-10", amount: "100000",
      }),
    );
    expect(doc.dueDate).toBe("2026-01-24");

    const explicit = await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "payable", partyId: supplier.data.id,
        date: "2026-01-10", dueDate: "2026-02-01", amount: "50000",
      }),
    );
    expect(explicit.dueDate).toBe("2026-02-01");

    // Pemasok tanpa termin: jatuh tempo tetap kosong seperti sebelumnya.
    const plain = await saveSupplierAction({ code: "MD-FLD-3", name: "PT Tanpa Termin" });
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    const noTerm = await run((tx) =>
      createOpeningBalance(tx, {
        companyId: ORG, userId: OWNER, kind: "payable", partyId: plain.data.id,
        date: "2026-01-10", amount: "25000",
      }),
    );
    expect(noTerm.dueDate).toBeNull();
  });

  it("header ekspor pihak terpetakan balik oleh pemetaan impor termasuk NPWP & termin", () => {
    const supplierHeaders = [
      "Kode", "Nama", "Telepon", "Email", "Alamat", "Catatan",
      "NPWP", "Bank", "No. Rekening", "Atas Nama", "Termin (hari)", "Status",
    ];
    const mapping = suggestMappingFor(ENTITY_FIELDS.suppliers, supplierHeaders);
    expect(mapping.code).toBe("Kode");
    expect(mapping.name).toBe("Nama");
    // "NPWP" mengandung "hp" — tidak boleh dirampas field telepon.
    expect(mapping.phone).toBe("Telepon");
    expect(mapping.taxId).toBe("NPWP");
    expect(mapping.bankName).toBe("Bank");
    expect(mapping.bankAccountNumber).toBe("No. Rekening");
    expect(mapping.bankAccountName).toBe("Atas Nama");
    expect(mapping.paymentTermDays).toBe("Termin (hari)");

    const customerHeaders = [
      "Kode", "Nama", "Telepon", "Email", "Alamat", "Kelompok Harga",
      "Batas Kredit", "Catatan", "NPWP", "Termin (hari)", "Status",
    ];
    const customerMapping = suggestMappingFor(ENTITY_FIELDS.customers, customerHeaders);
    expect(customerMapping.taxId).toBe("NPWP");
    expect(customerMapping.paymentTermDays).toBe("Termin (hari)");
    expect(customerMapping.creditLimit).toBe("Batas Kredit");
  });
});
