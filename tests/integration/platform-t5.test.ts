import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { products, suppliers } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { getSettings, listUnits } from "@/server/catalog";
import { saveCustomFieldsAction } from "@/server/actions/settings/kolom-kustom";
import { saveEnabledModulesAction } from "@/server/actions/settings/modul";
import {
  createTaxonomyAction,
  deleteTaxonomyAction,
  toggleUnitAction,
} from "@/server/actions/inventory/taksonomi";
import { saveProductAction } from "@/server/actions/inventory/produk";
import { saveSupplierAction } from "@/server/actions/inventory/pihak";
import { isModuleEnabled, sanitizeEnabledModules } from "@/lib/modules";
import {
  customFieldDefinitionsFor,
  type CustomFieldDefinitions,
} from "@/lib/custom-fields";

// T5-2 (D-16): lapisan platform — saklar modul per perusahaan, kolom
// kustom produk/pihak, dan satuan yang bisa dinonaktifkan. Sesi diganti
// versi statis (pola print-settings.test.ts); action asli berjalan
// terhadap database dev asli. Pengaturan perusahaan demo yang diubah
// selalu dipulihkan di afterAll karena berkas test lain memakainya.
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const requirePermission = async () => ({
    company: { id: "01900000-0000-7000-8000-000000000001" },
    user: { id: "01900000-0000-7000-8000-000000000010" },
    role: "owner",
  });
  // T5R-2: fixture sesi ini mewakili perusahaan dengan semua modul
  // aktif, jadi gerbang modul di lapisan action lolos persis seperti
  // requirePermission (gerbang sungguhannya diuji di review-fixes-t5r).
  return {
    requirePermission,
    requirePermissionInModule: requirePermission,
    requireAuth: requirePermission,
  };
});

const ORG_ID = "01900000-0000-7000-8000-000000000001";
const suffix = crypto.randomUUID().slice(0, 8);
const createdProductIds: string[] = [];
const createdSupplierIds: string[] = [];
let createdUnitId: string | null = null;

const PRODUCT_DEFS: CustomFieldDefinitions = {
  product: [
    { key: "merek", label: "Merek", type: "text", required: true },
    { key: "berat", label: "Berat", type: "number" },
    { key: "asal", label: "Asal", type: "select", options: ["Lokal", "Impor"] },
  ],
  supplier: [{ key: "npwp", label: "NPWP", type: "text" }],
};

async function readSettings() {
  return withCompanyReadOnly(ORG_ID, async (tx) => getSettings(tx, ORG_ID));
}

afterAll(async () => {
  // Pulihkan pengaturan perusahaan demo persis seperti semula: semua
  // modul aktif (null) dan tanpa definisi kolom kustom.
  await saveEnabledModulesAction({ pos: true, gudang: true, akuntansi: true, hr: true, analisa: true });
  await saveCustomFieldsAction({ definitions: {} });
  await withCompany(ORG_ID, async (tx) => {
    for (const id of createdProductIds) {
      await tx.delete(products).where(eq(products.id, id));
    }
    for (const id of createdSupplierIds) {
      await tx.delete(suppliers).where(eq(suppliers.id, id));
    }
  });
  if (createdUnitId) {
    await deleteTaxonomyAction({ kind: "unit", id: createdUnitId });
  }
});

