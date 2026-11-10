// A-26 Q4 (K-03): pecahan src/server/actions/inventory.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  asc,
  eq,
  ilike,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import {
  customerGroupPrices,
  products,
  saleLines,
  stockDocumentLines,
  stockMovements,
  stockOnHand,
  stockReceiptLines,
  units,
} from "@/db/schema";
import { getStock } from "@/server/inventory";
import {
  assertBarcodeAvailable,
  findProductByAnyBarcode,
  listPackagingsForProducts,
  listProducts,
  syncProductPackagings,
} from "@/server/catalog";
import type { PackagingInput } from "@/lib/packaging";
import { type CustomFieldValues } from "@/lib/custom-fields";
import { writeAudit } from "@/server/audit";
import {
  requirePermission,
  requirePermissionInModule,
} from "@/lib/session";
import { can } from "@/lib/permissions";

import {
  AppError,
  guard,
} from "@/lib/errors";
import {
  amountField,
  parseInput,
} from "@/lib/action-validation";
import {
  d,
  toDb,
} from "@/lib/money";

import { resolveCustomAttributes } from "./shared";

const productSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(2).max(180),
  sku: z.string().min(1).max(60),
  barcode: z.string().max(60).optional().nullable(),
  categoryId: z.string().uuid().nullish(),
  unitId: z.string().uuid().nullish(),
  supplierId: z.string().uuid().nullish(),
  costPrice: amountField("Harga pokok", "nonNegative"),
  salePrice: amountField("Harga jual", "nonNegative"),
  minStock: amountField("Stok minimum", "nonNegative").optional(),
  trackStock: z.boolean().optional(),
  trackBatch: z.boolean().optional(),
  trackSerial: z.boolean().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(500).optional(),
  // T5-2 (D-16): custom-field values (definition key → raw string);
  // validated against company definitions inside the transaction.
  attributes: z.record(z.string(), z.string()).optional(),
  // Program Satuan Kemasan S1: daftar lengkap kemasan produk yang
  // diinginkan (absen = jangan sentuh kemasan; array — termasuk kosong
  // — = sinkronkan persis). Aturan isi/harga/nama ditegakkan rencana
  // murni di lib/packaging lewat domain server/catalog/packaging.
  packagings: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(60),
        isi: amountField("Isi kemasan", "positive"),
        buyPrice: amountField("Harga beli kemasan", "nonNegative").nullable().optional(),
        salePrice: amountField("Harga jual kemasan", "nonNegative").nullable().optional(),
        barcode: z.string().max(60).nullish(),
        isDefaultPurchase: z.boolean().optional(),
        isDefaultSale: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .max(50)
    .optional(),
});

/** Pemetaan baris kemasan tervalidasi Zod → input domain (lib/packaging). */
function toPackagingInputs(
  rows: NonNullable<z.infer<typeof productSchema>["packagings"]>,
): PackagingInput[] {
  return rows.map((row) => ({
    ...(row.id ? { id: row.id } : {}),
    name: row.name,
    isi: row.isi,
    buyPrice: row.buyPrice ?? null,
    salePrice: row.salePrice ?? null,
    barcode: row.barcode ?? null,
    isDefaultPurchase: row.isDefaultPurchase ?? false,
    isDefaultSale: row.isDefaultSale ?? false,
    isActive: row.isActive ?? true,
  }));
}

