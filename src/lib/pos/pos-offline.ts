/**
 * SIM-2 S7B-2 Batch 6 — Antrean offline POS (§12).
 *
 * Lapisan antrean tipis di atas IndexedDB API langsung (tanpa
 * dependensi baru): logika antrean (enqueue/list/update/remove +
 * penerapan hasil sinkronisasi) ditulis murni di atas antarmuka
 * `OfflineQueueStorage` agar dapat diuji unit dengan adapter memori.
 *
 * Setiap penjualan antre membawa `clientKey` — kunci idempotensi yang
 * digenerate di klien dan dipakai server sebagai idempotency key jalur
 * checkout normal, sehingga pengiriman ulang tidak pernah menggandakan
 * penjualan.
 */

export type OfflineSaleLine = {
  productId: string;
  qty: number;
  discountType?: "percent" | "nominal" | null;
  discountValue?: number;
  serialNumbers?: string[];
  /**
   * FIX-POS Tahap 2 (POS3-04): snapshot harga satuan yang benar-benar
   * dibebankan ke pelanggan saat transaksi offline (harga kelompok
   * saat antre, sebelum diskon manual baris). Dipakai penyelesaian
   * peninjauan untuk memposting pada harga struk offline.
   * S4: untuk baris berkemasan, snapshot ini adalah harga PER
   * KEMASAN yang dibebankan (yang tercetak di struk offline).
   */
  unitPrice?: number;
  /**
   * Program Satuan Kemasan S4: baris berkemasan — `qty` adalah qty
   * INPUT dalam kemasan itu dan `isiSnapshot` faktor cuplikannya
   * saat transaksi; server mengonversi dengan cuplikan ini, bukan
   * master saat sinkron. Absen/null = baris satuan dasar (muatan
   * warisan tetap sah persis seperti sebelumnya).
   */
  packagingId?: string | null;
  isiSnapshot?: number;
};

export type OfflineSalePayment = {
  methodId: string;
  amount: number;
  tendered: number;
  reference?: string;
  /** A-21 Tahap R3-A (R3-01): fee final dari panel; muatan lama tanpa kolom ini memakai bawaan konfigurasi saat sinkron. */
  fee?: number;
};

export type OfflineSalePayload = {
  clientKey: string;
  warehouseId: string;
  groupId?: string | null;
  customerId?: string | null;
  dueDate?: string | null;
  date: string;
  lines: OfflineSaleLine[];
  payments: OfflineSalePayment[];
  queuedAt: string;
  /**
   * FIX-POS Tahap 2 (POS3-02): identitas ASAL transaksi — kasir yang
   * melayani saat offline, sesi kasnya saat itu, dan penanda
   * perangkat. Sinkronisasi memposting atas nama asal ini, BUKAN atas
   * nama siapa pun yang kebetulan menyinkronkan. Payload warisan
   * (antrean lama) tidak membawa ketiganya: asal dianggap penyinkron.
   */
  cashierId?: string;
  originSessionId?: string | null;
  deviceId?: string;
  /**
   * FIX-POS Tahap 2 (POS3-04): total struk offline — total yang
   * ditagihkan & dibayar pelanggan saat transaksi terjadi. Saat
   * sinkron, kutipan ulang server dibandingkan dengan angka ini;
   * selisih berarti harga berubah dan item masuk peninjauan, tidak
   * diposting senyap. Payload warisan tanpa field ini dinilai dari
   * jumlah pembayaran (snapshot tersirat).
   */
  expectedTotal?: number;
};

export type OfflineSyncStatus = "synced" | "duplicate" | "conflict" | "failed";

/**
 * FIX-POS Tahap 2: klasifikasi alasan item masuk peninjauan, agar
 * halaman peninjauan dapat membedakan konflik stok dari harga berubah,
 * sesi asal tertutup, dan kasir asal yang tidak lagi berhak — bukan
 * satu tumpukan "gagal" yang sama.
 */
