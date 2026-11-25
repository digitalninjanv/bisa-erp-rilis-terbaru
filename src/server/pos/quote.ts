// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db";
import {
  customerGroups,
  customerGroupPrices,
  productPackagings,
  products,
  warehouses,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { pricePerBaseUnit, toBaseQty } from "@/lib/packaging";
import { resolveLinePackagings } from "@/server/catalog";
import {
  D,
  d,
  lineDiscount,
  lineTax,
  roundTo,
  roundTotal,
  toDb,
  type Decimal,
  type DiscountType,
  type RoundDirection,
  type RoundingMode,
} from "@/lib/money";
import { getBatchAvailability } from "@/server/batches";
import { getStock } from "@/server/inventory";
import { getConsumableReservation, getReservedQuantities } from "@/server/reservations";
import { normalizeSerialNumbers } from "@/server/serials";
import { todayISO } from "@/lib/format";

import { getCompanySettingsRow } from "@/server/settings";
export type CartLineInput = {
  productId: string;
  qty: string | number;
  unitPrice?: string | number;
  discountType?: DiscountType | null;
  discountValue?: string | number;
  /** SIM-2 S7B-2 Batch 5: seri yang dipilih untuk produk track_serial (satu per unit). */
  serialNumbers?: string[];
  /**
   * Program Satuan Kemasan S4: baris berkemasan — `qty` adalah qty
   * INPUT dalam kemasan itu ("1" = 1 Dus) dan harga yang berlaku
   * adalah harga jual KEMASAN di master (independen, bukan isi ×
   * harga pcs); quote mengonversi sekali ke satuan dasar lewat
   * gerbang yang sama dengan pembelian (resolveLinePackagings +
   * toBaseQty/pricePerBaseUnit). Null/absen = baris satuan dasar.
   */
  packagingId?: string | null;
  /**
   * S4: faktor cuplikan baris — HANYA boleh diisi jalur server
   * tepercaya (prosesor sinkronisasi offline dari muatan tersimpan):
   * penjualan offline yang sudah terjadi secara fisik dikonversi
   * dengan faktor SAAT TRANSAKSI, bukan isi master saat sinkron.
   * Skema aksi klien tidak meneruskan kolom ini (doktrin yang sama
   * dengan frozenPrices di QuoteContext).
   */
  isiSnapshot?: string | number;
};


export type QuoteLine = {
  productId: string;
  sku: string;
  name: string;
  /**
   * S4: identitas kemasan baris (null = satuan dasar) beserta bentuk
   * masukannya. `qty` di bawah tetap SATUAN DASAR (hasil konversi
   * tunggal di sini); qtyInput/isiSnapshot adalah cuplikan yang
   * disimpan baris penjualan dan dicetak struk ("1 Dus").
   */
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
  unitCost: number;
  stock: number;
  trackStock: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  serialNumbers: string[];
};


export type QuoteResult = {
  lines: QuoteLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  netSales: number;
  roundingAdjustment: number;
  total: number;
  roundingMode: string;
  cashRounding: { step: number; direction: RoundDirection } | null;
  discountAccountId?: string | null;
  customerGroupName?: string;
  customerGroupId?: string;
  // POS-DISC-01: set when the largest manual line discount exceeds the
  // company threshold — the quote already enforced the permission, and
  // createSale uses this to write the override audit row.
  manualDiscountOverride: {
    maxPercent: number;
    thresholdPercent: number;
    lines: string[];
    // POS1-10: persen efektif terhadap bruto harga normal, dicatat
    // sebagai informasi tambahan (basis penilaian ambang adalah
    // maxPercent terhadap harga kelompok).
    maxGrossPercent: number;
  } | null;
};

// POS3-10: bentuk quote yang boleh menyeberang ke klien. unitCost
// bersifat internal domain (HPP, mutasi stok) dan hanya disertakan
// bila pemanggil memegang inventory.cost — lapisan aksi yang
// memutuskan; tipe ini membuat ketiadaannya jujur secara tipe, bukan
// sekadar tidak ditampilkan UI.


export type QuoteLinePublic = Omit<QuoteLine, "unitCost"> & { unitCost?: number };


export type QuoteResultPublic = Omit<QuoteResult, "lines"> & { lines: QuoteLinePublic[] };


export type QuoteContext = {
  companyId: string;
  warehouseId: string;
  customerId?: string | null;
  groupId?: string | null;
  lines: CartLineInput[];
  // Reference date for batch expiry (defaults to today); checkout passes
  // the sale date so quote and posting judge expiry identically.
  asOfDate?: string;
  // POS-DISC-01 (D-10): whether the actor holds the `pos.discount`
  // permission. The action layer resolves it from the session; direct
  // domain callers default to "not permitted".
  canDiscount?: boolean;
  /** Checkout locks the cost snapshot; read-only quotes never lock. */
  lockCosts?: boolean;
  // FIX-POS Tahap 2 (POS3-04): mode harga beku — harga satuan diambil
  // dari snapshot baris (line.unitPrice), BUKAN harga master, dan
  // aturan harga kelompok tidak diterapkan ulang di atasnya. HANYA
  // boleh diisi jalur penyelesaian offline di server dari muatan
  // tersimpan; aksi klien tidak pernah meneruskannya (harga dari
  // klien tetap diabaikan di semua jalur lain).
  frozenPrices?: boolean;
  // FIX-GDG Tahap 2 (GDG1-09): reservasi yang dipenuhi checkout ini —
  // stoknya tidak mengurangi ketersediaan untuk keranjang ini, dan
  // alokasinya dikonsumsi createSale sesudah penjualan terposting.
  reservationId?: string | null;
  /** Mengizinkan produk non-aktif untuk sinkronisasi transaksi offline historis (POS-008). */
  allowInactiveProducts?: boolean;
};

/** Cash-rounding view of a company RoundingMode (SET-RND-01). */


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


export async function quoteCart(tx: Tx, ctx: QuoteContext): Promise<QuoteResult> {
  if (ctx.lines.length === 0) throw new AppError("VALIDATION", "Keranjang masih kosong.");
  if (ctx.lines.length > 200) throw new AppError("VALIDATION", "Maksimal 200 baris per transaksi.");

  // T3R-1: baris produk duplikat ditolak di domain. Terminal memang
  // menggabungkan baris, tetapi server action dapat dipanggil langsung —
  // dan duplikat mengakali dua penjaga per baris: ambang diskon manual
  // POS-DISC-01 (dua baris 9,5% lolos satu-satu, gabungannya 19%) serta
  // cek stok per baris di createSale. Satu produk = satu baris.
  // S4: kunci keunikan kini (produk, kemasan) — menjual 1 Dus + 3 Pcs
  // produk yang sama adalah DUA baris sah (bentuk masukan berbeda),
  // sedangkan produk yang sama dalam kemasan yang sama tetap ditolak.
  const seenLineKeys = new Set<string>();
  for (const line of ctx.lines) {
    const key = `${line.productId}|${line.packagingId ?? ""}`;
    if (seenLineKeys.has(key)) {
      throw new AppError(
        "VALIDATION",
        "Produk yang sama muncul lebih dari sekali — gabungkan jumlahnya dalam satu baris.",
      );
    }
    seenLineKeys.add(key);
  }

  const loaded = await loadQuoteContext(tx, ctx);
  const { settings, group } = loaded;

  const packagings = await resolveQuotePackagings(tx, ctx, loaded.productMap);

  const { lines, subtotal, discountTotal, taxTotal, manualDiscountOverride } =
    priceQuoteLines(ctx, loaded, packagings);

  const groupCashRounding =
    group && group.roundCashTotal && group.roundingStep > 0
      ? { step: group.roundingStep, direction: group.roundingDirection }
      : null;
  // SET-RND-01 (D-10): bila tidak ada aturan pembulatan total dari
  // kelompok, pembulatan perusahaan (companySettings.roundingMode)
  // menjadi bawaan — sebelumnya pengaturan ini tidak pernah diterapkan.
  const companyMode = settings.roundingMode as RoundingMode;
  const cashRounding = groupCashRounding ?? cashRoundingForMode(companyMode);
  const preRounding = subtotal.minus(discountTotal);
  const roundedRaw = groupCashRounding
    ? roundTo(preRounding, groupCashRounding.step, groupCashRounding.direction)
    : roundTotal(preRounding, companyMode).rounded;
  // Jangan pernah membulatkan penjualan positif menjadi nol: pembulatan
  // kas terdekat 500 pada harga 222 akan membuat barang gratis. Bila
  // hasil bulat <= 0, pertahankan nilai sebelum pembulatan.
  const rounded = preRounding.gt(0) && roundedRaw.lte(0) ? preRounding : roundedRaw;
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
    discountAccountId: group?.discountAccountId ?? null,
    customerGroupName: group?.name,
    customerGroupId: group?.id,
    manualDiscountOverride,
  };
}


