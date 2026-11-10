import { eq } from "drizzle-orm";
import type { adminDb } from "./admin";
import { productPackagings } from "./schema";

/**
 * Program Satuan Kemasan S1 — penanam kemasan demo, potongan bootstrap
 * seed yang sama dengan seed-chart.ts (diekstrak dari seed.ts demi
 * ratchet ukuran berkas; hanya dipanggil seed, bukan jalur produksi).
 *
 * Tiga produk demo mendapat kemasan nyata agar fitur terlihat hidup
 * sejak login pertama. Harga jual kemasan SENGAJA tidak sama dengan
 * isi × harga satuan dasar — harga grosir per kemasan memang keputusan
 * komersial yang berdiri sendiri (pola Accurate/Jurnal pada riset).
 * Idempoten: berhenti bila perusahaan sudah memiliki kemasan apa pun.
 * Stok & nilai persediaan TIDAK disentuh — kemasan murni master data.
 */
const DEMO_PACKAGINGS: Array<{
  productName: string;
  name: string;
  isi: string;
  buyPrice: string;
  salePrice: string;
  barcode: string;
  isDefaultPurchase: boolean;
  isDefaultSale: boolean;
}> = [
  {
    // Beli per dus dari distributor, jual ecer per pcs.
    productName: "Indomie Goreng",
    name: "Dus",
    isi: "40",
    buyPrice: "124000", // = 40 × HPP pcs 3.100
    salePrice: "145000", // independen — bukan 40 × 3.800 = 152.000
    barcode: "8992000000001",
    isDefaultPurchase: true,
    isDefaultSale: false,
  },
  {
    productName: "Beng Beng Chocolate",
    name: "Pak",
    isi: "10",
    buyPrice: "19000", // = 10 × HPP pcs 1.900
    salePrice: "27500", // independen — bukan 10 × 3.000 = 30.000
    barcode: "8992000000002",
    isDefaultPurchase: true,
    isDefaultSale: false,
  },
  {
    // Bertingkat, keduanya dinyatakan LANGSUNG ke satuan dasar
    // (bungkus): Slop = 10, Dus = 100 — bukan Dus = 10 Slop berantai.
    productName: "Sampoerna Mild 16",
    name: "Slop",
    isi: "10",
    buyPrice: "305000", // = 10 × HPP bungkus 30.500
    salePrice: "330000", // independen — bukan 10 × 34.000
    barcode: "8992000000003",
    isDefaultPurchase: false,
    isDefaultSale: false,
  },
  {
    productName: "Sampoerna Mild 16",
    name: "Dus",
    isi: "100",
    buyPrice: "3050000", // = 100 × HPP bungkus 30.500
    salePrice: "3250000", // independen — bukan 100 × 34.000
    barcode: "8992000000004",
    isDefaultPurchase: true,
    isDefaultSale: true,
  },
];

export async function seedDemoPackaging(
  db: typeof adminDb,
  orgId: string,
  demoProducts: { id: string; name: string }[],
) {
  const existing = await db
    .select({ id: productPackagings.id })
    .from(productPackagings)
    .where(eq(productPackagings.companyId, orgId))
    .limit(1);
  if (existing.length > 0) return;

  const values = DEMO_PACKAGINGS.flatMap((row, index) => {
    const product = demoProducts.find((candidate) => candidate.name === row.productName);
    if (!product) return [];
    return [
      {
        companyId: orgId,
        productId: product.id,
        name: row.name,
        isi: row.isi,
        buyPrice: row.buyPrice,
        salePrice: row.salePrice,
        barcode: row.barcode,
        isDefaultPurchase: row.isDefaultPurchase,
        isDefaultSale: row.isDefaultSale,
        isActive: true,
        sortOrder: index,
      },
    ];
  });
  if (values.length > 0) {
    await db.insert(productPackagings).values(values);
    console.log(`Menanam ${values.length} kemasan demo (Satuan Kemasan S1)...`);
  }
}