export type OfflineReviewKind =
  | "stock"
  | "price"
  | "session"
  | "session_closed"
  | "origin_ineligible"
  | "period"
  | "other";

export type QueuedSale = OfflineSalePayload & {
  /** Terisi sesudah percobaan sinkronisasi yang belum tuntas (conflict/failed). */
  lastStatus?: Extract<OfflineSyncStatus, "conflict" | "failed">;
  lastMessage?: string;
  lastAttemptAt?: string;
};

export interface OfflineQueueStorage {
  add(item: QueuedSale): Promise<void>;
  put(item: QueuedSale): Promise<void>;
  list(): Promise<QueuedSale[]>;
  remove(clientKey: string): Promise<void>;
}

/** Adapter memori — untuk unit test dan pemanggilan server-side saja. */
export class MemoryOfflineStorage implements OfflineQueueStorage {
  private items = new Map<string, QueuedSale>();

  async add(item: QueuedSale): Promise<void> {
    if (!this.items.has(item.clientKey)) this.items.set(item.clientKey, item);
  }

  async put(item: QueuedSale): Promise<void> {
    this.items.set(item.clientKey, item);
  }

  async list(): Promise<QueuedSale[]> {
    return [...this.items.values()].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async remove(clientKey: string): Promise<void> {
    this.items.delete(clientKey);
  }
}

const DB_NAME = "bisa-pos-offline";
const STORE_NAME = "sales";

/** Adapter IndexedDB langsung (browser). Satu store, keyPath clientKey. */
export class IndexedDbOfflineStorage implements OfflineQueueStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore(STORE_NAME, { keyPath: "clientKey" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    return this.dbPromise;
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      let request: IDBRequest<T>;
      try {
        request = fn(transaction.objectStore(STORE_NAME));
      } catch (error) {
        reject(error);
        return;
      }

      let result: T;
      // Request success alone is not a commit guarantee: a later storage
      // or transaction error can still abort the operation. Resolve only
      // after the IndexedDB transaction itself commits.
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Permintaan IndexedDB gagal."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(
          transaction.error ?? request.error ?? new Error("Transaksi IndexedDB dibatalkan."),
        );
      transaction.onerror = () =>
        reject(transaction.error ?? request.error ?? new Error("Transaksi IndexedDB gagal."));
    });
  }

  async add(item: QueuedSale): Promise<void> {
    await this.run("readwrite", (store) => store.add(item));
  }

  async put(item: QueuedSale): Promise<void> {
    await this.run("readwrite", (store) => store.put(item));
  }

  async list(): Promise<QueuedSale[]> {
    const rows = await this.run("readonly", (store) => store.getAll());
    return (rows as QueuedSale[]).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
  }

  async remove(clientKey: string): Promise<void> {
    await this.run("readwrite", (store) => store.delete(clientKey));
  }
}

let browserStorage: OfflineQueueStorage | null = null;

/** Penyimpanan antrean browser harus persisten agar checkout offline tidak hilang saat halaman ditutup. */
export function getBrowserOfflineStorage(): OfflineQueueStorage {
  if (typeof window !== "undefined" && typeof indexedDB === "undefined") {
    throw new Error("Penyimpanan antrean offline tidak tersedia: browser ini tidak menyediakan IndexedDB.");
  }
  if (!browserStorage) {
    browserStorage =
      typeof indexedDB !== "undefined" ? new IndexedDbOfflineStorage() : new MemoryOfflineStorage();
  }
  return browserStorage;
}

/** Masukkan penjualan ke antrean. clientKey yang sama tidak digandakan. */
export async function enqueueOfflineSale(
  storage: OfflineQueueStorage,
  payload: OfflineSalePayload,
): Promise<{ queued: QueuedSale; duplicate: boolean }> {
  const existing = (await storage.list()).find((item) => item.clientKey === payload.clientKey);
  if (existing) return { queued: existing, duplicate: true };
  const queued: QueuedSale = { ...payload };
  await storage.add(queued);
  return { queued, duplicate: false };
}