type QuoteSettings = {
  taxRate: string;
  taxEnabled: boolean;
  allowNegativeStock: boolean;
  roundingMode: string;
  posDiscountThresholdPercent: string;
};


type QuoteGroup = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: RoundDirection;
  roundCashTotal: boolean;
  discountAccountId: string | null;
};


type QuoteProductRow = {
  id: string;
  sku: string;
  name: string;
  salePrice: string;
  costPrice: string;
  isActive: boolean;
  trackStock: boolean;
  trackBatch: boolean;
  trackSerial: boolean;
  isTaxExempt: boolean;
};


type LoadedQuoteContext = {
  settings: QuoteSettings;
  group: QuoteGroup | null;
  priceRules: Map<string, { type: "percent" | "fixed"; value: string }>;
  productMap: Map<string, QuoteProductRow>;
  stock: Map<string, number>;
  taxRate: Decimal;
};

/**
 * FIX-ARS Tahap 4: fase dari quoteCart — badan dipindah apa adanya;
 * pemuatan konteks — pengaturan, gudang, kelompok harga & aturan
 * harganya, produk, stok tersedia (batch segar, dikurangi reservasi,
 * ditambah kembali reservasi yang dipenuhi), tarif pajak efektif.
 */


async function loadQuoteContext(tx: Tx, ctx: QuoteContext): Promise<LoadedQuoteContext> {
  const settings = await getCompanySettingsRow(tx, ctx.companyId);

  if (!settings) throw new AppError("VALIDATION", "Pengaturan perusahaan belum dibuat.");

  // POS-REF-01: the warehouse comes from the client, so the domain must
  // prove it belongs to this company and is still active — otherwise a
  // crafted request could move stock under a foreign warehouse id.
  const [warehouse] = await tx
    .select({ id: warehouses.id, name: warehouses.name, isActive: warehouses.isActive })
    .from(warehouses)
    .where(and(eq(warehouses.companyId, ctx.companyId), eq(warehouses.id, ctx.warehouseId)))
    .limit(1);
  if (!warehouse) throw new AppError("NOT_FOUND", "Gudang tidak ditemukan di perusahaan ini.");
  if (!warehouse.isActive) {
    throw new AppError("VALIDATION", `Gudang ${warehouse.name} sudah nonaktif.`);
  }

  let group: {
    id: string;
    name: string;
    roundingStep: number;
    roundingDirection: RoundDirection;
    roundCashTotal: boolean;
    discountAccountId: string | null;
  } | null = null;
  if (ctx.groupId) {
    const [row] = await tx
      .select({
        id: customerGroups.id,
        name: customerGroups.name,
        roundingStep: customerGroups.roundingStep,
        roundingDirection: customerGroups.roundingDirection,
        roundCashTotal: customerGroups.roundCashTotal,
        discountAccountId: customerGroups.discountAccountId,
      })
      .from(customerGroups)
      .where(
        and(
          eq(customerGroups.companyId, ctx.companyId),
          eq(customerGroups.id, ctx.groupId),
          eq(customerGroups.isActive, true),
        ),
      )
      .limit(1);
    if (!row) throw new AppError("VALIDATION", "Kelompok harga tidak ditemukan atau nonaktif.");
    group = {
      id: row.id,
      name: row.name,
      roundingStep: row.roundingStep,
      roundingDirection: row.roundingDirection as RoundDirection,
      roundCashTotal: row.roundCashTotal,
      discountAccountId: row.discountAccountId,
    };
  }

  const ids = [...new Set(ctx.lines.map((line) => line.productId))];

  const priceRules = new Map<string, { type: "percent" | "fixed"; value: string }>();
  if (group) {
    const rows = await tx
      .select({
        productId: customerGroupPrices.productId,
        ruleType: customerGroupPrices.ruleType,
        value: customerGroupPrices.value,
      })
      .from(customerGroupPrices)
      .where(
        and(
          eq(customerGroupPrices.companyId, ctx.companyId),
          eq(customerGroupPrices.groupId, group.id),
          inArray(customerGroupPrices.productId, ids),
        ),
      );
    for (const row of rows) {
      priceRules.set(row.productId, {
        type: row.ruleType as "percent" | "fixed",
        value: row.value,
      });
    }
  }
  const productQuery = tx
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      salePrice: products.salePrice,
      costPrice: products.costPrice,
      isActive: products.isActive,
      trackStock: products.trackStock,
      trackBatch: products.trackBatch,
      trackSerial: products.trackSerial,
      isTaxExempt: products.isTaxExempt,
    })
    .from(products)
    .where(and(eq(products.companyId, ctx.companyId), inArray(products.id, ids))).orderBy(products.id);
  const productRows = await (ctx.lockCosts ? productQuery.for("update") : productQuery);

  const productMap = new Map(productRows.map((row) => [row.id, row]));
  const stock = await getStock(tx, ctx.companyId, ctx.warehouseId, ids);
  // G8/D-7: for batch-tracked products the sellable quantity is the fresh
  // (unexpired) batch total, not raw on-hand — expired stock is physically
  // present but must never be quoted as available.
  const availability = await getBatchAvailability(tx, {
    companyId: ctx.companyId,
    warehouseId: ctx.warehouseId,
    productIds: ids,
    asOfDate: ctx.asOfDate ?? todayISO(),
  });
  for (const [productId, avail] of availability) {
    stock.set(productId, avail.fresh.toNumber());
  }
  // SIM-2 S7B-2 Batch 4: reservasi aktif mengurangi stok TERSEDIA pada
  // quote & checkout (keduanya lewat sini) tanpa mengubah ledger.
  // GDG1-09: kecualikan reservasi yang sedang diklaim keranjang ini langsung di SQL.
  const reservedQuantities = await getReservedQuantities(
    tx,
    ctx.companyId,
    ctx.warehouseId,
    ids,
    new Date(),
    { excludeReservationId: ctx.reservationId ?? null },
  );
  for (const [productId, qty] of reservedQuantities) {
    if (qty.gt(0)) {
      stock.set(productId, Math.max(0, (stock.get(productId) ?? 0) - qty.toNumber()));
    }
  }
  if (ctx.reservationId) {
    const reservation = await getConsumableReservation(tx, {
      companyId: ctx.companyId,
      reservationId: ctx.reservationId,
      warehouseId: ctx.warehouseId,
    });
    if (!ids.includes(reservation.productId)) {
      throw new AppError(
        "VALIDATION",
        "Produk pada reservasi yang dirujuk tidak ada di keranjang ini.",
      );
    }
  }
  // SIM-2 S2 (audit PPN): saklar PPN per perusahaan. Tarif tetap
  // tersimpan di pengaturan; selama saklar mati, tarif diperlakukan 0
  // di seluruh perhitungan POS (quote = checkout, keduanya lewat sini).
  // A-26 Q1b (D-04): aturan yang sama dengan definisi kanonis
  // effectiveTaxRate (server/expenses.ts), SENGAJA diterapkan di sini
  // pada snapshot pengaturan yang sudah dimuat loadQuoteContext —
  // bukan memanggil helpernya — karena (1) helper itu membaca ulang
  // baris pengaturan yang sama di dalam transaksi ini, dan (2) mesin
  // quote bekerja Decimal ujung-ke-ujung sedangkan helper
  // mengembalikan string. Quote & checkout menilai dari SATU snapshot
  // pengaturan yang sama; turunan tarifnya menempel pada snapshot itu.
  const taxRate = settings.taxEnabled ? d(settings.taxRate) : d(0);
  return { settings, group, priceRules, productMap, stock, taxRate };
}

