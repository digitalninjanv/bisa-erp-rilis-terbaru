import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  auditLog,
  categories,
  customerGroups,
  productPackagings,
  products,
  stockOnHand,
  units,
} from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  assertPosDeviceSnapshotComplete,
  POS_DEVICE_SNAPSHOT_MAX_PRODUCTS,
} from "@/lib/pos/snapshot-limit";
import {
  listPackagingsForProducts,
  searchProducts,
} from "@/server/catalog";
import type { PackagingSnapshot } from "@/lib/packaging";
import type { KitchenTicket } from "@/lib/pos/kitchen-display";
import {
  readGroupPrices,
  readSnapshotRefs,
  resolvePosTerminalByToken,
  type PosDeviceIdentity,
  type PosSnapshotCustomerGroup,
  type PosSnapshotGroupPrice,
  type PosSnapshotLoyaltyBalance,
  type PosSnapshotNames,
  type PosSnapshotPromotion,
  type PosSnapshotReceipt,
  type PosSnapshotReservation,
  type PosSnapshotTerminal,
} from "./pos";

export type {
  PosSnapshotCustomerGroup,
  PosSnapshotGroupPrice,
  PosSnapshotLoyaltyBalance,
  PosSnapshotNames,
  PosSnapshotPromotion,
  PosSnapshotReceipt,
  PosSnapshotReservation,
  PosSnapshotTerminal,
};

export {
  posSessionIntentSchema,
  posSyncItemSchema,
  posSyncRequestSchema,
  syncPosDeviceItems,
  syncPosDeviceSessionIntents,
} from "./pos";
export type { PosDeviceIdentity, PosSessionIntent, PosSessionIntentResult } from "./pos";

/**
 * POS Native (Tauri) — permukaan hosted `/api/pos/*`
 * (RENCANA-TAURI D1/D2/D7). Aplikasi desktop TIDAK memakai sesi
 * peramban/Server Actions: ia mengautentikasi sebagai PERANGKAT
 * dengan token pembawa (bearer) dan memanggil endpoint ini.
 *
 * Langkah 6: token kini PER-TERMINAL dari registry server
 * (`pos_terminals`, diterbitkan lewat pemasangan kode pasangan di
 * `/api/pos/pair`; server hanya menyimpan digest-nya). Jalur token
 * env `BISA_POS_DEVICE_TOKENS` dari Langkah 1–5 DIBUANG BERSIH —
 * satu-satunya sumber token adalah registry, agar perilaku dev dan
 * produksi tidak bercabang dan setiap token bisa dicabut
 * per-terminal. userId pada registry adalah anggota perusahaan
 * yang menjadi aktor penyinkron (hak kasir asal tetap diresolusi
 * per item dari muatan, persis seperti jalur aksi web).
 *
 * Aturan bisnis TIDAK diduplikasi di sini: snapshot membaca fungsi
 * domain katalog yang sama dengan terminal web, dan sinkronisasi
 * menjalankan `processOfflineSaleItem` yang sama dengan
 * `syncOfflineSalesAction` — skema Zod muatan pun satu definisi
 * bersama (dipakai kedua jalur).
 */

/**
 * Resolusi token perangkat dari header Authorization: Bearer
 * <token> lewat registry terminal (pra-tenant, lihat
 * `server/pos/terminals.ts`). Terminal yang dicabut atau token tak
 * dikenal → null (pemanggil menjawab 401 seragam).
 */
export async function resolvePosDevice(
  request: Request,
): Promise<PosDeviceIdentity | null> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return null;
  const terminal = await resolvePosTerminalByToken(match[1]);
  if (!terminal) return null;
  return {
    companyId: terminal.companyId,
    userId: terminal.userId,
    label: terminal.terminalName,
    terminalId: terminal.terminalId,
    terminalName: terminal.terminalName,
    warehouseId: terminal.warehouseId,
  };
}

/** CORS untuk klien desktop (origin tauri://… / http://tauri.localhost):
 *  autentikasi token pembawa, bukan cookie, jadi `*` aman di tahap ini. */
export const POS_API_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400",
};

