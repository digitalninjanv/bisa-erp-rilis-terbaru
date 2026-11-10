import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { withCompany } from "@/db/tenant";
import {
  companySettings,
  member,
  organization,
  productPackagings,
  products,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { summarizeOpnameCount, type OpnameCountRow } from "@/lib/gudang/opname-count";
import {
  loadOpnameProductsAction,
  resolveBarcodeAction,
  searchInventoryProductsAction,
} from "@/server/actions/inventory/produk";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// Program Rekayasa — R3 K-3: jalur baca gudang (picker produk) adalah
// permukaan biaya kelas AUD-013. Tiga aksi di actions/inventory/
// produk.ts bergerbang hanya `inventory.view`, tetapi muatannya
// membawa `costPrice` produk dan `buyPrice` kemasan — data level-field
// `inventory.cost`. Tanpa izin itu nilainya harus null (aksi tetap
// berhasil, pola AUD-013/A4); dengan izin, nilai persis seperti
// sebelumnya. Pola mock A3/A4: hanya lapisan autentikasi Better Auth
// + cookie Next yang dipalsukan; resolusi member sungguhan di
// perusahaan fixture buangan (…e301), peran diganti via baris member.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000e301";
const USER_ID = "01900000-0000-7000-8000-00000000e311";
const COST = "12345";
const PACK_BUY = "444444";
const PRODUCT_BARCODE = "8990001112223";
const PACK_BARCODE = "8990001112224";

let warehouseId = "";

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: USER_ID, name: "Pengguna Uji K3", email: "k3@uji.local" },
        session: { id: "sesi-uji-k3", createdAt: new Date(), expiresAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieJar.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => {
      cookieJar.values.set(name, value);
    },
    delete: (name: string) => {
      cookieJar.values.delete(name);
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
  usePathname: () => "/app/gudang",
  useSearchParams: () => new URLSearchParams(),
}));

async function setRole(role: string) {
  await db.update(member).set({ role }).where(eq(member.organizationId, ORG));
}

async function bootstrap() {
  await db
    .insert(organization)
    .values({ id: ORG, name: "Perusahaan Uji K3", slug: "uji-r3-k3" })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({ id: USER_ID, name: "Pengguna Uji K3", email: "k3@uji.local" })
    .onConflictDoNothing();
  await db
    .insert(member)
    .values({ id: crypto.randomUUID(), organizationId: ORG, userId: USER_ID, role: "owner" })
    .onConflictDoNothing();
  cookieJar.values.set(COMPANY_COOKIE_NAME, ORG);

  await withCompany(ORG, async (tx) => {
    const [existing] = await tx
      .select({ companyId: companySettings.companyId })
      .from(companySettings)
      .where(eq(companySettings.companyId, ORG))
      .limit(1);
    if (existing) {
      const [wh] = await tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.companyId, ORG))
        .limit(1);
      warehouseId = wh.id;
      return;
    }

    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji Rekayasa K3",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: false,
      enabledModules: { pos: true, gudang: true, akuntansi: true, hr: true },
    });

    const [wh] = await tx
      .insert(warehouses)
      .values({ companyId: ORG, code: "GD-K3", name: "Gudang Utama K3", type: "warehouse", isDefault: true })
      .returning();
    warehouseId = wh.id;

    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG,
        sku: "K3-001",
        name: "Produk Uji K3",
        barcode: PRODUCT_BARCODE,
        costPrice: COST,
        salePrice: "20000",
        minStock: "0",
        trackStock: true,
        trackBatch: false,
        isActive: true,
      })
      .returning();

    await tx.insert(productPackagings).values({
      companyId: ORG,
      productId: product.id,
      name: "Dus",
      isi: "40",
      buyPrice: PACK_BUY,
      salePrice: "700000",
      barcode: PACK_BARCODE,
      isActive: true,
    });

    await tx.insert(stockOnHand).values({
      companyId: ORG,
      warehouseId: wh.id,
      productId: product.id,
      qty: "5",
    });
  });
}

beforeAll(bootstrap, 120_000);
afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [USER_ID]);
});

