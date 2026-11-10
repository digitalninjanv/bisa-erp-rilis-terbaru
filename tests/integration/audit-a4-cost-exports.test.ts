import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminSql } from "@/db/admin";
import { withCompany } from "@/db/tenant";
import {
  companySettings,
  member,
  organization,
  products,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { formatIDR } from "@/lib/money";
import { GET as productsExportGET } from "@/app/api/export/products/route";
import { GET as inventoryExportGET } from "@/app/api/export/inventory/route";
import InventoryValuePage from "@/app/app/gudang/nilai/page";
import { wipeCompanyFixture } from "../helpers/wipe-company";

// =====================================================================
// Program Audit Produksi — Tahap A4, AUD-013: biaya (harga beli / HPP /
// nilai persediaan) adalah data level-field `inventory.cost`. Ekspor
// produk, ekspor persediaan, dan halaman Nilai Persediaan hanya boleh
// menyertakannya untuk pemegang izin itu; peran tanpa izin (viewer)
// tetap menerima berkas/halaman yang berguna — tanpa kolom biaya.
//
// Pola A3: yang dipalsukan hanya lapisan autentikasi Better Auth dan
// cookie Next; resolusi sesi ASLI berjalan terhadap baris member
// sungguhan di perusahaan fixture buangan (…a401), peran diganti dengan
// memperbarui baris member.
// =====================================================================

const ORG = "01900000-0000-7000-8000-00000000a401";
const USER_ID = "01900000-0000-7000-8000-00000000a411";
const COST = "12345";
const COST_FORMATTED = "12345.00";
const VALUE_FORMATTED = "37035.00"; // 3 x 12345

const cookieJar = vi.hoisted(() => ({ values: new Map<string, string>() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: USER_ID, name: "Pengguna Uji A4", email: "a4@uji.local" },
        session: { id: "sesi-uji-a4" },
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
  usePathname: () => "/app/gudang/nilai",
  useSearchParams: () => new URLSearchParams(),
}));

async function setRole(role: string) {
  await db.update(member).set({ role }).where(eq(member.organizationId, ORG));
}

async function bootstrap() {
  await db
    .insert(organization)
    .values({ id: ORG, name: "Perusahaan Uji A4", slug: "uji-a4-aud013" })
    .onConflictDoNothing();
  await db
    .insert(user)
    .values({ id: USER_ID, name: "Pengguna Uji A4", email: "a4@uji.local" })
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
    if (existing) return;

    await tx.insert(companySettings).values({
      companyId: ORG,
      legalName: "Uji Audit A4",
      roundingMode: "none",
      taxRate: "11",
      taxEnabled: false,
      enabledModules: { pos: true, gudang: true, akuntansi: true, hr: true },
    });

    const [wh] = await tx
      .insert(warehouses)
      .values({ companyId: ORG, code: "GD-A4", name: "Gudang Utama A4", type: "warehouse", isDefault: true })
      .returning();

    const [product] = await tx
      .insert(products)
      .values({
        companyId: ORG,
        sku: "A4-001",
        name: "Produk Uji A4",
        costPrice: COST,
        salePrice: "20000",
        minStock: "0",
        trackStock: true,
        trackBatch: false,
        isActive: true,
      })
      .returning();

    await tx.insert(stockOnHand).values({
      companyId: ORG,
      warehouseId: wh.id,
      productId: product.id,
      qty: "3",
    });
  });
}

beforeAll(bootstrap, 120_000);
afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [USER_ID]);
});

describe("AUD-013 — gerbang inventory.cost pada ekspor & halaman nilai", () => {
  it("viewer: ekspor produk 200 TANPA kolom/nilai Harga Beli, Harga Jual tetap ada", async () => {
    await setRole("viewer");
    const response = await productsExportGET(new Request("http://localhost/api/export/products"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Harga Jual");
    expect(text).toContain("20000.00");
    expect(text).not.toContain("Harga Beli");
    expect(text).not.toContain(COST_FORMATTED);
  });

  it("owner: ekspor produk memuat Harga Beli dan nilainya", async () => {
    await setRole("owner");
    const response = await productsExportGET(new Request("http://localhost/api/export/products"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Harga Beli");
    expect(text).toContain(COST_FORMATTED);
  });

  it("viewer: ekspor persediaan 200 TANPA HPP/Nilai Persediaan, Potensi Jual tetap ada", async () => {
    await setRole("viewer");
    const response = await inventoryExportGET(new Request("http://localhost/api/export/inventory"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("Potensi Jual");
    expect(text).not.toContain("HPP");
    expect(text).not.toContain("Nilai Persediaan");
    expect(text).not.toContain(COST_FORMATTED);
    expect(text).not.toContain(VALUE_FORMATTED);
  });

  it("owner: ekspor persediaan memuat HPP dan Nilai Persediaan", async () => {
    await setRole("owner");
    const response = await inventoryExportGET(new Request("http://localhost/api/export/inventory"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain("HPP");
    expect(text).toContain("Nilai Persediaan");
    expect(text).toContain(COST_FORMATTED);
    expect(text).toContain(VALUE_FORMATTED);
  });

  it("viewer: halaman Nilai Persediaan tidak merender nilai biaya apa pun", async () => {
    await setRole("viewer");
    const element = await InventoryValuePage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element as never);
    expect(html).toContain("Produk Uji A4");
    expect(html).not.toContain(formatIDR(COST));
    expect(html).not.toContain(formatIDR(37035));
  });

  it("owner: halaman Nilai Persediaan merender HPP dan nilai baris", async () => {
    await setRole("owner");
    const element = await InventoryValuePage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(element as never);
    expect(html).toContain(formatIDR(COST));
    expect(html).toContain(formatIDR(37035));
  });
});
