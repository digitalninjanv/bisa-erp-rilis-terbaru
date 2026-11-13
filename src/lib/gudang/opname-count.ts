import { d } from "@/lib/money";

/**
 * FIX-GDG Tahap 4 (GDG2-01) — logika murni alur opname dua langkah.
 *
 * Langkah 1 "Hitung" bersifat BUTA: kolom Fisik mulai KOSONG dan angka
 * sistem disembunyikan dari petugas. Baris yang belum diisi BUKAN nol —
 * ia "belum dihitung" dan tidak ikut diposting; hanya isian eksplisit
 * (termasuk "0" yang sah untuk stok habis) yang menjadi hitungan.
 * Langkah 2 "Tinjau" membandingkan sistem vs fisik di sini sebelum
 * posting apa pun terjadi di domain (createOpname tidak berubah).
 */

/** Satu kemasan aktif produk untuk hitungan campuran (S3). */
export type OpnamePackagingOption = {
  id: string;
  name: string;
  /** Isi ke satuan dasar, string numeric ("100"). */
  isi: string;
};

export type OpnameCountRow = {
  productId: string;
  name: string;
  sku: string;
  /** Stok sistem terakhir diketahui — penyeimbang tinjauan, bukan isian awal. */
  system: number;
  /**
   * Isian fisik mentah SATUAN DASAR (pcs lepas) dari petugas;
   * "" = belum dihitung. Untuk produk berkemasan ini adalah komponen
   * lepasnya — total hitung baris = komponen ini + Σ komponen kemasan.
   */
  counted: string;
  /**
   * Harga pokok berjalan untuk nilai selisih di layar tinjau.
   * null = biaya tidak terlihat bagi petugas ini (tanpa izin
   * `inventory.cost`, R3 K-3) — nilai selisih baris & total disembunyikan.
   */
  unitCost: string | null;
  /** Nama satuan dasar produk (label komponen lepas; S3). */
  unitName?: string | null;
  /** Kemasan aktif produk; kosong/absen = produk tanpa kemasan. */
  packagings?: OpnamePackagingOption[];
  /**
   * Komponen hitungan kemasan (S3): packagingId → isian mentah
   * petugas ("3" = 3 Dus). Kunci tanpa isian berarti komponen itu
   * tidak dipakai; total baris dihitung effectiveCountedQty.
   */
  components?: Record<string, string>;
};

export type OpnameReviewRow = OpnameCountRow & {
  countedQty: number | null;
  diff: number | null;
  /** diff × harga pokok, string Decimal; null bila belum dihitung. */
  diffValue: string | null;
  /** Rincian campuran terhitung ("3 Dus + 4 Slop + 5 Pcs"); null
   * bila hitungan murni satuan dasar atau belum dihitung. */
  breakdown: string | null;
};

export type OpnameCountSummary = {
  reviewRows: OpnameReviewRow[];
  countedCount: number;
  uncountedCount: number;
  diffCount: number;
  matchCount: number;
  /**
   * Σ |selisih × harga pokok| — besar dampak opname (pola total dokumen).
   * null bila ada baris terhitung yang biayanya tidak terlihat (K-3):
   * total sebagian tidak pernah ditampilkan sebagai total.
   */
  totalAbsValue: string | null;
  /** Σ (selisih × harga pokok) bertanda — arah neto ke persediaan. */
  netValue: string | null;
};

