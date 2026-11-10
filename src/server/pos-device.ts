import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db";
import {
  auditLog,
  customers,
  member,
  organization,
  productPackagings,
  products,
  stockOnHand,
  units,
  user,
} from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { toPrintSettings } from "@/components/print/types";
import type { OfflineSalePayload, OfflineSyncItemResult } from "@/lib/pos-offline";
import {
  getSettings,
  listPackagingsForProducts,
  listPaymentMethods,
  listWarehouses,
  pickDefaultWarehouseId,
  searchProducts,
} from "@/server/catalog";
import type { PackagingSnapshot } from "@/lib/packaging";
import { resolveOriginEntitlement, type OriginEntitlement } from "@/server/member-permissions";
import { assertOfflineEnabled, processOfflineSaleItem } from "@/server/pos-offline";
import {
  recordTerminalSessionClose,
  resolvePosTerminalByToken,
  type TerminalSessionCloseIntent,
} from "@/server/pos";

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

export type PosDeviceIdentity = {
  companyId: string;
  userId: string;
  label: string | null;
  /** Terminal registry pemilik token (Langkah 6). */
  terminalId: string;
  terminalName: string;
  /** Gudang terminal dari registry; null = gudang bawaan perusahaan. */
  warehouseId: string | null;
};

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
// Skema muatan sinkronisasi — SATU definisi untuk aksi web & API perangkat.
// ---------------------------------------------------------------------------

export const posSyncItemSchema = z.object({
  clientKey: z.string().min(8).max(120),
  warehouseId: z.string().uuid(),
  groupId: z.string().uuid().nullish(),
  customerId: z.string().uuid().nullish(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // FIX-POS Tahap 2: identitas asal & snapshot struk (opsional agar
  // antrean dari klien lama tetap dapat dikirim).
  cashierId: z.string().min(1).max(128).nullish(),
  originSessionId: z.string().uuid().nullish(),
  deviceId: z.string().max(80).nullish(),
  expectedTotal: z.number().nonnegative().optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        qty: z.number().positive(),
        discountType: z.enum(["percent", "nominal"]).nullish(),
        discountValue: z.number().optional(),
        serialNumbers: z.array(z.string().min(1).max(80)).max(500).optional(),
        unitPrice: z.number().nonnegative().optional(),
        // Program Satuan Kemasan S4: baris berkemasan antrean web —
        // qty adalah qty INPUT kemasan, unitPrice snapshot adalah
        // harga PER KEMASAN, isiSnapshot faktor saat transaksi.
        // Opsional: muatan lama & perangkat desktop (S5) tanpa kolom
        // ini tetap sah sebagai baris satuan dasar.
        packagingId: z.string().uuid().nullish(),
        isiSnapshot: z.number().positive().optional(),
      }),
    )
    .min(1)
    .max(200),
  payments: z
    .array(
      z.object({
        methodId: z.string().uuid(),
        amount: z.number().nonnegative(),
        tendered: z.number().nonnegative(),
        reference: z.string().max(80).optional(),
        // A-21 Tahap R3-A (R3-01): fee final dari panel kasir asal.
        fee: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  queuedAt: z.string().max(40),
});

/**
 * Intent tutup sesi kas terminal (Langkah 6, menutup sisa Langkah
 * 4): FAKTA lokal yang dicatat server sebagai bahan peninjauan —
 * BUKAN sesi server. Terminal mengirimnya bersama drain outbox;
 * server mencatatnya idempoten per clientKey lewat
 * `recordTerminalSessionClose` (server/pos/terminals.ts) dan TIDAK
 * memposting jurnal/sesi kedua darinya.
 */
export const posSessionIntentSchema = z.object({
  clientKey: z.string().min(8).max(120),
  warehouseId: z.string().uuid(),
  cashierId: z.string().min(1).max(128).nullish(),
  localSessionId: z.string().min(1).max(120),
  openedAt: z.string().max(40).nullish(),
  closedAt: z.string().max(40),
  openingCash: z.number(),
  expectedCash: z.number(),
  countedCash: z.number(),
  difference: z.number(),
  denominations: z
    .array(
      z.object({
        denomination: z.string().max(24),
        count: z.number().int().nonnegative(),
      }),
    )
    .max(24)
    .nullish(),
  differenceReason: z.string().max(200).nullish(),
});

export const posSyncRequestSchema = z
  .object({
    items: z.array(posSyncItemSchema).max(50).default([]),
    sessionIntents: z.array(posSessionIntentSchema).max(50).optional(),
  })
  .refine(
    (body) => body.items.length > 0 || (body.sessionIntents?.length ?? 0) > 0,
    { message: "Tidak ada item maupun intent untuk disinkronkan." },
  );

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
  customers: Array<{ id: string; name: string }>;
};

type PosSnapshotEnvelope = {
  version: string;
  /** Kursor untuk permintaan snapshot berikutnya. */
  cursor: string;
  generatedAt: string;
  companyId: string;
  warehouse: { id: string; code: string; name: string } | null;
  warehouses: Array<{ id: string; code: string; name: string; isDefault: boolean }>;
  paymentMethods: Array<{ id: string; code: string; name: string; type: string }>;
  products: PosSnapshotProduct[];
  receipt: PosSnapshotReceipt;
  terminal: PosSnapshotTerminal;
  names: PosSnapshotNames;
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
  paymentMethods: PosSnapshotEnvelope["paymentMethods"];
  receipt: PosSnapshotReceipt;
  terminal: PosSnapshotTerminal;
  names: PosSnapshotNames;
};