// ---------------------------------------------------------------------------
// Snapshot terminal: PENUH (Langkah 1) + DELTA berkursor (Langkah 3,
// RENCANA-TAURI D7).
//
// Kursor adalah cap waktu server (ISO-8601, jam DATABASE — bukan jam
// klien) yang diterbitkan snapshot sebelumnya. Delta memakai penanda
// perubahan yang SUDAH ada di domain, tanpa tabel pelacak baru:
// - master produk (nama/harga/aktif/biaya): `products.updated_at` —
//   setiap penulis produk di domain membubuhkannya secara eksplisit;
// - kemasan produk (S5): `product_packagings.updated_at` menandai
//   produk induknya; blok kemasan produk berubah dikirim ulang utuh;
// - stok: `stock_on_hand.updated_at` untuk gudang snapshot —
//   dibubuhkan setiap gerakan stok oleh domain persediaan;
// - hapus keras produk: baris `audit_log` beraksi `product.delete`
//   (produk terpakai tidak bisa dihapus keras — domain mewajibkan
//   nonaktif, yang tertangkap penanda pertama sebagai tombstone).
// Metode pembayaran & gudang SELALU dikirim utuh juga di delta:
// tabel `payment_methods` tidak punya `updated_at` dan kedua daftar
// itu kecil — menggantinya utuh di klien selalu benar.
//
// Jendela perubahan diberi tumpang-tindih (overlap) beberapa detik:
// `updated_at` dibubuhkan jam aplikasi di dalam transaksi yang bisa
// saja baru commit sesudah snapshot sebelumnya selesai dibaca.
// Pengiriman ulang akibat tumpang-tindih tidak berbahaya — klien
// menerapkan delta sebagai upsert idempoten. Kursor tidak valid,
// lebih tua dari batas usia, atau terlalu jauh di masa depan →
// snapshot PENUH eksplisit (mode: "full"), bukan delta tebakan.
// ---------------------------------------------------------------------------

/**
 * Blok kemasan per produk (Program Satuan Kemasan S5): cermin baris
 * `product_packagings` yang relevan untuk terminal — faktor `isi`
 * langsung ke satuan dasar (string numeric), harga jual PER KEMASAN
 * (independen dari harga pcs; null = belum diatur, terminal memakai
 * harga satuan dasar), barcode kemasan untuk resolusi pindai lokal,
 * dan bendera aktif/bawaan jual. Kemasan nonaktif TETAP dikirim
 * (bertanda `isActive: false`) agar terminal tahu ia terarsip —
 * tidak ditawarkan untuk transaksi baru, tetap dikenal untuk
 * histori. Produk tanpa kemasan membawa array kosong.
 */
export type PosSnapshotPackaging = {
  id: string;
  name: string;
  isi: string;
  salePrice: string | null;
  barcode: string | null;
  isActive: boolean;
  isDefaultSale: boolean;
};

export type PosSnapshotProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  salePrice: string;
  stock: number;
  trackStock: boolean;
  trackSerial: boolean;
  isTaxExempt?: boolean;
  unitCode: string | null;
  packagings: PosSnapshotPackaging[];
};

function toSnapshotPackagings(
  rows: PackagingSnapshot[] | undefined,
): PosSnapshotPackaging[] {
  return (rows ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isi: row.isi,
    salePrice: row.salePrice,
    barcode: row.barcode,
    isActive: row.isActive,
    isDefaultSale: row.isDefaultSale,
  }));
}

/**
 * Blok cetak terminal (Langkah 5, RENCANA-TAURI D6): identitas toko
 * + pengaturan struk untuk pembangkit byte ESC/POS di Rust. SUMBER
 * TUNGGAL — baris `company_settings` yang sama dengan halaman nota
 * web, dipetakan lewat `toPrintSettings` yang sama (kop, kaki, saklar
 * elemen nota, kertas nota) ditambah tarif PPN efektif mentah
 * (saklar + tarif; klien menerapkan aturan `taxEnabled ? rate : 0`
 * yang sama seperti quote POS). Blok ini kecil dan selalu dikirim
 * utuh pada snapshot penuh MAUPUN delta — tidak ada sumber kedua.
 */