describe("T5-2 saklar modul per perusahaan", () => {
  it("mematikan akuntansi tersimpan dan terbaca kembali lewat sanitasi", async () => {
    // A-24 T2: kontrak simpan saklar bertambah kunci "hr" (ModuleKey
    // baru) — payload & peta tersimpan kini memuatnya.
    const result = await saveEnabledModulesAction({
      pos: true,
      gudang: true,
      akuntansi: false,
      hr: true,
      analisa: true,
    });
    expect(result.ok).toBe(true);

    const settings = await readSettings();
    expect(settings?.enabledModules).toEqual({ pos: true, gudang: true, akuntansi: false, hr: true, analisa: true });
    expect(sanitizeEnabledModules(settings?.enabledModules)).toEqual(["pos", "gudang", "hr", "analisa"]);
    expect(isModuleEnabled(settings, "akuntansi")).toBe(false);
    expect(isModuleEnabled(settings, "pos")).toBe(true);
  });

  it("mengaktifkan semua modul mengembalikan kolom ke null (bawaan)", async () => {
    const result = await saveEnabledModulesAction({
      pos: true,
      gudang: true,
      akuntansi: true,
      hr: true,
      analisa: true,
    });
    expect(result.ok).toBe(true);
    const settings = await readSettings();
    expect(settings?.enabledModules).toBeNull();
    expect(sanitizeEnabledModules(settings?.enabledModules)).toEqual([
      "pos",
      "gudang",
      "akuntansi",
      "hr",
      "analisa",
    ]);
  });
});

describe("T5-2 definisi kolom kustom", () => {
  it("definisi tersimpan tersanitasi dan terbaca per entitas", async () => {
    const result = await saveCustomFieldsAction({ definitions: PRODUCT_DEFS });
    expect(result.ok).toBe(true);

    const settings = await readSettings();
    expect(settings?.customFields).toEqual(PRODUCT_DEFS);
    expect(customFieldDefinitionsFor(settings?.customFields, "product")).toHaveLength(3);
    expect(customFieldDefinitionsFor(settings?.customFields, "customer")).toEqual([]);
  });

  it("definisi tidak sah ditolak: kunci ganda dan select tanpa pilihan", async () => {
    const duplicate = await saveCustomFieldsAction({
      definitions: {
        product: [
          { key: "merek", label: "Merek", type: "text" },
          { key: "MEREK", label: "Merek dua", type: "text" },
        ],
      },
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.code).toBe("VALIDATION");
      expect(duplicate.message).toContain("merek");
    }

    const noOptions = await saveCustomFieldsAction({
      definitions: {
        product: [{ key: "asal", label: "Asal", type: "select", options: [] }],
      },
    });
    expect(noOptions.ok).toBe(false);
    if (!noOptions.ok) expect(noOptions.message).toContain("pilihan");

    // Penolakan tidak mengubah definisi yang tersimpan sebelumnya.
    const settings = await readSettings();
    expect(settings?.customFields).toEqual(PRODUCT_DEFS);
  });
});