/** Kemasan baris yang sudah diselesaikan untuk penetapan harga. */
export type ResolvedQuotePackaging = {
  id: string;
  name: string;
  /** Faktor konversi baris (isi per kemasan, ke satuan dasar). */
  isi: string;
  /** Harga jual per kemasan di master saat ini; null = belum diatur. */
  salePrice: string | null;
};

/**
 * S4: resolusi kemasan baris-baris quote, sejajar urutan `ctx.lines`.
 * Dua jalur, mengikuti doktrin kepemilikan faktor:
 * - Baris TANPA `isiSnapshot` (terminal & aksi klien): gerbang
 *   bersama `resolveLinePackagings` — kemasan harus ada, milik produk
 *   baris itu, dan AKTIF; faktor & harga dari master saat ini.
 * - Baris DENGAN `isiSnapshot` (prosesor offline server): faktor dari
 *   CUPLIKAN muatan (transaksi fisik sudah terjadi; master yang
 *   berubah sesudahnya tidak menulis ulang konversinya). Baris master
 *   tetap dibaca untuk nama & harga jual berlaku kini (penilaian
 *   konflik harga POS3-04) — termasuk yang sudah nonaktif, karena
 *   penjualan asal terjadi saat ia masih aktif; baris master yang
 *   sudah tidak ada sama sekali menolak quote (item masuk
 *   peninjauan, bukan diposting dengan faktor karangan).
 */
