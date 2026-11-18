import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  auditLog,
  categories,
  customers,
  customerGroupPrices,
  customerGroups,
  member,
  organization,
  posPromotions,
  productPackagings,
  products,
  saleLines,
  sales,
  stockOnHand,
  stockReservations,
  units,
  user,
} from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { toPrintSettings } from "@/components/print/types";
import {
  getSettings,
  listPackagingsForProducts,
  listPaymentMethods,
  listWarehouses,
  pickDefaultWarehouseId,
  searchProducts,
} from "@/server/catalog";
import type { PackagingSnapshot } from "@/lib/packaging";
import { buildLoyaltyBalances } from "@/lib/pos/loyalty";
import {
  buildKitchenTickets,
  type KitchenTicket,
  type KitchenTicketSource,
} from "@/lib/pos/kitchen-display";
import { resolveOriginEntitlement } from "@/server/member-permissions";
import { resolvePosTerminalByToken } from "@/server/pos";
import type { PosDeviceIdentity } from "./pos";

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
export type PosSnapshotReceipt = {
  companyName: string;
  address: string | null;
  phone: string | null;
  taxId: string | null;
  headerText: string | null;
  footerText: string | null;
  showCashier: boolean;
  showTax: boolean;
  showCustomer: boolean;
  showSession: boolean;
  showBranding: boolean;
  /** thermal58 | thermal80 | a5 | a4 — klien thermal memakai 58/80. */
  receiptPaper: string;
  taxEnabled: boolean;
  /** Tarif PPN persen sebagai string desimal (numeric perusahaan). */
  taxRate: string;
  /** Pembulatan perusahaan yang dipakai quote POS lokal maupun server. */
  roundingMode: string;
  /** Gambar QRIS statis (data URL PNG/JPEG/WebP) untuk layar bayar desktop. */
  qrisImage: string | null;
};

/**
 * Identitas terminal pada snapshot (Langkah 6): siapa terminal ini
 * menurut registry server — nama terminal, perusahaan, dan gudang
 * tempat ia menjual. Klien mencapnya ke sesi kas lokal & UI.
 */
export type PosSnapshotTerminal = {
  id: string;
  name: string;
  companyName: string;
  warehouse: { id: string; code: string; name: string } | null;
};

/**
 * Direktori nama (Langkah 6): id → nama untuk kasir (anggota
 * perusahaan) dan pelanggan aktif, agar struk lokal & UI desktop
 * menampilkan NAMA, bukan id mentah (menutup catatan Langkah 5).
 * Selalu dikirim utuh pada snapshot penuh maupun delta — daftarnya
 * kecil untuk skala minimarket dan mengganti utuh selalu benar.
 */
export type PosSnapshotNames = {
  cashiers: Array<{ id: string; name: string }>;
  customers: Array<{ id: string; name: string; groupId: string | null }>;
};

export type PosSnapshotCustomerGroup = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: string;
  roundCashTotal: boolean;
};

export type PosSnapshotGroupPrice = {
  groupId: string;
  productId: string;
  ruleType: string;
  value: string;
};

export type PosSnapshotLoyaltyBalance = { customerId: string; points: number };

export type PosSnapshotPromotion = {
  id: string;
  name: string;
  type: "percent" | "nominal";
  value: number;
  minSubtotal: number;
  productId: string | null;
};

export type PosSnapshotReservation = {
  id: string;
  number: string;
  productId: string;
  qty: string;
  expiresAt: string | null;
  reason: string | null;
};

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
const SNAPSHOT_MAX_PRODUCTS = 20_000;
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

type SnapshotRefs = {
  warehouse: { id: string; code: string; name: string } | null;
  warehouseId: string;
  warehouses: PosSnapshotEnvelope["warehouses"];
  reservations: PosSnapshotReservation[];
  kitchenTickets: KitchenTicket[];
  promotions: PosSnapshotPromotion[];
  loyaltyBalances: PosSnapshotLoyaltyBalance[];
  paymentMethods: PosSnapshotEnvelope["paymentMethods"];
  customerGroups: PosSnapshotEnvelope["customerGroups"];
  receipt: PosSnapshotReceipt;
  terminal: PosSnapshotTerminal;
  names: PosSnapshotNames;
  canDiscount: boolean;
  posOfflineEnabled: boolean;
};

/** Batas direktori pelanggan pada snapshot — jauh di atas skala
 *  minimarket; terminal hanya butuh id → nama untuk struk. */
