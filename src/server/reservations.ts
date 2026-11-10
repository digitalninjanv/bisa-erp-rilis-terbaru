import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  products,
  stockDocumentLines,
  stockDocuments,
  stockOnHand,
  stockReservations,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import {
  LIST_PAGE_SIZE,
  normalizePageParams,
  pageOffset,
  pageResult,
  type PageResult,
} from "@/lib/pagination";
import { todayISO } from "@/lib/format";
import { d, toDb, type MoneyInput } from "@/lib/money";
import { nextDocumentNumber } from "@/server/sequences";

import { getCompanySettingsRow } from "@/server/settings";
/**
 * SIM-2 S7B-2 Batch 4 — Reservasi stok.
 *
 * Definisi: reservasi adalah janji ketersediaan untuk penjualan yang
 * akan datang. Ia mengurangi stok TERSEDIA (on hand − reserved) pada
 * pemeriksaan ketersediaan POS/penjualan, tetapi TIDAK menulis
 * stock_movements dan TIDAK mengubah stock_on_hand — invariant ledger
 * tidak tersentuh. Kedaluwarsa dinilai saat dibaca (expires_at <= now
 * berarti tidak lagi aktif), tanpa cron; status tersimpan hanya berubah
 * lewat rilis/batal eksplisit.
 */

export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  active: "Aktif",
  released: "Dirilis",
  expired: "Kedaluwarsa",
  cancelled: "Dibatalkan",
  // FIX-GDG Tahap 2 (GDG1-09): habis dikonsumsi dokumen keluar
  // (checkout POS yang menyebut reservasi ini).
  fulfilled: "Terpenuhi",
};

/** FIX-GDG Tahap 2 (GDG1-09): kedaluwarsa bawaan bila pengaturan
 * perusahaan belum pernah disimpan sama sekali. */
export const RESERVATION_DEFAULT_EXPIRY_DAYS_FALLBACK = 7;