describe("K-3 — gerbang inventory.cost pada aksi picker gudang", () => {
  it("viewer: pencarian produk — costPrice & buyPrice kemasan null, harga jual tetap ada", async () => {
    await setRole("viewer");
    const result = await searchInventoryProductsAction("Produk Uji K3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    const row = result.data[0];
    expect(row.costPrice).toBeNull();
    expect(row.salePrice).not.toBeNull();
    expect(Number(row.salePrice)).toBe(20000);
    expect(row.packagings).toHaveLength(1);
    expect(row.packagings[0].buyPrice).toBeNull();
    expect(Number(row.packagings[0].salePrice)).toBe(700000);
    const payload = JSON.stringify(result.data);
    expect(payload).not.toContain(COST);
    expect(payload).not.toContain(PACK_BUY);
  });

  it("owner: pencarian produk — nilai biaya persis seperti sebelumnya", async () => {
    await setRole("owner");
    const result = await searchInventoryProductsAction("Produk Uji K3");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.data[0];
    expect(Number(row.costPrice)).toBe(12345);
    expect(Number(row.packagings[0].buyPrice)).toBe(444444);
  });

  it("viewer: resolusi barcode produk & kemasan — biaya null", async () => {
    await setRole("viewer");
    const byProduct = await resolveBarcodeAction({ barcode: PRODUCT_BARCODE });
    expect(byProduct.ok).toBe(true);
    if (!byProduct.ok || !byProduct.data) throw new Error("barcode produk tidak teresolusi");
    expect(byProduct.data.product.costPrice).toBeNull();
    expect(byProduct.data.product.packagings[0].buyPrice).toBeNull();

    const byPack = await resolveBarcodeAction({ barcode: PACK_BARCODE });
    expect(byPack.ok).toBe(true);
    if (!byPack.ok || !byPack.data) throw new Error("barcode kemasan tidak teresolusi");
    expect(byPack.data.packaging?.id).toBeTruthy();
    expect(byPack.data.product.costPrice).toBeNull();
    expect(JSON.stringify(byPack.data)).not.toContain(PACK_BUY);
  });

  it("owner: resolusi barcode — nilai biaya hadir", async () => {
    await setRole("owner");
    const resolved = await resolveBarcodeAction({ barcode: PRODUCT_BARCODE });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || !resolved.data) throw new Error("barcode produk tidak teresolusi");
    expect(Number(resolved.data.product.costPrice)).toBe(12345);
    expect(Number(resolved.data.product.packagings[0].buyPrice)).toBe(444444);
  });

  it("viewer: muat-semua opname — costPrice null di semua baris", async () => {
    await setRole("viewer");
    const result = await loadOpnameProductsAction({ warehouseId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.rows.length).toBeGreaterThan(0);
    for (const row of result.data.rows) {
      expect(row.costPrice).toBeNull();
    }
    expect(JSON.stringify(result.data)).not.toContain(COST);
  });

  it("owner: muat-semua opname — costPrice hadir", async () => {
    await setRole("owner");
    const result = await loadOpnameProductsAction({ warehouseId });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.data.rows.find((r) => r.sku === "K3-001");
    expect(row).toBeTruthy();
    expect(Number(row?.costPrice)).toBe(12345);
  });
});

describe("K-3 — ringkasan opname tanpa biaya terlihat", () => {
  const baseRow: OpnameCountRow = {
    productId: "p1",
    name: "Produk",
    sku: "SKU-1",
    system: 10,
    counted: "7",
    unitCost: "5000",
  };

  it("unitCost terisi: nilai selisih & total terhitung seperti sebelumnya", () => {
    const summary = summarizeOpnameCount([baseRow]);
    expect(summary.reviewRows[0].diffValue).toBe("-15000");
    expect(summary.totalAbsValue).toBe("15000");
    expect(summary.netValue).toBe("-15000");
  });

  it("unitCost null: diff tetap ada, nilai selisih & total menjadi null (disembunyikan)", () => {
    const summary = summarizeOpnameCount([{ ...baseRow, unitCost: null }]);
    expect(summary.reviewRows[0].diff).toBe(-3);
    expect(summary.reviewRows[0].diffValue).toBeNull();
    expect(summary.totalAbsValue).toBeNull();
    expect(summary.netValue).toBeNull();
    expect(summary.diffCount).toBe(1);
  });

  it("campuran (draf lama berbiaya + baris tanpa biaya): total tidak ditampilkan sebagian", () => {
    const summary = summarizeOpnameCount([
      baseRow,
      { ...baseRow, productId: "p2", unitCost: null },
    ]);
    expect(summary.reviewRows[0].diffValue).toBe("-15000");
    expect(summary.reviewRows[1].diffValue).toBeNull();
    expect(summary.totalAbsValue).toBeNull();
  });
});