export async function saveProductAction(input: z.input<typeof productSchema>) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(productSchema, input);
    const result = await withCompany(ctx.company.id, async (tx) => {
      const [duplicateSku] = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.companyId, ctx.company.id),
            eq(products.sku, data.sku.trim()),
            data.id ? ne(products.id, data.id) : sql`true`,
          ),
        )
        .limit(1);
      if (duplicateSku) throw new AppError("CONFLICT", `SKU ${data.sku} sudah dipakai produk lain.`);

      if (data.barcode?.trim()) {
        // Satuan Kemasan S1: keunikan barcode kini lintas produk DAN
        // kemasan lewat penjaga satu sumber (pesan konflik untuk
        // tabrakan antarproduk identik dengan pemeriksaan lama).
        await assertBarcodeAvailable(tx, ctx.company.id, data.barcode, {
          productId: data.id,
        });
      }

      let currentAttributes: CustomFieldValues | null = null;
      let currentPrices: { costPrice: string; salePrice: string } | null = null;
      if (data.id) {
        const [current] = await tx
          .select({
            attributes: products.attributes,
            costPrice: products.costPrice,
            salePrice: products.salePrice,
          })
          .from(products)
          .where(and(eq(products.companyId, ctx.company.id), eq(products.id, data.id)))
          .limit(1);
        currentAttributes = current?.attributes ?? null;
        currentPrices = current
          ? { costPrice: current.costPrice, salePrice: current.salePrice }
          : null;
      }

      // FIX-GDG Tahap 3 (GDG3-11): mengubah harga produk yang SUDAH ada
      // (harga jual dan/atau harga pokok master) bukan hak pemegang
      // inventory.manage generik — wajib izin inventory.price (bawaan:
      // owner/admin/manager). Harga awal produk BARU tidak digerbang:
      // pembuatan master tetap wewenang inventory.manage (matriks RBAC)
      // dan belum ada harga tersimpan yang "diubah". Perbandingan
      // Decimal agar "10000" vs "10000.0000" tidak dianggap berubah.
      const priceChanged =
        currentPrices !== null &&
        (!d(currentPrices.costPrice).eq(d(data.costPrice)) ||
          !d(currentPrices.salePrice).eq(d(data.salePrice)));
      if (priceChanged && !can(ctx, "inventory.price")) {
        throw new AppError(
          "FORBIDDEN",
          "Mengubah harga jual atau harga pokok produk memerlukan izin Ubah harga produk (peran manajer ke atas). Harga tersimpan tidak berubah — simpan perubahan field lain saja, atau minta pengguna berizin yang menerapkan perubahan harga ini.",
        );
      }
      const attributes = await resolveCustomAttributes(
        tx,
        ctx.company.id,
        "product",
        currentAttributes,
        data.attributes,
      );

      const values = {
        companyId: ctx.company.id,
        name: data.name.trim(),
        sku: data.sku.trim(),
        barcode: data.barcode?.trim() || null,
        categoryId: data.categoryId ?? null,
        unitId: data.unitId ?? null,
        supplierId: data.supplierId ?? null,
        costPrice: toDb(data.costPrice),
        salePrice: toDb(data.salePrice),
        minStock: toDb(data.minStock ?? 0),
        trackStock: data.trackStock ?? true,
        trackBatch: data.trackBatch ?? false,
        trackSerial: data.trackSerial ?? false,
        attributes,
        isActive: data.isActive ?? true,
        notes: data.notes,
        updatedAt: new Date(),
      };

      if (data.id) {
        const [updated] = await tx
          .update(products)
          .set(values)
          .where(and(eq(products.companyId, ctx.company.id), eq(products.id, data.id)))
          .returning({ id: products.id });
        if (!updated) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.");
        if (data.packagings !== undefined) {
          await syncProductPackagings(
            tx,
            ctx.company.id,
            data.id,
            toPackagingInputs(data.packagings),
            { priceGateSatisfied: can(ctx, "inventory.price") },
          );
        }
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "product.update",
          entityType: "product",
          entityId: data.id,
          // GDG3-11 (arah perbaikan audit): perubahan harga wajib
          // tercatat nilai lama → barunya; update tanpa perubahan
          // harga mempertahankan snapshot ringkas yang lama.
          ...(priceChanged && currentPrices
            ? {
                before: {
                  costPrice: currentPrices.costPrice,
                  salePrice: currentPrices.salePrice,
                },
              }
            : {}),
          after: {
            sku: values.sku,
            name: values.name,
            ...(priceChanged
              ? { costPrice: values.costPrice, salePrice: values.salePrice }
              : {}),
            ...(data.packagings !== undefined
              ? { packagingCount: data.packagings.length }
              : {}),
          },
        });
        return updated;
      }

      const [created] = await tx.insert(products).values(values).returning({ id: products.id });
      if (data.packagings !== undefined) {
        await syncProductPackagings(
          tx,
          ctx.company.id,
          created.id,
          toPackagingInputs(data.packagings),
          { priceGateSatisfied: can(ctx, "inventory.price") },
        );
      }
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "product.create",
        entityType: "product",
        entityId: created.id,
        after: {
          sku: values.sku,
          name: values.name,
          ...(data.packagings !== undefined
            ? { packagingCount: data.packagings.length }
            : {}),
        },
      });
      return created;
    });

    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang");
    return result;
  });
}