export type OfflineSyncItemResult = {
  clientKey: string;
  status: OfflineSyncStatus;
  saleId?: string;
  saleNumber?: string;
  message?: string;
  /** Alasan peninjauan untuk status conflict/failed (POS3-02/03/04). */
  kind?: OfflineReviewKind;
};

/**
 * Terapkan hasil sinkronisasi server ke antrean lokal: synced &
 * duplicate dikeluarkan; conflict & failed tetap antre dengan pesan
 * terakhirnya agar kasir/manager dapat meninjau.
 */
export async function applySyncResults(
  storage: OfflineQueueStorage,
  results: OfflineSyncItemResult[],
  now = new Date(),
): Promise<{ removed: string[]; kept: string[] }> {
  const removed: string[] = [];
  const kept: string[] = [];
  for (const result of results) {
    if (result.status === "synced" || result.status === "duplicate") {
      await storage.remove(result.clientKey);
      removed.push(result.clientKey);
      continue;
    }
    const existing = (await storage.list()).find((item) => item.clientKey === result.clientKey);
    if (existing) {
      await storage.put({
        ...existing,
        lastStatus: result.status,
        lastMessage: result.message,
        lastAttemptAt: now.toISOString(),
      });
    }
    kept.push(result.clientKey);
  }
  return { removed, kept };
}

export async function countQueued(storage: OfflineQueueStorage): Promise<number> {
  return (await storage.list()).length;
}

/** Ringkasan backlog lokal untuk indikator kasir tanpa membaca antrean dua kali. */
export async function getOfflineQueueSummary(
  storage: OfflineQueueStorage,
): Promise<{ count: number; oldestQueuedAt: string | null }> {
  const items = await storage.list();
  return { count: items.length, oldestQueuedAt: items[0]?.queuedAt ?? null };
}

/**
 * A-24 T6 (temuan T6-01) — Quote LOKAL untuk mode offline.
 *
 * Quote server (`src/server/pos/quote.ts`) adalah satu-satunya otoritas
 * harga; tetapi tombol Bayar terminal digerbangi quote server, sehingga
 * tanpa jembatan ini antrean offline tidak pernah terjangkau untuk
 * keranjang yang dibangun/diubah saat server tak terjangkau (terbukti
 * di peramban: "Perhitungan gagal", Bayar nonaktif). Fungsi murni ini
 * mencerminkan aritmetika quote.ts untuk jalur non-beku dari data yang
 * memang sudah ada di terminal: harga master katalog lokal + diskon
 * manual baris + pajak inklusif + pembulatan tunai (kelompok/perusahaan)
 * — memakai primitif uang yang sama persis (`lib/money.ts`).
 *
 * Batas yang disengaja & aman:
 * - Aturan harga kelompok per produk TIDAK diketahui klien →
 *   groupUnitPrice = harga master. Bila ternyata berbeda, kontrak
 *   sinkronisasi membandingkannya dengan snapshot expectedTotal dan
 *   item masuk peninjauan konflik harga — tidak pernah diposting
 *   senyap pada harga yang salah.
 * - Stok per baris adalah snapshot katalog saat halaman termuat;
 *   server menilai ulang ketersediaan saat sinkronisasi.
 * - Penilaian ambang diskon supervisor (POS-DISC-01) tetap wewenang
 *   server dari hak kasir asal saat sinkronisasi;
 *   `manualDiscountOverride` lokal selalu null.
 */
import {
  D,
  d,
  lineDiscount,
  lineTax,
  roundTo,
  roundTotal,
  type DiscountType,
  type RoundDirection,
  type RoundingMode,
} from "@/lib/money";
import { pricePerBaseUnit, toBaseQty } from "@/lib/packaging";
import { newUuid } from "@/lib/uuid";

