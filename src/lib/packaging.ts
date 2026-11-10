/**
 * Program Satuan Kemasan (membuka lagi D-17, persetujuan pemilik
 * 2026-11-08) — logika MURNI kemasan per produk, satu sumber untuk semua
 * permukaan (model: docs/satuan/RENCANA-SATUAN.md; riset:
 * research_notes/multi-unit-uom-receiving-vs-selling §5–§7).
 *
 * Prinsip yang dikunci di sini:
 * - Stok selalu dalam satuan dasar produk. Kemasan ("Dus", "Pak", …)
 *   adalah baris konversi tetap yang menyatakan isinya LANGSUNG ke
 *   satuan dasar (`isi` = "1 Dus = 40 satuan dasar") — tidak ada
 *   konversi berantai dan tidak ada faktor global per nama satuan.
 * - Konversi terjadi SEKALI, di pinggir transaksi, lewat fungsi di
 *   berkas ini; hasilnya (qty dasar + faktor cuplikan) yang disimpan
 *   baris transaksi mulai S2. Ledger tidak pernah mengonversi lagi.
 * - Harga per kemasan berdiri sendiri: harga jual dus BUKAN isi × harga
 *   pcs (keputusan komersial grosir), harga pokok per pcs adalah
 *   harga kemasan ÷ isi.
 */
import { d, formatQty, toDb } from "@/lib/money";

/** Bentuk satu baris kemasan sebagaimana dikirim formulir / disimpan. */
export type PackagingInput = {
  /** Id baris tersimpan; kosong/absen = baris baru. */
  id?: string;
  name: string;
  /** Isi ke satuan dasar, string numeric ("40"). */
  isi: string;
  buyPrice: string | null;
  salePrice: string | null;
  barcode: string | null;
  isDefaultPurchase: boolean;
  isDefaultSale: boolean;
  isActive: boolean;
};

/** Baris kemasan yang sudah tersimpan (punya id). */
export type PackagingSnapshot = PackagingInput & { id: string; sortOrder?: number };

export class PackagingSyncError extends Error {
  code: "VALIDATION" | "CONFLICT";
  constructor(code: "VALIDATION" | "CONFLICT", message: string) {
    super(message);
    this.code = code;
  }
}

function normalizeBarcode(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function normalizePrice(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return toDb(value);
}

/** Bentuk kanonik satu baris untuk perbandingan & penyimpanan. */
export function normalizePackagingInput(input: PackagingInput): PackagingInput {
  return {
    ...(input.id ? { id: input.id } : {}),
    name: input.name.trim(),
    isi: toDb(input.isi),
    buyPrice: normalizePrice(input.buyPrice),
    salePrice: normalizePrice(input.salePrice),
    barcode: normalizeBarcode(input.barcode),
    isDefaultPurchase: Boolean(input.isDefaultPurchase),
    isDefaultSale: Boolean(input.isDefaultSale),
    isActive: Boolean(input.isActive),
  };
}

/**
 * Validasi satu baris kemasan. Mengembalikan daftar pesan (kosong =
 * sah). `isi` wajib bilangan bulat ≥ 2: 1 adalah duplikat satuan dasar,
 * pecahan ditolak untuk barang terhitung (riset §4.3 — isi bervariabel
 * dihitung saat penerimaan, bukan dirata-rata menjadi faktor tetap).
 */
export function validatePackagingInput(input: PackagingInput): string[] {
  const errors: string[] = [];
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) {
    errors.push("Nama kemasan wajib diisi (maks 60 karakter).");
  }
  const isi = d(input.isi);
  if (!isi.isFinite() || !isi.isInteger() || isi.lt(2)) {
    errors.push(
      `Isi kemasan "${name || "?"}" harus bilangan bulat ≥ 2 (isi ke satuan dasar). Isi 1 sama dengan satuan dasar itu sendiri.`,
    );
  }
  for (const [label, value] of [
    ["Harga beli", input.buyPrice],
    ["Harga jual", input.salePrice],
  ] as const) {
    if (value !== null && value !== undefined && value !== "") {
      const amount = d(value);
      if (!amount.isFinite() || amount.isNegative()) {
        errors.push(`${label} kemasan "${name || "?"}" tidak boleh negatif.`);
      }
    }
  }
  const barcode = normalizeBarcode(input.barcode);
  if (barcode !== null && barcode.length > 60) {
    errors.push(`Barcode kemasan "${name || "?"}" terlalu panjang (maks 60 karakter).`);
  }
  return errors;
}