type PosSnapshotEnvelope = {
  version: string;
  /** Kursor untuk permintaan snapshot berikutnya. */
  cursor: string;
  generatedAt: string;
  companyId: string;
  warehouse: { id: string; code: string; name: string } | null;
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
  /** Reservasi stok aktif gudang terminal — bisa dipilih saat checkout. */
  reservations: PosSnapshotReservation[];
  /** Antrian dapur dari penjualan terbaru (kitchen display). */
  kitchenTickets: KitchenTicket[];
  /** Promosi aktif yang bisa diterapkan kasir sebagai diskon baris. */
  promotions: PosSnapshotPromotion[];
  /** Saldo poin loyalitas pelanggan (dari penjualan 1 tahun terakhir). */
  loyaltyBalances: PosSnapshotLoyaltyBalance[];
  paymentMethods: Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    feeEnabled: boolean;
    feeType: string;
    feeValue: string;
  }>;
  products: PosSnapshotProduct[];
  customerGroups: PosSnapshotCustomerGroup[];
  groupPrices: PosSnapshotGroupPrice[];
  /** Kelompok yang harga produknya diganti utuh pada delta ini. */
  replaceGroupPriceGroupIds: string[];
  receipt: PosSnapshotReceipt;
  terminal: PosSnapshotTerminal;
  names: PosSnapshotNames;
  canDiscount: boolean;
  /** Saklar perusahaan; terminal desktop wajib tahu bahwa penjualan outbox diizinkan. */
  posOfflineEnabled: boolean;
};

export type PosDeviceSnapshot = PosSnapshotEnvelope & { mode: "full" };

export type PosDeviceDeltaSnapshot = PosSnapshotEnvelope & {
  mode: "delta";
  /** Kursor yang dikirim klien untuk delta ini (gema, untuk audit). */
  baseCursor: string;
  /** Id produk yang harus dibuang klien dari katalog lokalnya:
   *  dinonaktifkan atau dihapus keras sejak kursor dasar. */
  removedProductIds: string[];
};

export type PosDeviceSnapshotResponse = PosDeviceSnapshot | PosDeviceDeltaSnapshot;

const SNAPSHOT_PAGE = 500;
/** Usia maksimum kursor yang masih dilayani sebagai delta. */
const SNAPSHOT_CURSOR_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Tumpang-tindih jendela perubahan delta (lihat komentar di atas). */
const SNAPSHOT_CURSOR_OVERLAP_MS = 10_000;
/** Kursor lebih jauh dari ini di masa depan dianggap rusak. */
const SNAPSHOT_CURSOR_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Jam server dari DATABASE — satu-satunya jam yang boleh menjadi
 *  kursor (jam aplikasi & jam klien tidak pernah diterbitkan). */
async function serverNow(tx: Tx): Promise<Date> {
  const rows = await tx.execute(sql`select now() as now`);
  const raw = (rows as unknown as Array<{ now: unknown }>)[0]?.now;
  const parsed = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(parsed.getTime())) throw new Error("Jam server tidak terbaca.");
  return parsed;
}

/** Nilai kursor mentah → instant yang masih layak delta, else null
 *  (null berarti: layani snapshot penuh secara eksplisit). */
export function parseSnapshotCursor(raw: string | null | undefined, now: Date): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (now.getTime() - parsed.getTime() > SNAPSHOT_CURSOR_MAX_AGE_MS) return null;
  if (parsed.getTime() - now.getTime() > SNAPSHOT_CURSOR_FUTURE_SKEW_MS) return null;
  return parsed;
}