/** Batas direktori pelanggan pada snapshot — jauh di atas skala
 *  minimarket; terminal hanya butuh id → nama untuk struk. */
const SNAPSHOT_CUSTOMER_LIMIT = 5000;

async function readSnapshotRefs(
  tx: Tx,
  companyId: string,
  device: PosDeviceIdentity,
): Promise<SnapshotRefs> {
  const [settings, warehouses, methods, org, cashierRows, customerRows] =
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
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.companyId, companyId), eq(customers.isActive, true)))
        .orderBy(customers.name)
        .limit(SNAPSHOT_CUSTOMER_LIMIT),
    ]);
  // Gudang terminal dari registry menang atas gudang bawaan
  // perusahaan (Langkah 6): terminal menjual dari gudangnya.
  const warehouseId =
    device.warehouseId &&
    warehouses.some((w) => w.id === device.warehouseId)
      ? device.warehouseId
      : pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId);
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? null;
  // Blok cetak dari baris pengaturan yang sama (lihat
  // PosSnapshotReceipt): nama tampilan struk mengikuti halaman nota
  // web — legalName perusahaan, jatuh ke nama bawaan yang sama.
  const print = toPrintSettings(settings);
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
    paymentMethods: methods.map((m) => ({ id: m.id, code: m.code, name: m.name, type: m.type })),
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
      customers: customerRows.map((row) => ({ id: row.id, name: row.name })),
    },
  };
}

export async function getPosDeviceSnapshot(
  tx: Tx,
  device: PosDeviceIdentity,
  issuedAt?: Date,
): Promise<PosDeviceSnapshot> {
  const companyId = device.companyId;
  const refs = await readSnapshotRefs(tx, companyId, device);
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
    paymentMethods: refs.paymentMethods,
    products,
    receipt: refs.receipt,
    terminal: refs.terminal,
    names: refs.names,
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
      salePrice: products.salePrice,
      trackStock: products.trackStock,
      trackSerial: products.trackSerial,
      isActive: products.isActive,
      unitCode: units.code,
      stock: stockSql,
    })
    .from(products)
    .leftJoin(units, eq(products.unitId, units.id))
    .where(and(eq(products.companyId, companyId), inArray(products.id, ids)));
  const packMap = await listPackagingsForProducts(tx, companyId, ids);
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    barcode: row.barcode,
    name: row.name,
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
    paymentMethods: refs.paymentMethods,
    products: changedProducts,
    removedProductIds: [...removedProductIds],
    receipt: refs.receipt,
    terminal: refs.terminal,
    names: refs.names,
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

// ---------------------------------------------------------------------------
// Sinkronisasi perangkat — orkestrasi yang sama dengan
// `syncOfflineSalesAction`: saklar offline dinilai, hak kasir asal
// diresolusi per item dari keanggotaan, dan setiap item diproses dalam
// transaksinya sendiri lewat domain `processOfflineSaleItem`.
// ---------------------------------------------------------------------------

async function resolveEntitlements(
  companyId: string,
  cashierIds: Array<string | null | undefined>,
): Promise<Record<string, OriginEntitlement | null>> {
  const unique = [...new Set(cashierIds.filter((id): id is string => Boolean(id)))];
  const result: Record<string, OriginEntitlement | null> = {};
  for (const cashierId of unique) {
    result[cashierId] = await resolveOriginEntitlement(companyId, cashierId);
  }
  return result;
}

export async function syncPosDeviceItems(
  device: PosDeviceIdentity,
  items: OfflineSalePayload[],
): Promise<OfflineSyncItemResult[]> {
  await withCompany(device.companyId, (tx) =>
    assertOfflineEnabled(tx, device.companyId),
  );
  const originEntitlements = await resolveEntitlements(
    device.companyId,
    items.map((item) => item.cashierId),
  );
  const actorEntitlement = await resolveOriginEntitlement(device.companyId, device.userId);
  const results: OfflineSyncItemResult[] = [];
  for (const item of items) {
    const result = await withCompany(device.companyId, (tx) =>
      processOfflineSaleItem(tx, {
        companyId: device.companyId,
        userId: device.userId,
        canDiscount: actorEntitlement?.canDiscount ?? false,
        originEntitlements,
        item,
      }),
    );
    results.push(result);
  }
  return results;
}

export type PosSessionIntentResult = {
  clientKey: string;
  status: "recorded" | "duplicate";
};

/**
 * Catat intent tutup sesi terminal sebagai bahan peninjauan
 * (Langkah 6). Setiap intent dicatat dalam transaksinya sendiri
 * lewat domain registry; idempotensi per clientKey membuat
 * pengiriman ulang aman. TIDAK ada jurnal/sesi server yang dibuat
 * di sini — lihat `posSessionIntentSchema`.
 */
export async function syncPosDeviceSessionIntents(
  device: PosDeviceIdentity,
  intents: TerminalSessionCloseIntent[],
): Promise<PosSessionIntentResult[]> {
  const results: PosSessionIntentResult[] = [];
  for (const intent of intents) {
    const status = await withCompany(device.companyId, (tx) =>
      recordTerminalSessionClose(tx, {
        companyId: device.companyId,
        terminalId: device.terminalId,
        intent,
      }),
    );
    results.push({ clientKey: intent.clientKey, status });
  }
  return results;
}