export async function toggleProductAction(input: { id: string; isActive: boolean }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const data = parseInput(z.object({ id: z.string().uuid(), isActive: z.boolean() }), input);
    await withCompany(ctx.company.id, async (tx) => {
      const [updated] = await tx
        .update(products)
        .set({ isActive: data.isActive, updatedAt: new Date() })
        .where(and(eq(products.companyId, ctx.company.id), eq(products.id, data.id)))
        .returning({ id: products.id });
      if (!updated) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: data.isActive ? "product.activate" : "product.deactivate",
        entityType: "product",
        entityId: data.id,
      });
    });
    revalidatePath("/app/gudang/produk");
    return data;
  });
}

export async function deleteProductAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("inventory.manage", "gudang");
    const productId = parseInput(z.string().uuid(), id);
    await withCompany(ctx.company.id, async (tx) => {
      const [product] = await tx
        .select({ id: products.id, sku: products.sku, name: products.name })
        .from(products)
        .where(and(eq(products.companyId, ctx.company.id), eq(products.id, productId)))
        .limit(1);
      if (!product) throw new AppError("NOT_FOUND", "Produk tidak ditemukan.");

      const onHandRows = await tx
        .select({ qty: stockOnHand.qty })
        .from(stockOnHand)
        .where(and(eq(stockOnHand.companyId, ctx.company.id), eq(stockOnHand.productId, productId)));
      const stocked = onHandRows.some((row) => d(row.qty).gt(0));
      if (stocked) {
        throw new AppError(
          "CONFLICT",
          "Produk masih memiliki stok di gudang. Kosongkan stoknya terlebih dahulu, atau nonaktifkan produk alih-alih menghapus.",
        );
      }
      const [movements] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(and(eq(stockMovements.companyId, ctx.company.id), eq(stockMovements.productId, productId)));
      if ((movements?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Produk sudah memiliki riwayat pergerakan stok dan tidak dapat dihapus. Nonaktifkan produk alih-alih menghapus.",
        );
      }
      const [sold] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(saleLines)
        .where(and(eq(saleLines.companyId, ctx.company.id), eq(saleLines.productId, productId)));
      if ((sold?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Produk sudah pernah terjual dan tidak dapat dihapus. Nonaktifkan produk alih-alih menghapus.",
        );
      }
      const [receiptLines] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockReceiptLines)
        .where(and(eq(stockReceiptLines.companyId, ctx.company.id), eq(stockReceiptLines.productId, productId)));
      const [documentLines] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(stockDocumentLines)
        .where(and(eq(stockDocumentLines.companyId, ctx.company.id), eq(stockDocumentLines.productId, productId)));
      if ((receiptLines?.value ?? 0) > 0 || (documentLines?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Produk sudah dipakai pada dokumen gudang (penerimaan/penyesuaian/transfer/opname). Nonaktifkan produk alih-alih menghapus.",
        );
      }
      const [priceRules] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(customerGroupPrices)
        .where(and(eq(customerGroupPrices.companyId, ctx.company.id), eq(customerGroupPrices.productId, productId)));
      if ((priceRules?.value ?? 0) > 0) {
        throw new AppError(
          "CONFLICT",
          "Produk masih memiliki aturan harga pada kelompok pelanggan. Hapus aturan harga tersebut terlebih dahulu.",
        );
      }

      // Only zero-qty on-hand leftovers can remain at this point; remove them
      // with the product so no orphan stock rows are left behind.
      await tx
        .delete(stockOnHand)
        .where(and(eq(stockOnHand.companyId, ctx.company.id), eq(stockOnHand.productId, productId)));
      await tx
        .delete(products)
        .where(and(eq(products.companyId, ctx.company.id), eq(products.id, productId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "product.delete",
        entityType: "product",
        entityId: productId,
        before: { sku: product.sku, name: product.name },
      });
    });
    revalidatePath("/app/gudang/produk");
    revalidatePath("/app/gudang");
    revalidatePath("/app/pos");
    return { id: productId };
  });
}

