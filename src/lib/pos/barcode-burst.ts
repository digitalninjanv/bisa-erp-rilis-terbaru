/**
 * FIX-POS Tahap 4 (POS2-03): pelacak "ledakan ketik" scanner barcode.
 *
 * Scanner wedge mengetik jauh lebih cepat daripada manusia dan selalu
 * mengakhiri dengan Enter. Modul murni ini menilai aliran keydown
 * berdasarkan KECEPATAN saja — bukan format — sehingga EAN/UPC
 * numerik, Code 128 alfanumerik, SKU, dan kode pendek semuanya
 * dikenali, sementara ketikan manusia (jeda antarhuruf jauh lebih
 * lambat) tidak pernah disalahartikan sebagai pindaian.
 *
 * Kontrak pemakaian (lihat use-barcode-scanner.ts):
 * - Karakter pertama sebuah ledakan "track" (dibiarkan lewat — belum
 *   dapat dibedakan dari ketikan manusia).
 * - Karakter berikutnya yang tiba dalam SCAN_FAST_GAP_MS "swallow"
 *   (dicegah masuk field fokus) — ledakan secepat ini hampir pasti
 *   mesin. Bila ternyata manusia (tidak diakhiri Enter yang memenuhi
 *   syarat), karakter tertelan WAJIB diputar ulang ke field oleh
 *   pemanggil (`swallowed` tidak pernah hilang diam-diam).
 * - Enter menilai ledakan: rata-rata jeda per karakter di bawah
 *   SCAN_MAX_AVG_MS dan panjang minimal SCAN_MIN_LENGTH → pindaian.
 */

/** Panjang minimum kode agar ledakan dinilai pindaian. */
export const SCAN_MIN_LENGTH = 4;
/** Rata-rata jeda maksimum per karakter (ms) untuk menilai pindaian. */
export const SCAN_MAX_AVG_MS = 60;
/** Jeda maksimum (ms) agar karakter lanjutan ditelan sebagai ledakan. */
export const SCAN_FAST_GAP_MS = 50;
/** Jeda (ms) yang mengakhiri ledakan — ketikan berikutnya mulai baru. */
export const SCAN_RESET_GAP_MS = 150;

/**
 * A-24 T3 (pola G1): ambang ledakan kini dapat dipilih per konteks
 * lewat prasetel/opsi, agar pelacak yang sama melayani terminal POS,
 * pemilih produk, dan Mode Operasi gudang (nomor dokumen operasi).
 * TANPA argumen, resolusinya adalah konstanta historis di atas persis —
 * perilaku POS tidak berubah (test POS adalah kontraknya).
 */
export interface BurstThresholds {
  minLength: number;
  maxAvgMs: number;
  fastGapMs: number;
  resetGapMs: number;
}

export type BurstOptions = Partial<BurstThresholds>;

export const BURST_PRESETS = {
  /** Terminal POS & pemilih produk: ambang historis FIX-POS. */
  pos: {
    minLength: SCAN_MIN_LENGTH,
    maxAvgMs: SCAN_MAX_AVG_MS,
    fastGapMs: SCAN_FAST_GAP_MS,
    resetGapMs: SCAN_RESET_GAP_MS,
  },
  /**
   * Nomor dokumen operasi gudang (PO-…, TRF-…, OPN-…): selalu lebih
   * panjang dari kode produk pendek, jadi panjang minimum dinaikkan
   * agar ketikan singkat manusia tidak dinilai pindaian dokumen.
   * Syarat kecepatan sama — scanner yang sama memindai keduanya.
   */
  document: {
    minLength: 6,
    maxAvgMs: SCAN_MAX_AVG_MS,
    fastGapMs: SCAN_FAST_GAP_MS,
    resetGapMs: SCAN_RESET_GAP_MS,
  },
} as const satisfies Record<string, BurstThresholds>;

export type BurstPresetName = keyof typeof BURST_PRESETS;

/** Resolusi ambang efektif: prasetel bernama, opsi parsial di atas
 *  bawaan POS, atau bawaan POS itu sendiri bila kosong. */
export function resolveBurstThresholds(
  options?: BurstOptions | BurstPresetName,
): BurstThresholds {
  if (!options) return BURST_PRESETS.pos;
  if (typeof options === "string") return BURST_PRESETS[options];
  return {
    minLength: options.minLength ?? SCAN_MIN_LENGTH,
    maxAvgMs: options.maxAvgMs ?? SCAN_MAX_AVG_MS,
    fastGapMs: options.fastGapMs ?? SCAN_FAST_GAP_MS,
    resetGapMs: options.resetGapMs ?? SCAN_RESET_GAP_MS,
  };
}

export interface BurstState {
  /** Seluruh karakter terlacak dalam ledakan berjalan. */
  buffer: string;
  /** Karakter yang ditelan pemanggil selama ledakan ini. */
  swallowed: string;
  /** Waktu (ms, jam monoton pemanggil) karakter pertama ledakan. */
  startedAt: number;
  /** Waktu karakter terakhir ledakan. */
  lastAt: number;
}

export function createBurstState(): BurstState {
  return { buffer: "", swallowed: "", startedAt: 0, lastAt: 0 };
}

export function resetBurst(state: BurstState): void {
  state.buffer = "";
  state.swallowed = "";
  state.startedAt = 0;
  state.lastAt = 0;
}

/** Benar bila ledakan berjalan sudah terlalu lama diam untuk dilanjutkan. */
export function burstExpired(
  state: BurstState,
  now: number,
  options?: BurstOptions | BurstPresetName,
): boolean {
  return state.buffer.length > 0 && now - state.lastAt > resolveBurstThresholds(options).resetGapMs;
}

export type BurstCharAction = "track" | "swallow";

/**
 * Umpankan satu karakter tercetak. Pemanggil harus menangani ledakan
 * kedaluwarsa (burstExpired) SEBELUM memanggil ini. Karakter pertama
 * selalu "track"; karakter lanjutan yang tiba cukup cepat "swallow".
 */
export function feedBurstChar(
  state: BurstState,
  char: string,
  now: number,
  options?: BurstOptions | BurstPresetName,
): BurstCharAction {
  if (state.buffer.length === 0) {
    state.buffer = char;
    state.startedAt = now;
    state.lastAt = now;
    return "track";
  }
  const gap = now - state.lastAt;
  state.buffer += char;
  state.lastAt = now;
  if (gap <= resolveBurstThresholds(options).fastGapMs) {
    state.swallowed += char;
    return "swallow";
  }
  return "track";
}

/**
 * Nilai ledakan saat Enter ditekan: kembalikan kode pindaian bila
 * memenuhi syarat kecepatan & panjang, selain itu null. State TIDAK
 * diubah — pemanggil memutuskan (pindaian: buang; bukan pindaian:
 * putar ulang `state.swallowed` lalu resetBurst).
 */
export function burstScanCode(
  state: BurstState,
  now: number,
  options?: BurstOptions | BurstPresetName,
): string | null {
  const thresholds = resolveBurstThresholds(options);
  if (state.buffer.length < thresholds.minLength) return null;
  const duration = now - state.startedAt;
  if (duration / state.buffer.length > thresholds.maxAvgMs) return null;
  return state.buffer;
}