export type LocalQuoteCatalogEntry = {
  name: string;
  sku: string;
  salePrice: string | number;
  stock: number;
  trackStock: boolean;
  trackSerial: boolean;
  /**
   * S4: kemasan aktif produk dari katalog terminal (untuk quote
   * lokal baris berkemasan). Absen = produk tanpa kemasan.
   */
  packagings?: {
    id: string;
    name: string;
    isi: string | number;
    salePrice: string | number | null;
  }[];
};

export type LocalOfflineQuoteLine = {
  productId: string;
  qty: number;
  discountType?: DiscountType | null;
  discountValue?: number;
  serialNumbers?: string[];
  /** S4: baris berkemasan — qty adalah qty INPUT dalam kemasan ini. */
  packagingId?: string | null;
};

/** Bentuk hasil sejajar QuoteResultPublic server (tanpa unitCost). */
export type LocalOfflineQuote = {
  lines: Array<{
    productId: string;
    sku: string;
    name: string;
    /** S4: cermin QuoteLine server — qty di bawah adalah satuan dasar. */
    packagingId: string | null;
    packagingName: string | null;
    qtyInput: number;
    isiSnapshot: string;
    qty: number;
    unitPrice: number;
    groupUnitPrice: number;
    gross: number;
    discountType: DiscountType | null;
    discountValue: number;
    discountAmount: number;
    groupDiscountAmount: number;
    manualDiscountAmount: number;
    taxRate: number;
    taxAmount: number;
    lineTotal: number;
    stock: number;
    trackStock: boolean;
    trackBatch: boolean;
    trackSerial: boolean;
    serialNumbers: string[];
  }>;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  netSales: number;
  roundingAdjustment: number;
  total: number;
  roundingMode: string;
  cashRounding: { step: number; direction: RoundDirection } | null;
  discountAccountId: null;
  manualDiscountOverride: null;
};

function cashRoundingForMode(
  mode: RoundingMode,
): { step: number; direction: RoundDirection } | null {
  switch (mode) {
    case "nearest_100":
      return { step: 100, direction: "nearest" };
    case "nearest_500":
      return { step: 500, direction: "nearest" };
    case "nearest_1000":
      return { step: 1000, direction: "nearest" };
    case "up_500":
      return { step: 500, direction: "up" };
    case "up_1000":
      return { step: 1000, direction: "up" };
    default:
      return null;
  }
}

/**
 * Hitung quote dari katalog lokal. Mengembalikan null bila ada produk
 * yang tidak dikenal katalog (terminal tidak boleh mengarang harga).
 */