// T5R-2: semua action TULIS di berkas ini memakai
// requirePermissionInModule(..., "gudang"). Empat action di bawah ini
// murni membaca (inventory.view) untuk pemilih produk di form gudang —
// dikecualikan dari gerbang saklar karena tidak mengubah data apa pun;
// halaman yang memuatnya sudah tergerbang di layout.
export async function searchInventoryProductsAction(q: string) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    // R3 K-3 (kelas AUD-013): harga pokok produk & harga beli kemasan
    // adalah data level-field `inventory.cost`; tanpa izin itu nilainya
    // null di muatan (aksi tetap berhasil) — pola ekspor A4 persis.
    const includeCost = can(ctx, "inventory.cost");
    return withCompany(ctx.company.id, async (tx) => {
      const term = q.trim();
      const rows = await tx
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          barcode: products.barcode,
          costPrice: products.costPrice,
          salePrice: products.salePrice,
          trackBatch: products.trackBatch,
          trackSerial: products.trackSerial,
          // S3: nama satuan dasar — label komponen lepas hitungan
          // campuran opname ("5 Pcs").
          unitName: units.name,
        })
        .from(products)
        .leftJoin(units, eq(products.unitId, units.id))
        .where(
          and(
            eq(products.companyId, ctx.company.id),
            eq(products.isActive, true),
            term
              ? or(
                  ilike(products.name, `%${term}%`),
                  ilike(products.sku, `%${term}%`),
                  ilike(products.barcode, `%${term}%`),
                )
              : sql`true`,
          ),
        )
        .orderBy(asc(products.name))
        .limit(20);
      // S2: kemasan AKTIF tiap produk ikut serta — pemilih baris
      // (PO/penerimaan/retur) menawarkannya tanpa panggilan kedua.
      const packagingsByProduct = await listPackagingsForProducts(
        tx,
        ctx.company.id,
        rows.map((row) => row.id),
      );
      return rows.map((row) => ({
        ...row,
        costPrice: includeCost ? row.costPrice : null,
        packagings: (packagingsByProduct.get(row.id) ?? [])
          .filter((p) => p.isActive)
          .map((p) => (includeCost ? p : { ...p, buyPrice: null })),
      }));
    });
  });
}

/**
 * S2: resolusi SATU pindai barcode untuk form gudang — satu-satunya
 * jalur pencarian barcode (domain findProductByAnyBarcode): barcode
 * satuan dasar menyelesaikan ke produknya, barcode KEMASAN ke produk
 * + kemasan itu, sehingga memindai dus di penerimaan/PO langsung
 * mengisi baris berkemasan. Mengembalikan null bila tak dikenal.
 */
export async function resolveBarcodeAction(input: { barcode: string }) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    // R3 K-3: sanitasi biaya yang sama dengan pencarian picker.
    const includeCost = can(ctx, "inventory.cost");
    const data = parseInput(z.object({ barcode: z.string().trim().min(1).max(80) }), input);
    return withCompany(ctx.company.id, async (tx) => {
      const resolved = await findProductByAnyBarcode(tx, ctx.company.id, data.barcode);
      if (!resolved) return null;
      const [product] = await tx
        .select({
          id: products.id,
          sku: products.sku,
          name: products.name,
          barcode: products.barcode,
          costPrice: products.costPrice,
          salePrice: products.salePrice,
          trackBatch: products.trackBatch,
          trackSerial: products.trackSerial,
          unitName: units.name,
        })
        .from(products)
        .leftJoin(units, eq(products.unitId, units.id))
        .where(and(eq(products.companyId, ctx.company.id), eq(products.id, resolved.productId)))
        .limit(1);
      if (!product) return null;
      const packagingsByProduct = await listPackagingsForProducts(tx, ctx.company.id, [product.id]);
      return {
        product: {
          ...product,
          costPrice: includeCost ? product.costPrice : null,
          packagings: (packagingsByProduct.get(product.id) ?? [])
            .filter((p) => p.isActive)
            .map((p) => (includeCost ? p : { ...p, buyPrice: null })),
        },
        packaging: resolved.packaging
          ? includeCost
            ? resolved.packaging
            : { ...resolved.packaging, buyPrice: null }
          : resolved.packaging,
      };
    });
  });
}