async function resolveQuotePackagings(
  tx: Tx,
  ctx: QuoteContext,
  productMap: Map<string, QuoteProductRow>,
): Promise<(ResolvedQuotePackaging | null)[]> {
  const result: (ResolvedQuotePackaging | null)[] = ctx.lines.map(() => null);
  const productName = (productId: string) => productMap.get(productId)?.name ?? "produk";

  const onlineIndexes: number[] = [];
  const offlineIndexes: number[] = [];
  ctx.lines.forEach((line, index) => {
    if (!line.packagingId) return;
    if (line.isiSnapshot != null && line.isiSnapshot !== "") offlineIndexes.push(index);
    else onlineIndexes.push(index);
  });

  if (onlineIndexes.length > 0) {
    const resolved = await resolveLinePackagings(
      tx,
      ctx.companyId,
      onlineIndexes.map((index) => ctx.lines[index]),
      productName,
    );
    onlineIndexes.forEach((lineIndex, i) => {
      const snap = resolved[i];
      if (snap.packaging) {
        result[lineIndex] = {
          id: snap.packaging.id,
          name: snap.packaging.name,
          isi: snap.isiSnapshot,
          salePrice: snap.packaging.salePrice,
        };
      }
    });
  }

  if (offlineIndexes.length > 0) {
    const wantedIds = [
      ...new Set(offlineIndexes.map((index) => ctx.lines[index].packagingId as string)),
    ];
    const rows = await tx
      .select()
      .from(productPackagings)
      .where(
        and(eq(productPackagings.companyId, ctx.companyId), inArray(productPackagings.id, wantedIds)),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const index of offlineIndexes) {
      const line = ctx.lines[index];
      const row = byId.get(line.packagingId as string);
      if (!row) {
        throw new AppError(
          "VALIDATION",
          `Kemasan pada baris ${productName(line.productId)} tidak ditemukan lagi di master — item tidak dapat diposting otomatis.`,
        );
      }
      if (row.productId !== line.productId) {
        throw new AppError(
          "VALIDATION",
          `Kemasan "${row.name}" bukan kemasan produk ${productName(line.productId)}.`,
        );
      }
      if (!ctx.frozenPrices && !d(line.isiSnapshot).eq(d(row.isi))) {
        throw new AppError("VALIDATION", `Faktor kemasan ${row.name} berbeda dari master. Transaksi ditahan; supervisor harus memeriksa faktor dan struk asal sebelum penyelesaian.`);
      }
      result[index] = {
        id: row.id,
        name: row.name,
        isi: String(line.isiSnapshot),
        salePrice: row.salePrice,
      };
    }
  }

  return result;
}

