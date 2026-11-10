/**
 * Agregat KEMASAN PRODUK (Program Satuan Kemasan S1, membuka lagi D-17) —
 * pemilik tunggal tabel product_packagings: baca, resolusi barcode, dan
 * sinkronisasi daftar kemasan satu produk. Matematika & aturan rencana
 * murni hidup di src/lib/packaging.ts; berkas ini hanya menjembatani
 * database (pola yang sama seperti agregat catalog lain).
 *
 * Aturan edit (docs/satuan/RENCANA-SATUAN.md): semua field bisa diedit
 * dan berlaku untuk dokumen berikutnya; histori tidak berubah karena
 * baris transaksi memegang faktor cuplikannya (mulai S2); kemasan
 * terpakai tidak dapat dihapus — hanya dinonaktifkan; barcode unik per
 * perusahaan lintas produk & kemasan ditegakkan di sini (satu sumber).
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  productPackagings,
  products,
  purchaseOrderLines,
  saleLines,
  saleReturnLines,
  stockDocumentLines,
  stockReceiptLines,
  supplierReturnLines,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  PackagingSyncError,
  planPackagingSync,
  type PackagingInput,
  type PackagingSnapshot,
} from "@/lib/packaging";

type PackagingDbRow = typeof productPackagings.$inferSelect;

function toSnapshot(row: PackagingDbRow): PackagingSnapshot {
  return {
    id: row.id,
    name: row.name,
    isi: row.isi,
    buyPrice: row.buyPrice,
    salePrice: row.salePrice,
    barcode: row.barcode,
    isDefaultPurchase: row.isDefaultPurchase,
    isDefaultSale: row.isDefaultSale,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

/** Semua kemasan satu produk (aktif & nonaktif), urutan tampil. */
export async function listProductPackagings(
  tx: Tx,
  companyId: string,
  productId: string,
): Promise<PackagingSnapshot[]> {
  const rows = await tx
    .select()
    .from(productPackagings)
    .where(and(eq(productPackagings.companyId, companyId), eq(productPackagings.productId, productId)))
    .orderBy(asc(productPackagings.sortOrder), asc(productPackagings.name));
  return rows.map(toSnapshot);
}

/** Kemasan banyak produk sekaligus (daftar produk, snapshot POS S5). */
export async function listPackagingsForProducts(
  tx: Tx,
  companyId: string,
  productIds: string[],
): Promise<Map<string, PackagingSnapshot[]>> {
  const result = new Map<string, PackagingSnapshot[]>();
  if (productIds.length === 0) return result;
  const rows = await tx
    .select()
    .from(productPackagings)
    .where(
      and(eq(productPackagings.companyId, companyId), inArray(productPackagings.productId, productIds)),
    )
    .orderBy(asc(productPackagings.sortOrder), asc(productPackagings.name));
  for (const row of rows) {
    const list = result.get(row.productId) ?? [];
    list.push(toSnapshot(row));
    result.set(row.productId, list);
  }
  return result;
}

/**
 * Satu-satunya penjaga keunikan barcode per perusahaan, LINTAS tabel:
 * barcode satuan dasar produk dan barcode kemasan berbagi satu ruang
 * nama — pindai yang sama tidak boleh menyelesaikan ke dua hal berbeda.
 * Jalur simpan produk maupun kemasan wajib lewat sini.
 */
export async function assertBarcodeAvailable(
  tx: Tx,
  companyId: string,
  barcode: string,
  exclude?: { productId?: string; packagingId?: string },
): Promise<void> {
  const value = barcode.trim();
  if (!value) return;

  const [productHit] = await tx
    .select({ id: products.id, name: products.name })
    .from(products)
    .where(
      and(
        eq(products.companyId, companyId),
        eq(products.barcode, value),
        exclude?.productId ? ne(products.id, exclude.productId) : sql`true`,
      ),
    )
    .limit(1);
  if (productHit) {
    throw new AppError("CONFLICT", `Barcode sudah dipakai oleh ${productHit.name}.`);
  }

  const [packagingHit] = await tx
    .select({
      id: productPackagings.id,
      name: productPackagings.name,
      productName: products.name,
    })
    .from(productPackagings)
    .innerJoin(products, eq(productPackagings.productId, products.id))
    .where(
      and(
        eq(productPackagings.companyId, companyId),
        eq(productPackagings.barcode, value),
        exclude?.packagingId ? ne(productPackagings.id, exclude.packagingId) : sql`true`,
      ),
    )
    .limit(1);
  if (packagingHit) {
    throw new AppError(
      "CONFLICT",
      `Barcode sudah dipakai oleh kemasan "${packagingHit.name}" pada produk ${packagingHit.productName}.`,
    );
  }
}

export type BarcodeResolution = {
  productId: string;
  /** Null = barcode satuan dasar produk itu sendiri. */
  packaging: PackagingSnapshot | null;
};

/**
 * Resolusi satu pindai barcode → (produk, kemasan?) — satu-satunya jalur
 * pencarian barcode mulai S2 (penerimaan & POS). Barcode kemasan
 * NONAKTIF tidak menyelesaikan: kemasan terarsip tidak boleh melahirkan
 * transaksi baru (histori menyelesaikan lewat id, bukan barcode).
 */