/**
 * Kuantitas satuan dasar dari kuantitas yang dimasukkan dalam kemasan:
 * qty dasar = qty input × isi, dibulatkan SEKALI ke skala numeric repo
 * (4 desimal, half-up — konvensi src/lib/money). Inilah satu-satunya
 * fungsi konversi kuantitas; semua jalur posting (S2+) memanggil ini.
 */
export function toBaseQty(qtyInput: string | number, isi: string | number): string {
  return toDb(d(qtyInput).times(d(isi)));
}

/**
 * Harga per satuan dasar dari harga per kemasan: harga ÷ isi,
 * dibulatkan sekali ke 4 desimal. Dipakai untuk harga pokok per pcs
 * (harga beli kemasan ÷ isi → AVCO) dan padanannya di sisi jual.
 */
export function pricePerBaseUnit(pricePerPackaging: string | number, isi: string | number): string {
  const divisor = d(isi);
  if (!divisor.isFinite() || divisor.lte(0)) {
    throw new Error("Isi kemasan harus lebih besar dari 0 untuk menghitung harga per satuan dasar.");
  }
  return toDb(d(pricePerPackaging).div(divisor));
}

/** Harga pokok per satuan dasar (HPP per pcs) dari harga beli per kemasan. */
export function costPerBaseUnit(buyPricePerPackaging: string | number, isi: string | number): string {
  return pricePerBaseUnit(buyPricePerPackaging, isi);
}

/* ------------------------------------------------------------------ */
/* S3 — hitungan campuran opname & tampilan pecahan kemasan            */
/* ------------------------------------------------------------------ */

/**
 * Satu komponen hitungan fisik opname (S3): jumlah yang dihitung
 * petugas dalam SATU bentuk — satu kemasan produk itu, atau satuan
 * dasarnya sendiri (`packagingId` null, `isiSnapshot` "1"). Daftar
 * komponen disimpan apa adanya di baris dokumen opname
 * (`stock_document_lines.count_breakdown`, jsonb) dan di muatan audit
 * dokumen, sehingga hitungan campuran ("3 Dus + 4 Slop + 5 Pcs")
 * dapat diaudit persis sebagaimana dihitung — nama & faktor adalah
 * cuplikan saat hitung, bukan master hari ini.
 */
export type CountBreakdownComponent = {
  /** Null = komponen satuan dasar (pcs lepas). */
  packagingId: string | null;
  /** Nama cuplikan: nama kemasan, atau nama satuan dasar produk. */
  packagingName: string;
  /** Faktor cuplikan komponen (isi kemasan; "1" untuk satuan dasar). */
  isiSnapshot: string;
  /** Jumlah komponen sebagaimana dihitung ("3" untuk 3 Dus). */
  qtyInput: string;
  /** qtyInput × isiSnapshot — kontribusi komponen ke qty dasar. */
  baseQty: string;
};

/**
 * Total qty dasar dari komponen-komponen hitungan: Σ qty × isi,
 * dibulatkan SEKALI di akhir (prinsip konversi yang sama dengan
 * toBaseQty — tidak ada pembulatan per komponen).
 */
export function sumCountComponents(
  components: { qtyInput: string | number; isiSnapshot: string | number }[],
): string {
  let total = d(0);
  for (const component of components) {
    total = total.plus(d(component.qtyInput).mul(d(component.isiSnapshot)));
  }
  return toDb(total);
}

/** Teks rincian hitungan campuran: "3 Dus + 4 Slop + 5 Pcs". */
export function formatCountBreakdown(components: CountBreakdownComponent[]): string {
  return components
    .map((component) => `${formatQty(component.qtyInput)} ${component.packagingName}`)
    .join(" + ");
}

/**
 * Label pecahan tampilan stok dalam kemasan terbesar (DISPLAY-ONLY):
 * 345 pcs dengan Dus isi 100 → "≈ 3 Dus 45 Pcs". Angka dasar tidak
 * pernah berubah — label ini murni bantuan baca di daftar stok, nilai
 * persediaan, dan kartu produk. Null bila produk tak berkemasan atau
 * qty belum mencapai satu kemasan terbesar pun (termasuk qty ≤ 0).
 */