export function computeLocalOfflineQuote(input: {
  lines: LocalOfflineQuoteLine[];
  catalog: Record<string, LocalQuoteCatalogEntry>;
  group?: {
    roundingStep: number;
    roundingDirection: RoundDirection;
    roundCashTotal: boolean;
  } | null;
  /** Tarif pajak efektif perusahaan (0 bila saklar pajak mati). */
  taxRate: number;
  companyRoundingMode: RoundingMode | string;
}): LocalOfflineQuote | null {
  if (input.lines.length === 0) return null;
  const taxRate = d(input.taxRate);
  const lines: LocalOfflineQuote["lines"] = [];
  let subtotal = d(0);
  let discountTotal = d(0);
  let taxTotal = d(0);

  for (const line of input.lines) {
    const product = input.catalog[line.productId];
    if (!product) return null;
    // S4: baris berkemasan dikonversi dengan primitif yang sama
    // persis dengan quote server (toBaseQty & pricePerBaseUnit dari
    // lib/packaging) — qty menjadi satuan dasar, harga normal per
    // satuan dasar dari harga kemasan katalog lokal. Kemasan yang
    // tidak dikenal katalog lokal → null (terminal tidak mengarang).
    const pack = line.packagingId
      ? product.packagings?.find((row) => row.id === line.packagingId)
      : undefined;
    if (line.packagingId && !pack) return null;
    const qty = pack ? d(toBaseQty(line.qty, pack.isi)) : d(line.qty);
    const unitPrice = pack
      ? pack.salePrice != null
        ? d(pricePerBaseUnit(pack.salePrice, pack.isi))
        : d(product.salePrice)
      : d(product.salePrice);
    const gross = qty.mul(unitPrice);
    // Harga kelompok per produk tidak diketahui klien (lihat kepala
    // fungsi): groupUnitPrice = harga master, groupDiscount = 0.
    const groupUnitPrice = unitPrice;
    let manualDiscount = d(0);
    if (line.discountType && d(line.discountValue ?? 0).gt(0)) {
      manualDiscount = lineDiscount({
        qty,
        unitPrice: groupUnitPrice,
        type: line.discountType,
        value: line.discountValue,
      });
    }
    const discount = D.min(D.max(manualDiscount, 0), gross);
    const net = gross.minus(discount);
    const tax = lineTax({ net, rate: taxRate, inclusive: true });
    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(discount);
    taxTotal = taxTotal.plus(tax);
    lines.push({
      productId: line.productId,
      sku: product.sku,
      name: product.name,
      packagingId: pack?.id ?? null,
      packagingName: pack?.name ?? null,
      qtyInput: d(line.qty).toNumber(),
      isiSnapshot: pack ? String(pack.isi) : "1",
      qty: qty.toNumber(),
      unitPrice: unitPrice.toNumber(),
      groupUnitPrice: groupUnitPrice.toNumber(),
      gross: gross.toNumber(),
      discountType: line.discountType ?? null,
      discountValue: line.discountValue ?? 0,
      discountAmount: discount.toNumber(),
      groupDiscountAmount: 0,
      manualDiscountAmount: discount.toNumber(),
      taxRate: taxRate.toNumber(),
      taxAmount: tax.toNumber(),
      lineTotal: net.toNumber(),
      stock: product.trackStock ? product.stock : Number.MAX_SAFE_INTEGER,
      trackStock: product.trackStock,
      trackBatch: false,
      trackSerial: product.trackSerial,
      serialNumbers: line.serialNumbers ?? [],
    });
  }

  const group = input.group ?? null;
  const groupCashRounding =
    group && group.roundCashTotal && group.roundingStep > 0
      ? { step: group.roundingStep, direction: group.roundingDirection }
      : null;
  const companyMode = input.companyRoundingMode as RoundingMode;
  const cashRounding = groupCashRounding ?? cashRoundingForMode(companyMode);
  const preRounding = subtotal.minus(discountTotal);
  const rounded = groupCashRounding
    ? roundTo(preRounding, groupCashRounding.step, groupCashRounding.direction)
    : roundTotal(preRounding, companyMode).rounded;
  const adjustment = rounded.minus(preRounding);

  return {
    lines,
    subtotal: subtotal.toNumber(),
    discountTotal: discountTotal.toNumber(),
    taxTotal: taxTotal.toNumber(),
    netSales: subtotal.minus(discountTotal).minus(taxTotal).toNumber(),
    roundingAdjustment: adjustment.toNumber(),
    total: rounded.toNumber(),
    roundingMode: groupCashRounding
      ? `${groupCashRounding.direction}_${groupCashRounding.step}`
      : companyMode,
    cashRounding,
    discountAccountId: null,
    manualDiscountOverride: null,
  };
}

const DEVICE_ID_KEY = "bisa.pos.deviceId";

/**
 * FIX-POS Tahap 2 (POS3-02): penanda perangkat persisten per profil
 * browser — dibuat sekali, lalu dipakai semua item antrean dari
 * terminal ini sebagai bukti asal. Bukan identitas keamanan (dapat
 * dihapus bersama data browser); hanya penanda audit.
 */
export function getOrCreateDeviceId(): string {
  try {
    if (typeof localStorage === "undefined") return "unknown-device";
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = newUuid();
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return "unknown-device";
  }
}