export async function getPosDeviceSnapshot(
  tx: Tx,
  device: PosDeviceIdentity,
  issuedAt?: Date,
): Promise<PosDeviceSnapshot> {
  const companyId = device.companyId;
  const refs = await readSnapshotRefs(tx, companyId, device);
  const replaceGroupPriceGroupIds = refs.customerGroups.map((group) => group.id);
  const groupPrices = await readGroupPrices(tx, companyId, replaceGroupPriceGroupIds);
  const products: PosSnapshotProduct[] = [];
  if (refs.warehouseId) {
    for (let offset = 0; offset < POS_DEVICE_SNAPSHOT_MAX_PRODUCTS; offset += SNAPSHOT_PAGE) {
      const rows = await searchProducts(tx, {
        companyId,
        warehouseId: refs.warehouseId,
        q: "",
        limit: SNAPSHOT_PAGE,
        offset,
      });
      const packMap = await listPackagingsForProducts(
        tx,
        companyId,
        rows.map((row) => row.id),
      );
      for (const row of rows) {
        products.push({
          id: row.id,
          sku: row.sku,
          barcode: row.barcode,
          name: row.name,
          categoryId: row.categoryId ?? null,
          categoryName: row.categoryName ?? null,
          salePrice: String(row.salePrice),
          stock: Number(row.stock),
          trackStock: row.trackStock,
          trackSerial: row.trackSerial,
          isTaxExempt: row.isTaxExempt,
          unitCode: row.unitCode,
          packagings: toSnapshotPackagings(packMap.get(row.id)),
        });
      }
      if (rows.length < SNAPSHOT_PAGE) break;
    }
    if (products.length >= POS_DEVICE_SNAPSHOT_MAX_PRODUCTS) {
      const beyondLimit = await searchProducts(tx, {
        companyId,
        warehouseId: refs.warehouseId,
        q: "",
        limit: 1,
        offset: POS_DEVICE_SNAPSHOT_MAX_PRODUCTS,
      });
      assertPosDeviceSnapshotComplete(products.length, beyondLimit.length > 0);
    }
  }

  const generatedAt = (issuedAt ?? (await serverNow(tx))).toISOString();
  return {
    mode: "full",
    version: `${generatedAt}:${products.length}`,
    cursor: generatedAt,
    generatedAt,
    companyId,
    warehouse: refs.warehouse,
    warehouses: refs.warehouses,
    reservations: refs.reservations,
    kitchenTickets: refs.kitchenTickets,
    promotions: refs.promotions,
    loyaltyBalances: refs.loyaltyBalances,
    paymentMethods: refs.paymentMethods,
    products,
    customerGroups: refs.customerGroups,
    groupPrices,
    replaceGroupPriceGroupIds,
    receipt: refs.receipt,
    terminal: refs.terminal,
    names: refs.names,
    canDiscount: refs.canDiscount,
    posOfflineEnabled: refs.posOfflineEnabled,
  };
}

/** Baris produk snapshot untuk sekumpulan id EKSPLISIT — termasuk
 *  yang nonaktif (delta harus bisa membedakan "berubah" dari
 *  "hilang"), dengan proyeksi stok yang sama seperti searchProducts. */
async function fetchSnapshotProductRows(
  tx: Tx,
  companyId: string,
  warehouseId: string,
  ids: string[],
): Promise<Array<PosSnapshotProduct & { isActive: boolean }>> {
  if (ids.length === 0) return [];
  const stockSql = sql<string>`coalesce((
    select soh.qty from stock_on_hand soh
    where soh.company_id = ${products.companyId}
      and soh.product_id = ${products.id}
      and soh.warehouse_id = ${warehouseId}
  ), 0)`;
  const rows = await tx
    .select({
      id: products.id,
      sku: products.sku,
      barcode: products.barcode,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      salePrice: products.salePrice,
      trackStock: products.trackStock,
      trackSerial: products.trackSerial,
      isTaxExempt: products.isTaxExempt,
      isActive: products.isActive,
      unitCode: units.code,
      stock: stockSql,
    })
    .from(products)
    .leftJoin(units, eq(products.unitId, units.id))
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.companyId, companyId), inArray(products.id, ids)));
  const packMap = await listPackagingsForProducts(tx, companyId, ids);
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
    categoryId: row.categoryId ?? null,
    categoryName: row.categoryName ?? null,
    salePrice: String(row.salePrice),
    stock: Number(row.stock),
    trackStock: row.trackStock,
    trackSerial: row.trackSerial,
    isTaxExempt: row.isTaxExempt,
    unitCode: row.unitCode,
    packagings: toSnapshotPackagings(packMap.get(row.id)),
    isActive: row.isActive,
  }));
}

/**
 * Delta sejak `cursorAt`. Mengembalikan null bila himpunan perubahan
 * terlalu besar untuk disebut delta (bulk-edit massal) — pemanggil
 * melayani snapshot penuh sebagai gantinya.
 */
