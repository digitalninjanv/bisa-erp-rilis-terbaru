import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  companySettings,
  member,
  organization,
  paymentMethods,
  products,
  stockSerials,
  suppliers,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { createReceipt, createTransfer } from "@/server/inventory";
import { createSale, openCashSession, quoteCart, voidSale } from "@/server/pos";
import { getProductSerialCard } from "@/server/serials";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-2 Batch 5 — Nomor seri.
 *
 * Terima 3 unit seri A/B/C → jual seri A → jual seri A lagi DITOLAK →
 * seri tersisa B/C. Seri hanya masuk lewat penerimaan; produk
 * non-serial tidak berubah perilaku.
 */

const state = vi.hoisted(() => ({ org: "", user: "" }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: state.org },
    user: { id: state.user },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e805";
const OWNER = "01900000-0000-7000-8000-00000000e857";


async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

const acc: Record<string, string> = {};
let whA = "";
let whB = "";
let serialProductId = "";
let plainProductId = "";
let supplierId = "";
let methodId = "";

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji", email: "owner-e805@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji Seri", slug: "uji-seri", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji Seri", roundingMode: "none", taxRate: "0", taxEnabled: false, allowNegativeStock: false,
  });
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1300", name: "Persediaan Barang", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
      { companyId: ORG, code: "9000", name: "Pembulatan Penjualan (Laba)", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "9001", name: "Selisih Pembulatan (Rugi)", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "inventory", accountId: acc["1300"] },
    { companyId: ORG, key: "payable", accountId: acc["2000"] },
    { companyId: ORG, key: "equity", accountId: acc["3000"] },
    { companyId: ORG, key: "revenue", accountId: acc["4000"] },
    { companyId: ORG, key: "sales_discount", accountId: acc["4010"] },
    { companyId: ORG, key: "sales_return", accountId: acc["4020"] },
    { companyId: ORG, key: "cogs", accountId: acc["5000"] },
    { companyId: ORG, key: "rounding_gain", accountId: acc["9000"] },
    { companyId: ORG, key: "rounding_loss", accountId: acc["9001"] },
  ]);
  const [cash] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 })
    .returning();
  methodId = cash.id;
  const [a] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-A", name: "Gudang A", type: "warehouse", isDefault: true })
    .returning();
  const [b] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-B", name: "Gudang B", type: "warehouse" })
    .returning();
  whA = a.id;
  whB = b.id;
  const [supplier] = await adminDb
    .insert(suppliers)
    .values({ companyId: ORG, code: "SUP-SER", name: "PT Pemasok Seri" })
    .returning();
  supplierId = supplier.id;
  const [serialProduct] = await adminDb
    .insert(products)
    .values({ companyId: ORG, sku: "SER-1", name: "HP Seri", salePrice: "150000", costPrice: "100000", trackStock: true, trackSerial: true })
    .returning();
  serialProductId = serialProduct.id;
  const [plainProduct] = await adminDb
    .insert(products)
    .values({ companyId: ORG, sku: "PLN-1", name: "Produk Polos", salePrice: "15000", costPrice: "10000", trackStock: true })
    .returning();
  plainProductId = plainProduct.id;
  state.org = ORG;
  state.user = OWNER;
  await withCompany(ORG, (tx) => openCashSession(tx, { companyId: ORG, userId: OWNER, openingCash: 0 }));
}

async function serialStatus(serialNumber: string) {
  const [row] = await adminDb
    .select()
    .from(stockSerials)
    .where(
      and(
        eq(stockSerials.companyId, ORG),
        eq(stockSerials.productId, serialProductId),
        eq(stockSerials.serialNumber, serialNumber),
      ),
    );
  return row;
}

async function sellSerial(serialNumbers?: string[], qty = 1) {
  return withCompany(ORG, async (tx) => {
    const quote = await quoteCart(tx, {
      companyId: ORG,
      warehouseId: whA,
      customerId: null,
      lines: [{ productId: serialProductId, qty, serialNumbers }],
    });
    return createSale(tx, {
      companyId: ORG,
      userId: OWNER,
      warehouseId: whA,
      date: "2026-04-05",
      lines: [{ productId: serialProductId, qty, serialNumbers }],
      payments: [{ methodId, amount: quote.total, tendered: quote.total }],
      idempotencyKey: crypto.randomUUID(),
    });
  });
}

beforeAll(bootstrap);
afterAll(wipeFixture);