const SNAPSHOT_CUSTOMER_LIMIT = 5000;

async function readSnapshotRefs(
  tx: Tx,
  companyId: string,
  device: PosDeviceIdentity,
): Promise<SnapshotRefs> {
  const [settings, warehouses, methods, org, cashierRows, customerRows, groupRows, entitlement] =
    await Promise.all([
      getSettings(tx, companyId),
      listWarehouses(tx, companyId),
      listPaymentMethods(tx, companyId),
      tx
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, companyId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      tx
        .select({ id: member.userId, name: user.name })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, companyId)),
      tx
        .select({ id: customers.id, name: customers.name, groupId: customers.groupId })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), eq(customers.isActive, true)))
        .orderBy(customers.name)
        .limit(SNAPSHOT_CUSTOMER_LIMIT),
      tx
        .select({
          id: customerGroups.id,
          name: customerGroups.name,
          roundingStep: customerGroups.roundingStep,
          roundingDirection: customerGroups.roundingDirection,
          roundCashTotal: customerGroups.roundCashTotal,
        })
        .from(customerGroups)
        .where(and(eq(customerGroups.companyId, companyId), eq(customerGroups.isActive, true)))
        .orderBy(customerGroups.name),
      resolveOriginEntitlement(companyId, device.userId),
    ]);
  // Gudang terminal dari registry menang atas gudang bawaan
  // perusahaan (Langkah 6): terminal menjual dari gudangnya.
  const warehouseId =
    device.warehouseId &&
    warehouses.some((w) => w.id === device.warehouseId)
      ? device.warehouseId
      : pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null;
  const now = new Date();
  const reservationRows = warehouseId
    ? await tx
        .select({
          id: stockReservations.id,
          number: stockReservations.number,
          productId: stockReservations.productId,
          qty: stockReservations.qty,
          expiresAt: stockReservations.expiresAt,
          reason: stockReservations.reason,
        })
        .from(stockReservations)
        .where(
          and(
            eq(stockReservations.companyId, companyId),
            eq(stockReservations.warehouseId, warehouseId),
            eq(stockReservations.status, "active"),
            or(isNull(stockReservations.expiresAt), gt(stockReservations.expiresAt, now)),
          ),
        )
        .orderBy(stockReservations.number)
        .limit(500)
    : [];
  const reservations: PosSnapshotReservation[] = reservationRows.map((row) => ({
    id: row.id,
    number: row.number,
    productId: row.productId,
    qty: String(row.qty),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    reason: row.reason,
  }));
  const sinceKitchen = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const kitchenSales = await tx
    .select({
      id: sales.id,
      number: sales.number,
      createdAt: sales.createdAt,
      productName: saleLines.productName,
      qty: saleLines.qty,
    })
    .from(sales)
    .innerJoin(saleLines, and(eq(saleLines.companyId, companyId), eq(saleLines.saleId, sales.id)))
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, sinceKitchen),
      ),
    )
    .orderBy(desc(sales.createdAt))
    .limit(200);
  const kitchenBySale = new Map<string, KitchenTicketSource>();
  for (const row of kitchenSales) {
    const source = kitchenBySale.get(row.id) ?? {
      id: row.id,
      number: row.number,
      createdAt: row.createdAt,
      lines: [],
    };
    source.lines.push({ productName: row.productName, qty: row.qty });
    kitchenBySale.set(row.id, source);
  }
  const kitchenTickets = buildKitchenTickets([...kitchenBySale.values()]).slice(0, 50);
  const promotionRows = await tx
    .select({
      id: posPromotions.id,
      name: posPromotions.name,
      type: posPromotions.type,
      value: posPromotions.value,
      minSubtotal: posPromotions.minSubtotal,
      productId: posPromotions.productId,
    })
    .from(posPromotions)
    .where(and(eq(posPromotions.companyId, companyId), eq(posPromotions.active, true)))
    .orderBy(posPromotions.name)
    .limit(200);
  const promotions: PosSnapshotPromotion[] = promotionRows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type === "nominal" ? "nominal" : "percent",
    value: Number(row.value),
    minSubtotal: Number(row.minSubtotal),
    productId: row.productId,
  }));
  const sinceLoyalty = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const loyaltySales = await tx
    .select({ customerId: sales.customerId, total: sales.total })
    .from(sales)
    .where(
      and(
        eq(sales.companyId, companyId),
        eq(sales.status, "completed"),
        gte(sales.createdAt, sinceLoyalty),
      ),
    )
    .limit(20_000);
  const loyaltyBalances: PosSnapshotLoyaltyBalance[] = [
    ...buildLoyaltyBalances(loyaltySales).entries(),
  ].map(([customerId, points]) => ({ customerId, points }));
  // Blok cetak dari baris pengaturan yang sama (lihat
  // PosSnapshotReceipt): nama tampilan struk mengikuti halaman nota
  // web — legalName perusahaan, jatuh ke nama bawaan yang sama.
  const print = toPrintSettings(settings, "nota");
  return {
    warehouse: warehouse
      ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
      : null,
    warehouseId,
    warehouses: warehouses.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      isDefault: w.isDefault,
    })),
    reservations,
    kitchenTickets,
    promotions,
    loyaltyBalances,
    paymentMethods: methods.map((m) => ({
      id: m.id,
      code: m.code,
      name: m.name,
      type: m.type,
      feeEnabled: m.feeEnabled,
      feeType: m.feeType,
      feeValue: String(m.feeValue),
    })),
    customerGroups: groupRows,
    receipt: {
      companyName: settings?.legalName || "Bisa Minimarket",
      address: settings?.address ?? null,
      phone: settings?.phone ?? null,
      taxId: settings?.taxId ?? null,
      headerText: print.headerText,
      footerText: print.footerText,
      showCashier: print.showCashier,
      showTax: print.showTax,
      showCustomer: print.showCustomer,
      showSession: print.showSession,
      showBranding: print.showBranding,
      receiptPaper: print.receiptPaper,
      taxEnabled: settings?.taxEnabled ?? true,
      taxRate: String(settings?.taxRate ?? "0"),
      roundingMode: settings?.roundingMode ?? "none",
      qrisImage: settings?.qrisImage ?? null,
    },
    terminal: {
      id: device.terminalId,
      name: device.terminalName,
      companyName: settings?.legalName || org?.name || "Bisa Minimarket",
      warehouse: warehouse
        ? { id: warehouse.id, code: warehouse.code, name: warehouse.name }
        : null,
    },
    names: {
      cashiers: cashierRows.map((row) => ({ id: row.id, name: row.name })),
      customers: customerRows.map((row) => ({ id: row.id, name: row.name, groupId: row.groupId })),
    },
    canDiscount: entitlement?.canDiscount ?? false,
    posOfflineEnabled: settings?.posOfflineEnabled ?? false,
  };
}