export async function getPosDeviceSnapshotDelta(
  tx: Tx,
  device: PosDeviceIdentity,
  cursorAt: Date,
  issuedAt: Date,
): Promise<PosDeviceDeltaSnapshot | null> {
  const companyId = device.companyId;
  const refs = await readSnapshotRefs(tx, companyId, device);
  const since = new Date(cursorAt.getTime() - SNAPSHOT_CURSOR_OVERLAP_MS);

  const changedGroupRows = await tx
    .select({ id: customerGroups.id })
    .from(customerGroups)
    .where(
      and(
        eq(customerGroups.companyId, companyId),
        eq(customerGroups.isActive, true),
        gt(customerGroups.updatedAt, since),
      ),
    );
  const replaceGroupPriceGroupIds = changedGroupRows.map((group) => group.id);
  const groupPrices = await readGroupPrices(tx, companyId, replaceGroupPriceGroupIds);

  const [masterChanged, stockChanged, hardDeleted, packagingChanged] = await Promise.all([
    tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.companyId, companyId), gt(products.updatedAt, since)))
      .limit(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS + 1),
    refs.warehouseId
      ? tx
          .select({ productId: stockOnHand.productId })
          .from(stockOnHand)
          .where(
            and(
              eq(stockOnHand.companyId, companyId),
              eq(stockOnHand.warehouseId, refs.warehouseId),
              gt(stockOnHand.updatedAt, since),
            ),
          )
          .limit(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS + 1)
      : Promise.resolve([] as Array<{ productId: string }>),
    tx
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.companyId, companyId),
          eq(auditLog.entityType, "product"),
          eq(auditLog.action, "product.delete"),
          gt(auditLog.createdAt, since),
        ),
      )
      .limit(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS + 1),
    tx
      .select({ productId: productPackagings.productId })
      .from(productPackagings)
      .where(
        and(
          eq(productPackagings.companyId, companyId),
          gt(productPackagings.updatedAt, since),
        ),
      )
      .limit(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS + 1),
  ]);

  const changedIds = new Set<string>();
  for (const row of masterChanged) changedIds.add(row.id);
  for (const row of stockChanged) changedIds.add(row.productId);
  for (const row of packagingChanged) changedIds.add(row.productId);
  if (changedIds.size > POS_DEVICE_SNAPSHOT_MAX_PRODUCTS) return null;

  const rows = await fetchSnapshotProductRows(tx, companyId, refs.warehouseId, [
    ...changedIds,
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const removedProductIds = new Set<string>();
  const changedProducts: PosSnapshotProduct[] = [];
  for (const id of changedIds) {
    const row = byId.get(id);
    if (!row || !row.isActive) {
      removedProductIds.add(id);
      continue;
    }
    const { isActive: _isActive, ...product } = row;
    void _isActive;
    changedProducts.push(product);
  }
  for (const row of hardDeleted) {
    if (row.entityId) removedProductIds.add(row.entityId);
  }

  const generatedAt = issuedAt.toISOString();
  return {
    mode: "delta",
    version: generatedAt,
    cursor: generatedAt,
    baseCursor: cursorAt.toISOString(),
    generatedAt,
    companyId,
    warehouse: refs.warehouse,
    warehouses: refs.warehouses,
    reservations: refs.reservations,
    kitchenTickets: refs.kitchenTickets,
    promotions: refs.promotions,
    loyaltyBalances: refs.loyaltyBalances,
    paymentMethods: refs.paymentMethods,
    products: changedProducts,
    customerGroups: refs.customerGroups,
    groupPrices,
    replaceGroupPriceGroupIds,
    removedProductIds: [...removedProductIds],
    receipt: refs.receipt,
    terminal: refs.terminal,
    names: refs.names,
    canDiscount: refs.canDiscount,
    posOfflineEnabled: refs.posOfflineEnabled,
  };
}

/**
 * Baca snapshot terminal. Tanpa kursor (atau kursor tidak layak)
 * hasilnya snapshot PENUH; dengan kursor layak hasilnya delta —
 * kecuali himpunan perubahannya terlalu besar, yang juga jatuh ke
 * penuh. Kursor pada respons selalu cap waktu server saat pembacaan
 * DIMULAI, sehingga perubahan yang commit selama pembacaan tetap
 * tertangkap delta berikutnya (ditambah tumpang-tindih di atas).
 */
export async function readPosDeviceSnapshot(
  device: PosDeviceIdentity,
  rawCursor?: string | null,
): Promise<PosDeviceSnapshotResponse> {
  return withCompanyReadOnly(device.companyId, async (tx) => {
    const issuedAt = await serverNow(tx);
    const cursorAt = parseSnapshotCursor(rawCursor, issuedAt);
    if (cursorAt) {
      const delta = await getPosDeviceSnapshotDelta(tx, device, cursorAt, issuedAt);
      if (delta) return delta;
    }
    return getPosDeviceSnapshot(tx, device, issuedAt);
  });
}