describe("T5-2 nilai kolom kustom pada produk & pemasok", () => {
  it("produk menyimpan nilai ternormalisasi (angka menjadi string Decimal kanonis)", async () => {
    const created = await saveProductAction({
      name: `Produk Kolom Kustom ${suffix}`,
      sku: `TST-T52-${suffix}-P1`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { merek: "Indomilk", berat: "250.5", asal: "Lokal" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdProductIds.push(created.data.id);

    const [row] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select({ attributes: products.attributes }).from(products).where(eq(products.id, created.data.id)),
    );
    expect(row?.attributes).toEqual({
      merek: "Indomilk",
      berat: "250.5000",
      asal: "Lokal",
    });
  });

  it("nilai tidak sah ditolak menyebut label kolomnya", async () => {
    const badSelect = await saveProductAction({
      name: `Produk Asal Aneh ${suffix}`,
      sku: `TST-T52-${suffix}-P2`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { merek: "X", asal: "Antah" },
    });
    expect(badSelect.ok).toBe(false);
    if (!badSelect.ok) {
      expect(badSelect.code).toBe("VALIDATION");
      expect(badSelect.message).toContain("Asal");
    }

    const badNumber = await saveProductAction({
      name: `Produk Berat Aneh ${suffix}`,
      sku: `TST-T52-${suffix}-P3`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { merek: "X", berat: "abc" },
    });
    expect(badNumber.ok).toBe(false);
    if (!badNumber.ok) expect(badNumber.message).toContain("Berat");

    const missingRequired = await saveProductAction({
      name: `Produk Tanpa Merek ${suffix}`,
      sku: `TST-T52-${suffix}-P4`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { asal: "Lokal" },
    });
    expect(missingRequired.ok).toBe(false);
    if (!missingRequired.ok) expect(missingRequired.message).toContain("Merek");
  });

  it("menghapus definisi tidak menghapus nilai lama: nilai yatim bertahan saat produk disimpan ulang", async () => {
    const created = await saveProductAction({
      name: `Produk Yatim ${suffix}`,
      sku: `TST-T52-${suffix}-P5`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { merek: "Sariwangi", asal: "Impor" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const productId = created.data.id;
    createdProductIds.push(productId);

    // Definisi "merek" dihapus dari pengaturan; "asal" tetap ada.
    const shrink = await saveCustomFieldsAction({
      definitions: {
        product: [{ key: "asal", label: "Asal", type: "select", options: ["Lokal", "Impor"] }],
        supplier: PRODUCT_DEFS.supplier,
      },
    });
    expect(shrink.ok).toBe(true);

    // Simpan ulang produk hanya dengan kolom yang masih terdefinisi.
    const updated = await saveProductAction({
      id: productId,
      name: `Produk Yatim ${suffix}`,
      sku: `TST-T52-${suffix}-P5`,
      costPrice: "1000",
      salePrice: "1500",
      attributes: { asal: "Lokal" },
    });
    expect(updated.ok).toBe(true);

    const [row] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx.select({ attributes: products.attributes }).from(products).where(eq(products.id, productId)),
    );
    // asal diperbarui; merek — kini yatim — tidak terhapus.
    expect(row?.attributes).toEqual({ merek: "Sariwangi", asal: "Lokal" });

    // Kembalikan definisi lengkap untuk test berikutnya.
    await saveCustomFieldsAction({ definitions: PRODUCT_DEFS });
  });

  it("pemasok menyimpan nilai kolom kustomnya", async () => {
    const created = await saveSupplierAction({
      code: `TST-T52-${suffix}`,
      name: `Pemasok Kolom Kustom ${suffix}`,
      attributes: { npwp: "01.234.567.8-901.000" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdSupplierIds.push(created.data.id);

    const [row] = await withCompanyReadOnly(ORG_ID, async (tx) =>
      tx
        .select({ attributes: suppliers.attributes })
        .from(suppliers)
        .where(eq(suppliers.id, created.data.id)),
    );
    expect(row?.attributes).toEqual({ npwp: "01.234.567.8-901.000" });
  });
});

describe("T5-2 satuan bisa dinonaktifkan", () => {
  it("satuan nonaktif hilang dari daftar pilihan, aktif lagi untuk dipulihkan", async () => {
    const created = await createTaxonomyAction({
      kind: "unit",
      name: `Liter Uji ${suffix}`,
      code: `LU${suffix.slice(0, 4)}`.toUpperCase(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdUnitId = created.data.id;

    const listedBefore = await withCompanyReadOnly(ORG_ID, async (tx) =>
      listUnits(tx, ORG_ID),
    );
    expect(listedBefore.some((row) => row.id === createdUnitId)).toBe(true);

    const off = await toggleUnitAction({ id: createdUnitId, isActive: false });
    expect(off.ok).toBe(true);
    const listedOff = await withCompanyReadOnly(ORG_ID, async (tx) =>
      listUnits(tx, ORG_ID),
    );
    expect(listedOff.some((row) => row.id === createdUnitId)).toBe(false);

    const on = await toggleUnitAction({ id: createdUnitId, isActive: true });
    expect(on.ok).toBe(true);
    const listedOn = await withCompanyReadOnly(ORG_ID, async (tx) =>
      listUnits(tx, ORG_ID),
    );
    expect(listedOn.some((row) => row.id === createdUnitId)).toBe(true);
  });
});