export async function findProductByAnyBarcode(
  tx: Tx,
  companyId: string,
  barcode: string,
): Promise<BarcodeResolution | null> {
  const value = barcode.trim();
  if (!value) return null;

  const [productHit] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.companyId, companyId), eq(products.barcode, value)))
    .limit(1);
  if (productHit) return { productId: productHit.id, packaging: null };

  const [packagingHit] = await tx
    .select()
    .from(productPackagings)
    .where(
      and(
        eq(productPackagings.companyId, companyId),
        eq(productPackagings.barcode, value),
        eq(productPackagings.isActive, true),
      ),
    )
    .limit(1);
  if (packagingHit) {
    return { productId: packagingHit.productId, packaging: toSnapshot(packagingHit) };
  }
  return null;
}

/**
 * Id kemasan yang sudah terpakai baris transaksi mana pun. S2
 * menghubungkannya ke tiga tabel baris berkemasan migrasi 0063 (baris
 * PO, penerimaan, retur pembelian); S3 menambahkan baris dokumen stok
 * (migrasi 0064) termasuk komponen hitungan opname di jsonb-nya; S4
 * menambahkan baris penjualan & retur penjualan (migrasi 0065).
 * Tahap berikutnya (S5) WAJIB menambahkan tabel barisnya ke daftar
 * ini pada tahap yang sama (gerbang di docs/satuan/RENCANA-SATUAN.md)
 * — penjaga "terpakai → tidak bisa dihapus" di planPackagingSync
 * membaca dari sini.
 */
export async function findUsedPackagingIds(
  tx: Tx,
  companyId: string,
  packagingIds: string[],
): Promise<Set<string>> {
  const used = new Set<string>();
  if (packagingIds.length === 0) return used;
  // S3: stockDocumentLines ikut terdaftar (transfer & penyesuaian
  // berkemasan) — daftar ini adalah registrasi yang dijanjikan S1:
  // setiap tahap yang menambah kolom packaging_id WAJIB mendaftarkan
  // tabel barisnya di sini pada tahap yang sama.
  const lineTables = [
    purchaseOrderLines,
    stockReceiptLines,
    supplierReturnLines,
    stockDocumentLines,
    // S4: baris penjualan & retur penjualan berkemasan (migrasi 0065).
    saleLines,
    saleReturnLines,
  ] as const;
  for (const table of lineTables) {
    const rows = await tx
      .select({ packagingId: table.packagingId })
      .from(table)
      .where(and(eq(table.companyId, companyId), inArray(table.packagingId, packagingIds)));
    for (const row of rows) {
      if (row.packagingId) used.add(row.packagingId);
    }
  }
  // S3: komponen hitungan campuran opname mereferensikan kemasan di
  // dalam jsonb count_breakdown (bukan kolom FK barisnya) — pindai
  // elemennya agar kemasan yang hanya pernah terpakai opname pun
  // terdaftar terpakai dan tidak dapat dihapus fisik.
  const breakdownRows = await tx.execute(sql`
    select distinct elem->>'packagingId' as packaging_id
      from stock_document_lines sdl,
           jsonb_array_elements(coalesce(sdl.count_breakdown, '[]'::jsonb)) elem
     where sdl.company_id = ${companyId}
       and elem->>'packagingId' in (${sql.join(
         packagingIds.map((id) => sql`${id}`),
         sql`, `,
       )})
  `);
  for (const row of breakdownRows as unknown as { packaging_id: string | null }[]) {
    if (row.packaging_id) used.add(row.packaging_id);
  }
  // S3: opname yang selisihnya NOL tidak melahirkan baris dokumen —
  // lembar hitung campurannya hanya hidup di muatan audit
  // (after.counts[].components). Pindai juga di sana agar kemasan
  // yang pernah terhitung opname — cocok maupun berselisih — sama
  // terdaftarnya.
  const auditRows = await tx.execute(sql`
    select distinct comp->>'packagingId' as packaging_id
      from audit_log al,
           jsonb_array_elements(coalesce(al.after->'counts', '[]'::jsonb)) cnt,
           jsonb_array_elements(coalesce(cnt->'components', '[]'::jsonb)) comp
     where al.company_id = ${companyId}
       and al.action = 'inventory.opname'
       and comp->>'packagingId' in (${sql.join(
         packagingIds.map((id) => sql`${id}`),
         sql`, `,
       )})
  `);
  for (const row of auditRows as unknown as { packaging_id: string | null }[]) {
    if (row.packaging_id) used.add(row.packaging_id);
  }
  return used;
}

export type ResolvedLinePackaging = {
  /** Null = baris satuan dasar. */
  packaging: PackagingSnapshot | null;
  /** Faktor cuplikan baris: isi kemasan terpilih; "1" untuk satuan dasar. */
  isiSnapshot: string;
};