export function packagingBreakdownLabel(
  baseQty: string | number,
  packagings: { name: string; isi: string | number }[],
  baseUnitName: string,
): string | null {
  if (packagings.length === 0) return null;
  const qty = d(baseQty);
  if (!qty.isFinite() || qty.lte(0)) return null;
  let largest: { name: string; isi: string | number } | null = null;
  for (const pack of packagings) {
    if (d(pack.isi).lte(1)) continue;
    if (!largest || d(pack.isi).gt(d(largest.isi))) largest = pack;
  }
  if (!largest) return null;
  const whole = qty.div(d(largest.isi)).floor();
  if (whole.lt(1)) return null;
  const rest = qty.minus(whole.mul(d(largest.isi)));
  const head = `≈ ${formatQty(whole)} ${largest.name}`;
  return rest.gt(0) ? `${head} ${formatQty(rest)} ${baseUnitName}` : head;
}

/**
 * S6 — petunjuk kemasan untuk saran pesan-ulang (DISPLAY-ONLY):
 * jumlah dasar saran dibulatkan KE ATAS ke kemasan utuh dari kemasan
 * bawaan beli — "≈ 3 Dus" untuk saran 90 pcs dengan Dus isi 40.
 * Saran resmi tetap dalam satuan dasar; label ini hanya membantu
 * pembaca memesan dalam bentuk yang benar-benar dijual pemasok.
 * Null bila tak ada kemasan bawaan beli atau saran tidak positif.
 */
export function suggestedPackagingLabel(
  suggestedQty: string | number,
  packaging: { name: string; isi: string | number } | null,
): string | null {
  if (!packaging) return null;
  const qty = d(suggestedQty);
  const isi = d(packaging.isi);
  if (!qty.isFinite() || qty.lte(0) || !isi.isFinite() || isi.lte(1)) return null;
  const whole = qty.div(isi).ceil();
  return `≈ ${formatQty(whole)} ${packaging.name}`;
}

export type PackagingSyncPlan = {
  creates: (PackagingInput & { sortOrder: number })[];
  updates: (PackagingSnapshot & { sortOrder: number })[];
  /** Id baris tersimpan yang boleh dihapus fisik (belum pernah terpakai). */
  deletes: string[];
  /** True bila harga beli/jual baris TERSIMPAN berubah (gerbang izin harga). */
  priceChanged: boolean;
};

function samePackaging(
  a: PackagingInput & { sortOrder?: number },
  b: PackagingInput & { sortOrder?: number },
): boolean {
  return (
    a.name === b.name &&
    d(a.isi).eq(d(b.isi)) &&
    (a.buyPrice ?? null) === (b.buyPrice ?? null) &&
    (a.salePrice ?? null) === (b.salePrice ?? null) &&
    (a.barcode ?? null) === (b.barcode ?? null) &&
    a.isDefaultPurchase === b.isDefaultPurchase &&
    a.isDefaultSale === b.isDefaultSale &&
    a.isActive === b.isActive &&
    (a.sortOrder ?? 0) === (b.sortOrder ?? 0)
  );
}

/**
 * Rencana sinkronisasi daftar kemasan satu produk: membandingkan daftar
 * tersimpan (`current`) dengan daftar yang dikirim formulir
 * (`submitted`, daftar lengkap yang diinginkan) dan menghasilkan
 * operasi buat/ubah/hapus + tanda perubahan harga. Murni — penjaga
 * edit hidup di sini agar teruji tanpa database:
 *
 * - Baris terpakai (id ∈ `usedIds`) yang HILANG dari kiriman = permintaan
 *   hapus → DITOLAK (CONFLICT): kemasan terpakai hanya boleh
 *   dinonaktifkan agar histori tetap terselesaikan. Baris belum terpakai
 *   yang hilang → hapus fisik.
 * - Nama duplikat (trim, case-insensitive) dan barcode duplikat di
 *   dalam kiriman → VALIDATION.
 * - Bendera bawaan bersifat radio: bila lebih dari satu baris menandai
 *   bawaan beli (atau jual), yang PERTAMA dalam urutan kiriman yang
 *   dipertahankan, sisanya dibersihkan — deterministik, tanpa tebak.
 * - Perubahan `isi` selalu diizinkan di rencana ini: ia hanya berlaku
 *   untuk dokumen berikutnya karena baris transaksi memegang faktor
 *   cuplikannya sendiri (mulai S2). Histori tidak dihitung ulang.
 */