async function readGroupPrices(
  tx: Tx,
  companyId: string,
  groupIds: string[],
): Promise<PosSnapshotGroupPrice[]> {
  if (groupIds.length === 0) return [];
  const rows = await tx
    .select({
      groupId: customerGroupPrices.groupId,
      productId: customerGroupPrices.productId,
      ruleType: customerGroupPrices.ruleType,
      value: customerGroupPrices.value,
    })
    .from(customerGroupPrices)
    .where(and(eq(customerGroupPrices.companyId, companyId), inArray(customerGroupPrices.groupId, groupIds)));
  return rows.map((row) => ({ ...row, value: String(row.value) }));
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
    for (let offset = 0; offset < SNAPSHOT_MAX_PRODUCTS; offset += SNAPSHOT_PAGE) {
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
          unitCode: row.unitCode,
          packagings: toSnapshotPackagings(packMap.get(row.id)),
        });
      }
      if (rows.length < SNAPSHOT_PAGE) break;
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
      .where(and(eq(products.companyId, companyId), gt(products.updatedAt, since))),
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
      ),
    // S5: perubahan kemasan (buat/ubah isi/harga/barcode pada
    // `product_packagings.updated_at`) menandai produk induknya
    // berubah — blok kemasan produk itu dikirim ulang utuh di
    // delta. Nonaktif adalah UPDATE (tertangkap di sini); hapus
    // fisik & semua suntingan kemasan lain berjalan di dalam
    // simpan produk yang membubuhkan `products.updated_at` pada
    // transaksi yang sama (tertangkap penanda master di atas).
    tx
      .select({ productId: productPackagings.productId })
      .from(productPackagings)
      .where(
        and(
          eq(productPackagings.companyId, companyId),
          gt(productPackagings.updatedAt, since),
        ),
      ),
  ]);

  const changedIds = new Set<string>();
  for (const row of masterChanged) changedIds.add(row.id);
  for (const row of stockChanged) changedIds.add(row.productId);
  for (const row of packagingChanged) changedIds.add(row.productId);
  if (changedIds.size > SNAPSHOT_MAX_PRODUCTS) return null;

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