/**
 * Resolusi pilihan kemasan baris-baris dokumen (S2) — satu-satunya
 * gerbang validasi kemasan untuk jalur tulis pembelian: kemasan yang
 * dipilih harus ada, milik produk baris itu, dan AKTIF (kemasan
 * terarsip tidak melahirkan transaksi baru — aturan edit #5 rencana).
 * Hasil sejajar dengan urutan `lines`; baris tanpa `packagingId`
 * menyelesaikan ke satuan dasar. Konversi angkanya sendiri dilakukan
 * pemanggil lewat `toBaseQty`/`costPerBaseUnit` (src/lib/packaging)
 * memakai `isiSnapshot` hasil di sini.
 */
export async function resolveLinePackagings(
  tx: Tx,
  companyId: string,
  lines: { productId: string; packagingId?: string | null }[],
  productName: (productId: string) => string,
): Promise<ResolvedLinePackaging[]> {
  const wantedIds = [
    ...new Set(lines.map((line) => line.packagingId).filter((id): id is string => Boolean(id))),
  ];
  const byId = new Map<string, PackagingDbRow>();
  if (wantedIds.length > 0) {
    const rows = await tx
      .select()
      .from(productPackagings)
      .where(
        and(eq(productPackagings.companyId, companyId), inArray(productPackagings.id, wantedIds)),
      );
    for (const row of rows) byId.set(row.id, row);
  }
  return lines.map((line) => {
    if (!line.packagingId) return { packaging: null, isiSnapshot: "1" };
    const row = byId.get(line.packagingId);
    if (!row) {
      throw new AppError(
        "VALIDATION",
        `Kemasan yang dipilih untuk ${productName(line.productId)} tidak ditemukan. Muat ulang formulir lalu coba lagi.`,
      );
    }
    if (row.productId !== line.productId) {
      throw new AppError(
        "VALIDATION",
        `Kemasan "${row.name}" bukan kemasan produk ${productName(line.productId)}.`,
      );
    }
    if (!row.isActive) {
      throw new AppError(
        "VALIDATION",
        `Kemasan "${row.name}" untuk ${productName(line.productId)} sudah nonaktif dan tidak dapat dipakai pada dokumen baru. Aktifkan lagi dari data produk bila memang masih dipakai.`,
      );
    }
    const packaging = toSnapshot(row);
    return { packaging, isiSnapshot: packaging.isi };
  });
}

export type PackagingSyncResult = { created: number; updated: number; deleted: number };

/**
 * Sinkronisasi daftar kemasan satu produk dalam transaksi pemanggil.
 * `priceGateSatisfied` adalah penilaian izin `inventory.price`
 * pemanggil: perubahan harga kemasan tersimpan tanpa izin itu ditolak
 * (pola GDG3-11 yang sama dengan harga master produk).
 */
export async function syncProductPackagings(
  tx: Tx,
  companyId: string,
  productId: string,
  submitted: PackagingInput[],
  opts: { priceGateSatisfied: boolean },
): Promise<PackagingSyncResult> {
  const current = await listProductPackagings(tx, companyId, productId);
  const usedIds = await findUsedPackagingIds(
    tx,
    companyId,
    current.map((row) => row.id),
  );

  let plan;
  try {
    plan = planPackagingSync(current, submitted, usedIds);
  } catch (error) {
    if (error instanceof PackagingSyncError) throw new AppError(error.code, error.message);
    throw error;
  }

  if (plan.priceChanged && !opts.priceGateSatisfied) {
    throw new AppError(
      "FORBIDDEN",
      "Mengubah harga beli atau harga jual kemasan memerlukan izin Ubah harga produk (peran manajer ke atas). Harga tersimpan tidak berubah — simpan perubahan field lain saja, atau minta pengguna berizin yang menerapkan perubahan harga ini.",
    );
  }

  for (const row of [...plan.creates, ...plan.updates]) {
    if (row.barcode) {
      await assertBarcodeAvailable(tx, companyId, row.barcode, {
        packagingId: "id" in row ? row.id : undefined,
      });
    }
  }

  const now = new Date();
  for (const id of plan.deletes) {
    await tx
      .delete(productPackagings)
      .where(and(eq(productPackagings.companyId, companyId), eq(productPackagings.id, id)));
  }
  for (const row of plan.updates) {
    await tx
      .update(productPackagings)
      .set({
        name: row.name,
        isi: row.isi,
        buyPrice: row.buyPrice,
        salePrice: row.salePrice,
        barcode: row.barcode,
        isDefaultPurchase: row.isDefaultPurchase,
        isDefaultSale: row.isDefaultSale,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
        updatedAt: now,
      })
      .where(and(eq(productPackagings.companyId, companyId), eq(productPackagings.id, row.id)));
  }
  if (plan.creates.length > 0) {
    await tx.insert(productPackagings).values(
      plan.creates.map((row) => ({
        companyId,
        productId,
        name: row.name,
        isi: row.isi,
        buyPrice: row.buyPrice,
        salePrice: row.salePrice,
        barcode: row.barcode,
        isDefaultPurchase: row.isDefaultPurchase,
        isDefaultSale: row.isDefaultSale,
        isActive: row.isActive,
        sortOrder: row.sortOrder,
      })),
    );
  }

  return { created: plan.creates.length, updated: plan.updates.length, deleted: plan.deletes.length };
}