/** Parse isian fisik: null bila kosong/tidak valid/negatif (= belum dihitung). */
export function parseCountedQty(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Komponen kemasan yang benar-benar diisi petugas (isian tak kosong). */
function enteredComponents(
  row: OpnameCountRow,
): { pack: OpnamePackagingOption; qty: number | null }[] {
  if (!row.packagings || !row.components) return [];
  const entered: { pack: OpnamePackagingOption; qty: number | null }[] = [];
  for (const pack of row.packagings) {
    const raw = row.components[pack.id];
    if (raw === undefined || raw.trim() === "") continue;
    entered.push({ pack, qty: parseCountedQty(raw) });
  }
  return entered;
}

/**
 * Total hitung fisik baris dalam SATUAN DASAR (S3): komponen lepas
 * (`counted`) + Σ komponen kemasan × isinya. Tanpa komponen kemasan
 * yang terisi, ini persis parseCountedQty(counted) lama. Isian tak
 * valid di komponen mana pun (termasuk komponen lepas saat kemasan
 * dipakai) membuat baris BELUM terhitung (null) — petugas harus
 * memperbaikinya, bukan diam-diam dibaca nol. Domain menghitung ulang
 * angka ini secara otoritatif dengan Decimal saat posting.
 */
export function effectiveCountedQty(row: OpnameCountRow): number | null {
  const entered = enteredComponents(row);
  const baseQty = parseCountedQty(row.counted);
  if (entered.length === 0) return baseQty;
  if (entered.some((entry) => entry.qty === null)) return null;
  if (row.counted.trim() !== "" && baseQty === null) return null;
  let total = baseQty ?? 0;
  for (const entry of entered) {
    total += (entry.qty ?? 0) * Number(entry.pack.isi);
  }
  return total;
}

/**
 * Teks rincian hitungan campuran baris: "3 Dus + 4 Slop + 5 Pcs".
 * Hanya komponen bernilai > 0 yang disebut; null bila tidak ada
 * komponen kemasan terisi (hitungan satuan dasar murni).
 */
export function formatOpnameCountBreakdown(row: OpnameCountRow): string | null {
  const entered = enteredComponents(row).filter(
    (entry) => entry.qty !== null && entry.qty > 0,
  );
  if (entered.length === 0) return null;
  const parts = entered.map((entry) => `${entry.qty} ${entry.pack.name}`);
  const baseQty = parseCountedQty(row.counted) ?? 0;
  if (baseQty > 0) parts.push(`${baseQty} ${row.unitName ?? "satuan dasar"}`);
  return parts.join(" + ");
}

export function summarizeOpnameCount(rows: OpnameCountRow[]): OpnameCountSummary {
  let countedCount = 0;
  let diffCount = 0;
  let matchCount = 0;
  let totalAbs = d(0);
  let net = d(0);
  // K-3: satu saja baris terhitung tanpa biaya terlihat membuat total
  // tidak utuh — total & neto menjadi null (UI menyembunyikannya),
  // bukan diam-diam menganggap biaya itu nol.
  let anyHiddenCost = false;

  const reviewRows = rows.map((row) => {
    const countedQty = effectiveCountedQty(row);
    if (countedQty === null) {
      return { ...row, countedQty: null, diff: null, diffValue: null, breakdown: null };
    }
    countedCount += 1;
    const diff = countedQty - row.system;
    if (diff === 0) matchCount += 1;
    else diffCount += 1;
    if (row.unitCost === null) {
      anyHiddenCost = true;
      return {
        ...row,
        countedQty,
        diff,
        diffValue: null,
        breakdown: formatOpnameCountBreakdown(row),
      };
    }
    const diffValue = d(diff).mul(d(row.unitCost));
    totalAbs = totalAbs.plus(diffValue.abs());
    net = net.plus(diffValue);
    return {
      ...row,
      countedQty,
      diff,
      diffValue: diffValue.toString(),
      breakdown: formatOpnameCountBreakdown(row),
    };
  });

  return {
    reviewRows,
    countedCount,
    uncountedCount: rows.length - countedCount,
    diffCount,
    matchCount,
    totalAbsValue: anyHiddenCost ? null : totalAbs.toString(),
    netValue: anyHiddenCost ? null : net.toString(),
  };
}

/** Baris yang benar-benar dikirim ke createOpnameAction — hanya yang terhitung. */
export function buildOpnamePostingLines(
  rows: OpnameCountRow[],
): {
  productId: string;
  countedQty: string;
  countComponents?: { packagingId: string | null; qty: string }[];
}[] {
  const lines: {
    productId: string;
    countedQty: string;
    countComponents?: { packagingId: string | null; qty: string }[];
  }[] = [];
  for (const row of rows) {
    const countedQty = effectiveCountedQty(row);
    if (countedQty === null) continue;
    const line: (typeof lines)[number] = {
      productId: row.productId,
      countedQty: String(countedQty),
    };
    // S3: komponen campuran ikut dikirim agar domain menyimpan
    // rinciannya (count_breakdown + audit) — komponen lepas menjadi
    // entri packagingId null; komponen kemasan yang kosong tidak
    // dikirim. Tanpa komponen kemasan terisi, payload persis lama.
    const entered = enteredComponents(row);
    if (entered.length > 0) {
      line.countComponents = [
        { packagingId: null, qty: String(parseCountedQty(row.counted) ?? 0) },
        ...entered.map((entry) => ({
          packagingId: entry.pack.id,
          qty: String(entry.qty ?? 0),
        })),
      ];
    }
    lines.push(line);
  }
  return lines;
}

/* ------------------------------------------------------------------ */
/* Draf hitung — disimpan di localStorage per perusahaan+gudang        */
/* (pola snapshot keranjang POS). Domain opname tidak mengenal draf;   */
/* draf di sini murni menunda isian petugas di antara dua langkah,     */
/* posting tetap lewat createOpnameAction yang sama persis.            */
/* ------------------------------------------------------------------ */

export type OpnameDraftRow = {
  productId: string;
  name: string;
  sku: string;
  counted: string;
  /**
   * Harga pokok saat baris dibuat (untuk nilai selisih di tinjauan).
   * null = biaya tidak terlihat saat baris dibuat (K-3); absen = draf
   * format lama. Keduanya diperlakukan "tidak terlihat" oleh form.
   */
  unitCost?: string | null;
  /** S3: konteks satuan baris — draf lama tanpa field ini tetap sah. */
  unitName?: string | null;
  packagings?: OpnamePackagingOption[];
  components?: Record<string, string>;
};

export type OpnameScope = "full" | "cycle";

export type OpnameDraft = {
  warehouseId: string;
  date: string;
  notes: string;
  step: "hitung" | "tinjau";
  /** full = seluruh produk aktif; cycle = subset yang dipilih/dipindai. */
  scope?: OpnameScope;
  /** true setelah "Muat semua" berhasil untuk gudang ini. */
  fullLoaded?: boolean;
  rows: OpnameDraftRow[];
};

export function opnameDraftKey(companyId: string, warehouseId: string): string {
  return `bisa-erp:opname-draft:${companyId}:${warehouseId}`;
}

export function serializeOpnameDraft(draft: OpnameDraft): string {
  return JSON.stringify(draft);
}

function isDraftRow(value: unknown): value is OpnameDraftRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const packagingsOk =
    row.packagings === undefined ||
    (Array.isArray(row.packagings) &&
      row.packagings.every(
        (pack) =>
          typeof pack === "object" &&
          pack !== null &&
          typeof (pack as Record<string, unknown>).id === "string" &&
          typeof (pack as Record<string, unknown>).name === "string" &&
          typeof (pack as Record<string, unknown>).isi === "string",
      ));
  const componentsOk =
    row.components === undefined ||
    (typeof row.components === "object" &&
      row.components !== null &&
      !Array.isArray(row.components) &&
      Object.values(row.components as Record<string, unknown>).every(
        (value) => typeof value === "string",
      ));
  return (
    typeof row.productId === "string" &&
    typeof row.name === "string" &&
    typeof row.sku === "string" &&
    typeof row.counted === "string" &&
    (row.unitCost === undefined || row.unitCost === null || typeof row.unitCost === "string") &&
    (row.unitName === undefined || row.unitName === null || typeof row.unitName === "string") &&
    packagingsOk &&
    componentsOk
  );
}

/** Parse draf tersimpan; bentuk asing/rusak → null (form mulai bersih). */
export function parseOpnameDraft(raw: string | null): OpnameDraft | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const draft = value as Record<string, unknown>;
  if (typeof draft.warehouseId !== "string" || draft.warehouseId === "") return null;
  if (typeof draft.date !== "string") return null;
  if (typeof draft.notes !== "string") return null;
  if (!Array.isArray(draft.rows) || !draft.rows.every(isDraftRow)) return null;
  return {
    warehouseId: draft.warehouseId,
    date: draft.date,
    notes: draft.notes,
    step: draft.step === "tinjau" ? "tinjau" : "hitung",
    scope: draft.scope === "cycle" ? "cycle" : "full",
    fullLoaded: draft.fullLoaded === true,
    rows: draft.rows,
  };
}