export async function productStockAction(input: { warehouseId: string; productId: string }) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    const data = parseInput(z.object({ warehouseId: z.string().uuid(), productId: z.string().uuid() }), input);
    return withCompany(ctx.company.id, async (tx) => {
      const rows = (await tx.execute(sql`
        select coalesce(qty, 0) as qty from stock_on_hand
        where company_id = ${ctx.company.id} and warehouse_id = ${data.warehouseId} and product_id = ${data.productId}
      `)) as unknown as { qty: string }[];
      return { qty: Number(rows[0]?.qty ?? 0) };
    });
  });
}

/**
 * Stok sistem banyak produk sekaligus di satu gudang (GD-P3-9) — form opname
 * memakainya untuk mengambil ulang qty sistem semua baris saat gudang diganti,
 * agar kolom Sistem/Selisih tidak basi.
 */
export async function productsStockAction(input: { warehouseId: string; productIds: string[] }) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    const data = parseInput(
      z.object({
        warehouseId: z.string().uuid(),
        productIds: z.array(z.string().uuid()).max(1000),
      }),
      input,
    );
    return withCompany(ctx.company.id, async (tx) => {
      const stock = await getStock(tx, ctx.company.id, data.warehouseId, data.productIds);
      return data.productIds.map((productId) => ({
        productId,
        qty: stock.get(productId) ?? 0,
      }));
    });
  });
}

/** Batas produk yang dimuat mode "muat semua" opname dalam sekali jalan. */
const OPNAME_LOAD_ALL_LIMIT = 1000;

/**
 * Semua produk aktif terlacak di satu gudang beserta stok sistemnya
 * (GD-P3-9) untuk mode hitung menyeluruh pada form opname. `listProducts`
 * terpaginasi maks 200 per halaman, jadi pemuatan berjalan berchunk sampai
 * batas OPNAME_LOAD_ALL_LIMIT; `truncated` memberi tahu UI bila katalog
 * terlacak gudang itu melebihi batas. Server tetap menghitung ulang stok
 * saat posting opname, jadi angka di sini murni tampilan awal.
 */
export async function loadOpnameProductsAction(input: { warehouseId: string }) {
  return guard(async () => {
    const ctx = await requirePermission("inventory.view");
    // R3 K-3: costPrice hanya untuk pemegang `inventory.cost`.
    const includeCost = can(ctx, "inventory.cost");
    const data = parseInput(z.object({ warehouseId: z.string().uuid() }), input);
    return withCompany(ctx.company.id, async (tx) => {
      const rows: {
        productId: string;
        name: string;
        sku: string;
        system: number;
        costPrice: string | null;
        unitName: string | null;
        // Satuan Kemasan S3: kemasan AKTIF produk — form opname
        // menawarkan hitungan campuran untuk produk berkemasan.
        packagings: { id: string; name: string; isi: string }[];
      }[] = [];
      let page = 1;
      for (;;) {
        const result = await listProducts(tx, {
          companyId: ctx.company.id,
          warehouseId: data.warehouseId,
          page,
          pageSize: 200,
        });
        for (const row of result.rows) {
          if (!row.trackStock) continue;
          rows.push({
            productId: row.id,
            name: row.name,
            sku: row.sku,
            system: row.stock,
            costPrice: includeCost ? row.costPrice : null,
            unitName: row.unitName ?? null,
            packagings: [],
          });
          if (rows.length >= OPNAME_LOAD_ALL_LIMIT) break;
        }
        if (rows.length >= OPNAME_LOAD_ALL_LIMIT || page * result.pageSize >= result.total) break;
        page += 1;
      }
      const truncated = rows.length >= OPNAME_LOAD_ALL_LIMIT;
      const packagingsByProduct = await listPackagingsForProducts(
        tx,
        ctx.company.id,
        rows.map((row) => row.productId),
      );
      for (const row of rows) {
        row.packagings = (packagingsByProduct.get(row.productId) ?? [])
          .filter((pack) => pack.isActive)
          .map((pack) => ({ id: pack.id, name: pack.name, isi: pack.isi }));
      }
      return { rows, truncated };
    });
  });
}