describe("Nomor seri — penerimaan & penjualan", () => {
  let firstSaleId = "";

  it("penerimaan produk serial tanpa daftar seri ditolak; dengan seri A/B/C diterima", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        createReceipt(tx, {
          companyId: ORG, userId: OWNER, warehouseId: whA, supplierId,
          date: "2026-04-01",
          lines: [{ productId: serialProductId, qty: 3, unitCost: "100000" }],
        }),
      ),
    ).rejects.toThrow();
    await withCompany(ORG, (tx) =>
      createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: whA, supplierId,
        date: "2026-04-01",
        lines: [{ productId: serialProductId, qty: 3, unitCost: "100000", serialNumbers: ["SN-A", "SN-B", "SN-C"] }],
      }),
    );
    for (const serial of ["SN-A", "SN-B", "SN-C"]) {
      const row = await serialStatus(serial);
      expect(row.status).toBe("in_stock");
      expect(row.warehouseId).toBe(whA);
    }
  });

  it("nomor seri yang sama tidak bisa diterima dua kali", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        createReceipt(tx, {
          companyId: ORG, userId: OWNER, warehouseId: whA, supplierId,
          date: "2026-04-02",
          lines: [{ productId: serialProductId, qty: 1, unitCost: "100000", serialNumbers: ["SN-A"] }],
        }),
      ),
    ).rejects.toThrow();
  });

  it("jual seri A lolos; jual seri A lagi ditolak; tanpa seri / jumlah seri kurang ditolak", async () => {
    const sale = await sellSerial(["SN-A"]);
    firstSaleId = sale.id;
    expect((await serialStatus("SN-A")).status).toBe("out");
    await expect(sellSerial(["SN-A"])).rejects.toThrow();
    await expect(sellSerial(undefined)).rejects.toThrow();
    await expect(sellSerial(["SN-B"], 2)).rejects.toThrow();
    expect((await serialStatus("SN-B")).status).toBe("in_stock");
    expect((await serialStatus("SN-C")).status).toBe("in_stock");
  });

  it("kartu seri mencatat riwayat masuk/keluar per unit", async () => {
    const card = await withCompany(ORG, (tx) => getProductSerialCard(tx, ORG, serialProductId));
    const a = card.find((row) => row.serialNumber === "SN-A");
    expect(a).toBeTruthy();
    expect(a!.movements.map((movement) => movement.kind)).toEqual(["in", "out"]);
    expect(a!.movements[1].referenceNumber).toBeTruthy();
  });

  it("void penjualan memulihkan seri yang keluar", async () => {
    await withCompany(ORG, (tx) =>
      voidSale(tx, { companyId: ORG, userId: OWNER, saleId: firstSaleId, reason: "Uji void seri" }),
    );
    expect((await serialStatus("SN-A")).status).toBe("in_stock");
  });

  it("transfer memindahkan seri tertua ke gudang tujuan", async () => {
    await withCompany(ORG, (tx) =>
      createTransfer(tx, {
        companyId: ORG, userId: OWNER, fromWarehouseId: whA, toWarehouseId: whB,
        date: "2026-04-07", lines: [{ productId: serialProductId, qty: 1 }],
      }),
    );
    const moved = await adminDb
      .select()
      .from(stockSerials)
      .where(
        and(
          eq(stockSerials.companyId, ORG),
          eq(stockSerials.productId, serialProductId),
          eq(stockSerials.warehouseId, whB),
          eq(stockSerials.status, "in_stock"),
        ),
      );
    expect(moved).toHaveLength(1);
    expect(moved[0].serialNumber).toBe("SN-A");
  });

  it("produk non-serial tidak berubah perilaku (terima & jual tanpa seri)", async () => {
    await withCompany(ORG, (tx) =>
      createReceipt(tx, {
        companyId: ORG, userId: OWNER, warehouseId: whA, supplierId,
        date: "2026-04-08",
        lines: [{ productId: plainProductId, qty: 5, unitCost: "10000" }],
      }),
    );
    const sale = await withCompany(ORG, async (tx) => {
      const quote = await quoteCart(tx, {
        companyId: ORG, warehouseId: whA, customerId: null,
        lines: [{ productId: plainProductId, qty: 2 }],
      });
      return createSale(tx, {
        companyId: ORG, userId: OWNER, warehouseId: whA, date: "2026-04-08",
        lines: [{ productId: plainProductId, qty: 2 }],
        payments: [{ methodId, amount: quote.total, tendered: quote.total }],
        idempotencyKey: crypto.randomUUID(),
      });
    });
    expect(sale.total).toBe(30000);
  });
});