function addDaysISO(date: string, days: number): string {
  const t = new Date(`${date}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

export function effectiveReservationStatus(
  row: { status: string; expiresAt: Date | null },
  now = new Date(),
): string {
  if (row.status === "active" && row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  return row.status;
}

export async function createReservation(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    warehouseId: string;
    productId: string;
    qty: MoneyInput;
    date: string;
    expiresAt?: Date | null;
    reason?: string | null;
  },
) {
  const qty = d(input.qty);
  if (qty.lte(0)) throw new AppError("VALIDATION", "Qty reservasi harus lebih dari nol.");
  const [warehouse] = await tx
    .select({ id: warehouses.id, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, input.companyId), eq(warehouses.id, input.warehouseId)))
    .limit(1);
  if (!warehouse || !warehouse.isActive) throw new AppError("VALIDATION", "Gudang tidak ditemukan atau nonaktif.");
  const [product] = await tx
    .select({ id: products.id, name: products.name, trackStock: products.trackStock })
    .from(products)
    .where(and(eq(products.companyId, input.companyId), eq(products.id, input.productId)))
    .limit(1);
  if (!product) throw new AppError("VALIDATION", "Produk tidak ditemukan.");
  if (!product.trackStock) {
    throw new AppError("VALIDATION", `${product.name} tidak melacak stok sehingga tidak bisa direservasi.`);
  }
  // FIX-GDG Tahap 2 (GDG1-06/GDG3-14): ketersediaan dinilai DI BAWAH
  // KUNCI baris stock_on_hand (produk × gudang). Sebelumnya on-hand
  // dibaca tanpa kunci di transaksi READ COMMITTED, sehingga dua
  // reservasi paralel 8+8 atas stok 10 sama-sama melihat tersedia 10
  // dan sama-sama lolos — total janji 16 atas stok fisik 10. Baris
  // on-hand dibuat bila belum ada (produk belum pernah bergerak) lalu
  // dikunci FOR UPDATE; transaksi kedua menunggu, lalu membaca ulang
  // total reservasi yang sudah memuat reservasi pertama.
  await tx
    .insert(stockOnHand)
    .values({
      companyId: input.companyId,
      warehouseId: input.warehouseId,
      productId: input.productId,
      qty: "0",
    })
    .onConflictDoNothing();
  const [onHandRow] = await tx
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(
      and(
        eq(stockOnHand.companyId, input.companyId),
        eq(stockOnHand.warehouseId, input.warehouseId),
        eq(stockOnHand.productId, input.productId),
      ),
    )
    .limit(1)
    .for("update");
  const reserved = await getReservedQuantities(tx, input.companyId, input.warehouseId, [input.productId]);
  const available = d(onHandRow?.qty ?? 0).minus(reserved.get(input.productId) ?? 0);
  if (qty.gt(available)) {
    throw new AppError(
      "VALIDATION",
      `Qty reservasi melebihi stok tersedia ${product.name} (${available.toString()}).`,
    );
  }
  // FIX-GDG Tahap 2 (GDG1-09): kedaluwarsa bawaan dari pengaturan
  // perusahaan (D-25: konfigurasi, bukan konstanta di kode) bila
  // pemanggil tidak menyebut tanggal kedaluwarsa eksplisit. Jangkar
  // hitungnya adalah tanggal yang LEBIH AKHIR antara tanggal dokumen
  // dan hari pembuatan: reservasi tidak pernah lahir sudah kedaluwarsa
  // hanya karena dokumennya di-backdate, dan dokumen bertanggal masa
  // depan memulai jam kedaluwarsanya dari tanggalnya sendiri.
  let expiresAt = input.expiresAt ?? null;
  if (expiresAt == null) {
    const settings = await getCompanySettingsRow(tx, input.companyId);
    const days = settings?.reservationDefaultExpiryDays ?? RESERVATION_DEFAULT_EXPIRY_DAYS_FALLBACK;
    const today = todayISO();
    const anchor = input.date > today ? input.date : today;
    expiresAt = new Date(addDaysISO(anchor, days));
  }
  const number = await nextDocumentNumber(tx, input.companyId, "RESERVATION", input.date);
  const [row] = await tx
    .insert(stockReservations)
    .values({
      companyId: input.companyId,
      number,
      warehouseId: input.warehouseId,
      productId: input.productId,
      qty: toDb(qty),
      date: input.date,
      expiresAt,
      reason: input.reason ?? null,
      createdBy: input.userId,
    })
    .returning();
  return row;
}

/** Total qty reservasi AKTIF (belum kedaluwarsa saat dibaca) per produk di satu gudang.
 * `excludeReservationId` (GDG1-09): satu reservasi dikecualikan dari
 * total — dipakai checkout yang menyebut reservasi itu sendiri, agar
 * stok yang dijanjikan kepadanya tidak memblokir pemenuhannya. */
export async function getReservedQuantities(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  productIds: string[],
  now = new Date(),
  opts?: { excludeReservationId?: string | null },
): Promise<Map<string, ReturnType<typeof d>>> {
  const result = new Map<string, ReturnType<typeof d>>();
  if (productIds.length === 0) return result;
  const rows = await tx
    .select({ productId: stockReservations.productId, qty: stockReservations.qty })
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.companyId, companyId),
        eq(stockReservations.warehouseId, warehouseId),
        eq(stockReservations.status, "active"),
        inArray(stockReservations.productId, productIds),
        or(isNull(stockReservations.expiresAt), gt(stockReservations.expiresAt, now)),
      ),
    );
  for (const row of rows) {
    result.set(row.productId, (result.get(row.productId) ?? d(0)).plus(row.qty));
  }
  if (opts?.excludeReservationId) {
    const [excluded] = await tx
      .select({ productId: stockReservations.productId, qty: stockReservations.qty, status: stockReservations.status, expiresAt: stockReservations.expiresAt })
      .from(stockReservations)
      .where(
        and(
          eq(stockReservations.companyId, companyId),
          eq(stockReservations.id, opts.excludeReservationId),
        ),
      )
      .limit(1);
    if (
      excluded &&
      excluded.status === "active" &&
      (excluded.expiresAt == null || excluded.expiresAt.getTime() > now.getTime())
    ) {
      const current = result.get(excluded.productId);
      if (current) {
        const next = current.minus(excluded.qty);
        if (next.gt(0)) result.set(excluded.productId, next);
        else result.delete(excluded.productId);
      }
    }
  }
  return result;
}

export async function releaseReservation(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    reservationId: string;
    cancelled?: boolean;
  },
) {
  const [row] = await tx
    .select()
    .from(stockReservations)
    .where(and(eq(stockReservations.companyId, input.companyId), eq(stockReservations.id, input.reservationId)))
    .limit(1)
    .for("update");
  if (!row) throw new AppError("NOT_FOUND", "Reservasi tidak ditemukan.");
  if (row.status !== "active") {
    throw new AppError("CONFLICT", "Reservasi ini sudah tidak aktif.");
  }
  const [updated] = await tx
    .update(stockReservations)
    .set({
      status: input.cancelled ? "cancelled" : "released",
      releasedBy: input.userId,
      releasedAt: new Date(),
    })
    .where(and(eq(stockReservations.companyId, input.companyId), eq(stockReservations.id, input.reservationId)))
    .returning();
  return updated;
}

/**
 * FIX-GDG Tahap 2 (GDG1-09) — jalur pemenuhan reservasi: KONSUMSI-
 * TERTUJU. Reservasi adalah janji per (produk × gudang) tanpa tautan
 * pelanggan/dokumen di skema yang ada, jadi pemenuhan yang konsisten
 * dengan arsitektur ini adalah: dokumen keluar (checkout POS) MENYEBUT
 * reservationId-nya; stok reservasi itu tidak menghalangi penjualannya
 * sendiri (pengecualian pada pemeriksaan ketersediaan), dan sesudah
 * dokumen terposting alokasinya dikurangi atomik oleh helper di bawah.
 * Pelepasan manual tetap ada untuk pembatalan janji, bukan lagi syarat
 * untuk menepati janji.
 */
export async function getConsumableReservation(
  tx: Tx,
  input: { companyId: string; reservationId: string; warehouseId: string; now?: Date },
) {
  const [row] = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.companyId, input.companyId),
        eq(stockReservations.id, input.reservationId),
      ),
    )
    .limit(1);
  if (!row) throw new AppError("VALIDATION", "Reservasi yang dirujuk tidak ditemukan.");
  if (row.warehouseId !== input.warehouseId) {
    throw new AppError(
      "VALIDATION",
      "Reservasi yang dirujuk berada di gudang lain sehingga tidak bisa dipenuhi dari gudang ini.",
    );
  }
  if (row.status !== "active") {
    throw new AppError(
      "VALIDATION",
      `Reservasi ${row.number} sudah tidak aktif sehingga tidak bisa dipenuhi.`,
    );
  }
  const now = input.now ?? new Date();
  if (row.expiresAt != null && row.expiresAt.getTime() <= now.getTime()) {
    throw new AppError(
      "VALIDATION",
      `Reservasi ${row.number} sudah kedaluwarsa sehingga tidak bisa dipenuhi.`,
    );
  }
  return row;
}

/** Kurangi alokasi reservasi sebesar qty terjual produknya (atomik di
 * bawah kunci baris reservasi). Habis → status "fulfilled". Mengembalikan
 * qty yang benar-benar terkonsumsi (0 bila reservasi ternyata sudah
 * tidak aktif — pemanggil menilai). */
export async function consumeReservationForSale(
  tx: Tx,
  input: {
    companyId: string;
    userId: string;
    reservationId: string;
    soldQtyByProduct: Map<string, ReturnType<typeof d>>;
  },
): Promise<{ consumedQty: ReturnType<typeof d>; fulfilled: boolean }> {
  const [row] = await tx
    .select()
    .from(stockReservations)
    .where(
      and(
        eq(stockReservations.companyId, input.companyId),
        eq(stockReservations.id, input.reservationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row || row.status !== "active") return { consumedQty: d(0), fulfilled: false };
  const sold = input.soldQtyByProduct.get(row.productId) ?? d(0);
  const consumed = sold.lt(row.qty) ? sold : d(row.qty);
  if (!consumed.gt(0)) return { consumedQty: d(0), fulfilled: false };
  const remaining = d(row.qty).minus(consumed);
  const fulfilled = !remaining.gt(0);
  await tx
    .update(stockReservations)
    .set({
      qty: toDb(remaining),
      ...(fulfilled
        ? { status: "fulfilled", releasedBy: input.userId, releasedAt: new Date() }
        : {}),
    })
    .where(
      and(
        eq(stockReservations.companyId, input.companyId),
        eq(stockReservations.id, input.reservationId),
      ),
    );
  return { consumedQty: consumed, fulfilled };
}

export async function listReservations(tx: Tx, companyId: string) {
  const rows = await tx
    .select({
      reservation: stockReservations,
      productName: products.name,
      productSku: products.sku,
      warehouseName: warehouses.name,
    })
    .from(stockReservations)
    .innerJoin(products, eq(stockReservations.productId, products.id))
    .innerJoin(warehouses, eq(stockReservations.warehouseId, warehouses.id))
    .where(eq(stockReservations.companyId, companyId))
    .orderBy(asc(stockReservations.date));
  const now = new Date();
  return rows.map((row) => ({
    ...row.reservation,
    productName: row.productName,
    productSku: row.productSku,
    warehouseName: row.warehouseName,
    effectiveStatus: effectiveReservationStatus(row.reservation, now),
  }));
}

/**
 * G3 (TBL-01): bacaan TERPAGINASI + TERFILTER SQL untuk halaman
 * daftar reservasi — sebelumnya halaman membaca seluruh daftar lalu
 * menyaring kata kunci & membalik urutan di memori saat render.
 * Kata kunci kini ilike di SQL atas nomor, nama/SKU produk, gudang,
 * dan alasan (cakupan yang sama dengan saringan memori lama);
 * urutan tampil terbaru dulu (tanggal desc, nomor desc).
 */
export async function listReservationsPage(
  tx: Tx,
  companyId: string,
  opts: { q?: string; page?: number; pageSize?: number },
): Promise<PageResult<Awaited<ReturnType<typeof listReservations>>[number]>> {
  const { page, pageSize } = normalizePageParams(opts, LIST_PAGE_SIZE);
  const conditions = [eq(stockReservations.companyId, companyId)];
  const q = opts.q?.trim();
  if (q) {
    conditions.push(
      or(
        ilike(stockReservations.number, `%${q}%`),
        ilike(products.name, `%${q}%`),
        ilike(products.sku, `%${q}%`),
        ilike(warehouses.name, `%${q}%`),
        ilike(stockReservations.reason, `%${q}%`),
      )!,
    );
  }
  const where = and(...conditions);
  const [totalRow] = await tx
    .select({ value: count() })
    .from(stockReservations)
    .innerJoin(products, eq(stockReservations.productId, products.id))
    .innerJoin(warehouses, eq(stockReservations.warehouseId, warehouses.id))
    .where(where);
  const rows = await tx
    .select({
      reservation: stockReservations,
      productName: products.name,
      productSku: products.sku,
      warehouseName: warehouses.name,
    })
    .from(stockReservations)
    .innerJoin(products, eq(stockReservations.productId, products.id))
    .innerJoin(warehouses, eq(stockReservations.warehouseId, warehouses.id))
    .where(where)
    .orderBy(desc(stockReservations.date), desc(stockReservations.number))
    .limit(pageSize)
    .offset(pageOffset(page, pageSize));
  const now = new Date();
  return pageResult(
    rows.map((row) => ({
      ...row.reservation,
      productName: row.productName,
      productSku: row.productSku,
      warehouseName: row.warehouseName,
      effectiveStatus: effectiveReservationStatus(row.reservation, now),
    })),
    totalRow?.value ?? 0,
    page,
    pageSize,
  );
}

/**
 * G3 (TBL-01): ringkasan KPI daftar reservasi tanpa membaca seluruh
 * daftar — total semua status, jumlah aktif EFEKTIF, dan qty aktif.
 * "Aktif efektif" di SQL meniru `effectiveReservationStatus` persis:
 * status tersimpan 'active' DAN belum kedaluwarsa saat dibaca
 * (expiresAt NULL atau > sekarang).
 */
export async function countReservationsSummary(
  tx: Tx,
  companyId: string,
  now = new Date(),
): Promise<{ total: number; active: number; activeQty: string }> {
  const activeWhere = and(
    eq(stockReservations.companyId, companyId),
    eq(stockReservations.status, "active"),
    or(isNull(stockReservations.expiresAt), gt(stockReservations.expiresAt, now)),
  );
  const [totalRow] = await tx
    .select({ value: count() })
    .from(stockReservations)
    .where(eq(stockReservations.companyId, companyId));
  const [activeRow] = await tx
    .select({ value: count(), qty: sql<string>`coalesce(sum(${stockReservations.qty}), 0)` })
    .from(stockReservations)
    .where(activeWhere);
  return {
    total: totalRow?.value ?? 0,
    active: activeRow?.value ?? 0,
    activeQty: activeRow?.qty ?? "0",
  };
}

/** Ringkasan stok dalam perjalanan (transfer dua tahap yang belum diterima). */
export async function getInTransitSummary(tx: Tx, companyId: string) {
  const docs = await tx
    .select({ id: stockDocuments.id, total: stockDocuments.total })
    .from(stockDocuments)
    .where(
      and(
        eq(stockDocuments.companyId, companyId),
        eq(stockDocuments.type, "transfer"),
        eq(stockDocuments.status, "in_transit"),
      ),
    );
  if (docs.length === 0) return { documents: 0, totalQty: "0", totalValue: "0" };
  const lines = await tx
    // FIX-GDG Tahap 2 (GDG1-07): yang masih "dalam perjalanan" adalah
    // SISA kirim (qty − receivedQty) sesudah penerimaan sebagian,
    // bukan qty kirim penuh.
    .select({ qty: stockDocumentLines.qty, receivedQty: stockDocumentLines.receivedQty })
    .from(stockDocumentLines)
    .where(
      and(
        eq(stockDocumentLines.companyId, companyId),
        inArray(
          stockDocumentLines.documentId,
          docs.map((doc) => doc.id),
        ),
      ),
    );
  return {
    documents: docs.length,
    totalQty: toDb(lines.reduce((sum, row) => sum.plus(d(row.qty).minus(row.receivedQty)), d(0))),
    totalValue: toDb(docs.reduce((sum, doc) => sum.plus(doc.total), d(0))),
  };
}
