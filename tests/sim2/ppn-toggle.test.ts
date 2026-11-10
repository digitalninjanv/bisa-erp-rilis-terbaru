import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  companySettings,
  member,
  organization,
  products,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { quoteCart } from "@/server/pos";
import { d } from "@/lib/money";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S2 — Audit PPN: saklar `company_settings.tax_enabled`.
 *
 * Bukti perilaku pada domain quote POS (jalur yang sama untuk quote &
 * checkout): tarif 11% tersimpan tetapi saklar mati → pajak 0; saklar
 * menyala → pajak inklusif 11% atas harga jual. Migrasi 0027 mengisi
 * saklar dari keadaan lama (tax_rate > 0) sehingga tidak ada
 * perusahaan yang perilakunya berubah oleh migrasi.
 */

const ORG = "01900000-0000-7000-8000-00000000ff01";
const OWNER = "01900000-0000-7000-8000-00000000ff10";


let warehouseId = "";
let productId = "";

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

async function setTax(enabled: boolean, rate: string) {
  await withCompany(ORG, async (tx) => {
    await tx
      .update(companySettings)
      .set({ taxEnabled: enabled, taxRate: rate })
      .where(eq(companySettings.companyId, ORG));
  });
}

async function quoteTaxTotal() {
  return withCompany(ORG, async (tx) => {
    const quote = await quoteCart(tx, {
      companyId: ORG,
      warehouseId,
      lines: [{ productId, qty: 1 }],
    });
    return quote;
  });
}

beforeAll(async () => {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Fani PPN", email: "owner@ppn.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PPNID", slug: "ppnid", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  const [warehouse] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-PPN", name: "Gudang PPN", type: "warehouse", isDefault: true })
    .returning();
  warehouseId = warehouse.id;
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PPNID", roundingMode: "none", taxRate: "11", taxEnabled: false,
    allowNegativeStock: false, defaultWarehouseId: warehouseId,
  });
  const [product] = await adminDb
    .insert(products)
    .values({
      companyId: ORG,
      sku: "PPN-001",
      name: "Produk Uji PPN",
      salePrice: "111000",
      costPrice: "90000",
      trackStock: false,
      isActive: true,
    })
    .returning();
  productId = product.id;
});
afterAll(wipeFixture);

describe("saklar PPN per perusahaan", () => {
  it("tarif 11% tersimpan tetapi saklar mati → pajak quote 0 dan tarif baris 0", async () => {
    const quote = await quoteTaxTotal();
    expect(d(quote.taxTotal).toNumber()).toBe(0);
    expect(quote.lines[0].taxRate).toBe(0);
    expect(d(quote.lines[0].taxAmount).toNumber()).toBe(0);
  });

  it("saklar menyala → PPN inklusif 11% atas Rp111.000 = Rp11.000", async () => {
    await setTax(true, "11");
    const quote = await quoteTaxTotal();
    expect(quote.lines[0].taxRate).toBe(11);
    expect(d(quote.taxTotal).toFixed(2)).toBe(d(11_000).toFixed(2));
  });

  it("mematikan lagi mengembalikan pajak ke 0 tanpa mengubah tarif tersimpan", async () => {
    await setTax(false, "11");
    const quote = await quoteTaxTotal();
    expect(d(quote.taxTotal).toNumber()).toBe(0);
    const [settings] = await withCompany(ORG, async (tx) =>
      tx.select().from(companySettings).where(eq(companySettings.companyId, ORG)).limit(1),
    );
    expect(d(settings.taxRate).toNumber()).toBe(11);
    expect(settings.taxEnabled).toBe(false);
  });
});