export function planPackagingSync(
  current: PackagingSnapshot[],
  submitted: PackagingInput[],
  usedIds: ReadonlySet<string>,
): PackagingSyncPlan {
  const normalized = submitted.map(normalizePackagingInput);

  const validationErrors: string[] = [];
  for (const row of normalized) validationErrors.push(...validatePackagingInput(row));
  if (validationErrors.length > 0) {
    throw new PackagingSyncError("VALIDATION", validationErrors.join(" "));
  }

  const currentById = new Map(current.map((row) => [row.id, normalizePackagingInput(row)]));
  const currentSortOrder = new Map(current.map((row, index) => [row.id, row.sortOrder ?? index]));

  const seenNames = new Map<string, string>();
  for (const row of normalized) {
    const key = row.name.toLowerCase();
    if (seenNames.has(key)) {
      throw new PackagingSyncError(
        "VALIDATION",
        `Nama kemasan "${row.name}" dipakai lebih dari satu baris pada produk ini.`,
      );
    }
    seenNames.set(key, row.name);
  }
  const seenBarcodes = new Map<string, string>();
  for (const row of normalized) {
    if (row.barcode === null) continue;
    if (seenBarcodes.has(row.barcode)) {
      throw new PackagingSyncError(
        "VALIDATION",
        `Barcode ${row.barcode} dipakai oleh kemasan "${seenBarcodes.get(row.barcode)}" dan "${row.name}" pada produk ini.`,
      );
    }
    seenBarcodes.set(row.barcode, row.name);
  }

  // Semantik radio untuk bendera bawaan: pertama yang menandai menang.
  let purchaseDefaultClaimed = false;
  let saleDefaultClaimed = false;
  for (const row of normalized) {
    if (row.isDefaultPurchase) {
      if (purchaseDefaultClaimed) row.isDefaultPurchase = false;
      else purchaseDefaultClaimed = true;
    }
    if (row.isDefaultSale) {
      if (saleDefaultClaimed) row.isDefaultSale = false;
      else saleDefaultClaimed = true;
    }
  }

  const creates: PackagingSyncPlan["creates"] = [];
  const updates: PackagingSyncPlan["updates"] = [];
  const deletes: string[] = [];
  let priceChanged = false;
  const submittedIds = new Set<string>();

  normalized.forEach((row, index) => {
    if (!row.id) {
      creates.push({ ...row, sortOrder: index });
      return;
    }
    submittedIds.add(row.id);
    const existing = currentById.get(row.id);
    if (!existing) {
      throw new PackagingSyncError(
        "VALIDATION",
        `Kemasan "${row.name}" tidak ditemukan pada produk ini — muat ulang formulir lalu coba lagi.`,
      );
    }
    const priceDiffers =
      (existing.buyPrice ?? null) !== (row.buyPrice ?? null) ||
      (existing.salePrice ?? null) !== (row.salePrice ?? null);
    if (priceDiffers) priceChanged = true;
    // Baris tersimpan tanpa sortOrder eksplisit memakai urutan
    // kedatangannya sebagai sortOrder tersirat.
    const existingWithOrder = { ...existing, sortOrder: currentSortOrder.get(row.id) ?? 0 };
    if (!samePackaging(existingWithOrder, { ...row, sortOrder: index })) {
      updates.push({ ...row, id: row.id, sortOrder: index });
    }
  });

  for (const row of current) {
    if (submittedIds.has(row.id)) continue;
    if (usedIds.has(row.id)) {
      throw new PackagingSyncError(
        "CONFLICT",
        `Kemasan "${row.name}" sudah pernah terpakai pada transaksi dan tidak dapat dihapus. Nonaktifkan kemasan itu bila tidak dipakai lagi — histori tetap terselesaikan.`,
      );
    }
    deletes.push(row.id);
  }

  return { creates, updates, deletes, priceChanged };
}