/**
 * FIX-ARS Tahap 4: fase dari quoteCart — badan dipindah apa adanya;
 * penetapan harga per baris — harga normal/beku, aturan kelompok,
 * diskon manual & penilaian ambangnya, pajak per baris — beserta
 * akumulasi subtotal/diskon/pajak dan override diskon manual.
 */


function priceQuoteLines(
  ctx: QuoteContext,
  loaded: LoadedQuoteContext,
  packagings: (ResolvedQuotePackaging | null)[],
) {
  const { productMap, priceRules, stock, taxRate } = loaded;
  const group = loaded.group;
  const settings = loaded.settings;
  const lines: QuoteLine[] = [];
  let subtotal = d(0);
  let discountTotal = d(0);
  let taxTotal = d(0);
  // POS-DISC-01: manual discounts are judged per line against the line
  // gross (qty × normal price). Group price rules are NOT manual
  // discounts and never count toward the threshold.
  const discountThreshold = d(settings.posDiscountThresholdPercent);
  let maxManualPercent = d(0);
  // POS1-10: persen terhadap bruto harga normal — kini hanya
  // informasi tambahan audit, bukan basis penilaian ambang.
  let maxGrossPercent = d(0);
  const overThresholdLines: string[] = [];

  for (let lineIndex = 0; lineIndex < ctx.lines.length; lineIndex++) {
    const line = ctx.lines[lineIndex];
    const product = productMap.get(line.productId);
    if (!product) throw new AppError("VALIDATION", "Produk tidak ditemukan atau sudah dihapus.");
    if (!product.isActive && !ctx.allowInactiveProducts) {
      throw new AppError("VALIDATION", `${product.name} sedang tidak aktif.`);
    }
    // S4: qty baris adalah qty INPUT (dalam kemasan terpilih, atau
    // satuan dasar); seluruh aritmetika di bawah berjalan pada qty
    // SATUAN DASAR hasil konversi tunggal di titik ini.
    const pack = packagings[lineIndex];
    const qtyInput = d(line.qty);
    if (qtyInput.lte(0)) throw new AppError("VALIDATION", `Jumlah ${product.name} harus lebih dari nol.`);
    if (qtyInput.decimalPlaces() > 3) throw new AppError("VALIDATION", "Jumlah maksimal 3 desimal.");
    const qty = pack ? d(toBaseQty(toDb(qtyInput), pack.isi)) : qtyInput;

    // SIM-2 S7B-2 Batch 5: produk serial wajib memilih seri per unit.
    const serialNumbersForLine = product.trackSerial
      ? normalizeSerialNumbers(line.serialNumbers ?? [])
      : [];
    if (product.trackSerial) {
      if (!qty.isInteger() || serialNumbersForLine.length !== qty.toNumber()) {
        throw new AppError(
          "VALIDATION",
          `Pilih nomor seri untuk setiap unit ${product.name} (dibutuhkan ${qty.toString()} nomor seri).`,
        );
      }
      if (new Set(serialNumbersForLine).size !== serialNumbersForLine.length) {
        throw new AppError("VALIDATION", `Nomor seri ${product.name} dipilih lebih dari sekali.`);
      }
    }

    // FIX-POS Tahap 2 (POS3-04): pada mode harga beku, snapshot baris
    // adalah harga normalnya — transaksi masa lalu dibukukan pada
    // harga saat ia terjadi, bukan harga master hari ini.
    // S4: snapshot baris berkemasan adalah harga PER KEMASAN yang
    // dibebankan di struk offline; harga normal per satuan dasarnya
    // adalah snapshot itu dibagi faktor cuplikan baris.
    let normalUnitPrice = d(product.salePrice);
    let grossOverride: Decimal | null = null;
    if (ctx.frozenPrices) {
      if (line.unitPrice == null) {
        throw new AppError(
          "VALIDATION",
          `Snapshot harga ${product.name} tidak lengkap; penyelesaian pada harga struk offline tidak dapat dilakukan untuk item ini.`,
        );
      }
      if (pack) {
        grossOverride = qtyInput.mul(d(line.unitPrice));
        normalUnitPrice = grossOverride.div(qty);
      } else {
        normalUnitPrice = d(line.unitPrice);
      }
    } else if (pack) {
      // S4: harga jual kemasan INDEPENDEN dari master — hitung bruto langsung
      // dari qtyInput × harga kemasan agar pembagian isi non-bulat (mis. /6, /12)
      // tidak memicu selisih 0.0002 akibat pembulatan unit 4 desimal.
      if (pack.salePrice != null) {
        grossOverride = qtyInput.mul(d(pack.salePrice));
        normalUnitPrice = grossOverride.div(qty);
      } else {
        normalUnitPrice = d(product.salePrice);
      }
    }
    const gross = grossOverride ?? qty.mul(normalUnitPrice);

    let groupUnitPrice = normalUnitPrice;
    let appliedType: DiscountType | null = null;
    let appliedValue = d(0);

    // S4: aturan harga kelompok adalah harga PER SATUAN DASAR per
    // produk — baris berkemasan tidak tunduk padanya karena harga
    // kemasan memang berdiri sendiri (itulah makna harga kemasan
    // independen di master). Diskon manual kasir tetap berlaku.
    if (group && !ctx.frozenPrices && !pack) {
      const rule = priceRules.get(product.id);
      if (rule && d(rule.value).gte(0)) {
        const candidate =
          rule.type === "percent"
            ? normalUnitPrice.mul(d(100).minus(rule.value)).div(100)
            : d(rule.value);
        const bounded = D.min(D.max(candidate, 0), normalUnitPrice);
        groupUnitPrice = D.min(
          D.max(roundTo(bounded, group.roundingStep, group.roundingDirection), 0),
          normalUnitPrice,
        );
        appliedType = rule.type === "percent" ? "percent" : "nominal";
        appliedValue = d(rule.value);
      }
    }

    const groupDiscount = normalUnitPrice.minus(groupUnitPrice).mul(qty);

    let manualDiscount = d(0);
    if (line.discountType && d(line.discountValue).gt(0)) {
      manualDiscount = lineDiscount({
        qty,
        unitPrice: groupUnitPrice,
        type: line.discountType,
        value: line.discountValue,
      });
      appliedType = line.discountType;
      appliedValue = d(line.discountValue);
    }

    if (manualDiscount.gt(0)) {
      // POS1-10 (mencabut basis T3R-6): persen yang dinilai terhadap
      // ambang adalah persen terhadap HARGA TRANSAKSI AKTUAL sebelum
      // diskon manual — qty × harga kelompok. T3R-6 menilai terhadap
      // bruto harga normal, yang terbukti membalik semantik penjaga:
      // pada produk berharga normal Rp100.000 yang harga kelompoknya
      // Rp500, diskon manual 100% (meng-nol-kan sisa yang harus dibayar
      // pelanggan) ternilai hanya 0,5% dan lolos tanpa izin maupun
      // audit. Yang dijaga adalah tindakan manual kasir atas harga
      // yang benar-benar berlaku, bukan proporsinya terhadap harga
      // normal yang sudah didiskon kelompok. Tanpa kelompok, harga
      // kelompok = harga normal sehingga penilaian tidak berubah.
      // Persen terhadap bruto tetap dihitung sebagai informasi
      // tambahan untuk audit override.
      const transactionGross = qty.mul(groupUnitPrice);
      const percent = transactionGross.gt(0) ? manualDiscount.div(transactionGross).mul(100) : d(100);
      const grossPercent = gross.gt(0) ? manualDiscount.div(gross).mul(100) : d(0);
      if (percent.gt(maxManualPercent)) maxManualPercent = percent;
      if (grossPercent.gt(maxGrossPercent)) maxGrossPercent = grossPercent;
      if (percent.gt(discountThreshold)) overThresholdLines.push(product.name);
    }

    const discount = D.min(D.max(groupDiscount.plus(manualDiscount), 0), gross);
    const net = gross.minus(discount);
    const lineTaxRate = product.isTaxExempt ? d(0) : taxRate;
    const tax = lineTax({ net, rate: lineTaxRate, inclusive: true });

    subtotal = subtotal.plus(gross);
    discountTotal = discountTotal.plus(discount);
    taxTotal = taxTotal.plus(tax);

    lines.push({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      packagingId: pack?.id ?? null,
      packagingName: pack?.name ?? null,
      qtyInput: qtyInput.toNumber(),
      // Kanonis tanpa ekor desimal DB ("40.0000" → "40") — nilai yang
      // sama, bentuk yang stabil untuk klien & cuplikan muatan.
      isiSnapshot: pack ? d(pack.isi).toString() : "1",
      qty: qty.toNumber(),
      unitPrice: normalUnitPrice.toNumber(),
      groupUnitPrice: groupUnitPrice.toNumber(),
      gross: gross.toNumber(),
      discountType: appliedType,
      discountValue: appliedValue.toNumber(),
      discountAmount: discount.toNumber(),
      groupDiscountAmount: groupDiscount.toNumber(),
      manualDiscountAmount: manualDiscount.toNumber(),
      taxRate: lineTaxRate.toNumber(),
      taxAmount: tax.toNumber(),
      lineTotal: net.toNumber(),
      unitCost: d(product.costPrice).toNumber(),
      stock: product.trackStock ? (stock.get(product.id) ?? 0) : Number.MAX_SAFE_INTEGER,
      trackStock: product.trackStock,
      trackBatch: product.trackBatch,
      trackSerial: product.trackSerial,
      serialNumbers: serialNumbersForLine,
    });
  }

  // POS-DISC-01 (D-10): a manual discount above the company threshold is
  // a supervisor-level act — it requires the `pos.discount` permission.
  const manualDiscountOverride =
    overThresholdLines.length > 0
      ? {
          maxPercent: maxManualPercent.toNumber(),
          thresholdPercent: discountThreshold.toNumber(),
          lines: overThresholdLines,
          maxGrossPercent: maxGrossPercent.toNumber(),
        }
      : null;
  if (manualDiscountOverride && !ctx.canDiscount) {
    throw new AppError(
      "VALIDATION",
      `Diskon manual efektif ${maxManualPercent.toDecimalPlaces(2).toString()}% pada ${overThresholdLines[0]} melebihi ambang ${discountThreshold.toDecimalPlaces(2).toString()}%. Diskon di atas ambang memerlukan persetujuan supervisor/manajer (izin Diskon manual POS).`,
    );
  }
  return { lines, subtotal, discountTotal, taxTotal, manualDiscountOverride };
}
