import { d, formatIDR, type Decimal, type MoneyInput } from "@/lib/money";

/**
 * A-22 Tahap K4 (UX-09 audit + Pola 5 riset): logika PENYAJIAN murni
 * dialog pembayaran piutang/utang (PaymentForm) — arah uang untuk
 * label akun, dan keputusan penyelesaian sisa pada pembayaran parsial.
 * Mesin domain A-21 (fee/withholding/kredit/write-off) TIDAK berubah;
 * modul ini hanya memutuskan apa yang ditampilkan & pilihan apa yang
 * sah ditawarkan. Write-off di sini selalu memanggil aksi write-off
 * A-21 yang sama persis dengan tombol "Write-off sisa".
 */

export type PaymentDirectionKind =
  | "receivable"
  | "payable"
  | "opening-payable"
  | "opening-receivable"
  | "expense-payable";

/** Piutang = uang MASUK ke akun; utang/beban = uang KELUAR dari akun. */
export function paymentDirection(kind: PaymentDirectionKind): "in" | "out" {
  return kind === "receivable" || kind === "opening-receivable" ? "in" : "out";
}

/**
 * Label pemilih akun kas/bank mengikuti arah uang. Sebelum K4 labelnya
 * selalu "Masuk ke" — termasuk pada dialog pembayaran utang (uang
 * keluar), temuan UX-09 audit.
 */
export function paymentAccountLabel(kind: PaymentDirectionKind): string {
  return paymentDirection(kind) === "in" ? "Masuk ke" : "Bayar dari";
}

export type PartialSettlement =
  | { kind: "none" }
  | {
      kind: "partial";
      remainder: Decimal;
      writeOffEligible: boolean;
      /** Kalimat penjelasan siap tampil bila write-off tidak dapat
       * ditawarkan; null bila eligible. BUKAN opsi mati — pengguna
       * selalu tahu mengapa sisanya hanya bisa dibiarkan terbuka. */
      writeOffBlockedReason: string | null;
    };

/**
 * Keputusan sisa untuk nominal yang sedang diketik pengguna.
 * "none" = bukan parsial (nol/penuh/lebih — kelebihan sudah dijelaskan
 * jalur kredit pihak yang ada). Eligibilitas write-off meniru penjaga
 * halaman & domain A-21 persis: izin accounting.manage (canWriteOff),
 * ambang perusahaan > 0, dan SISA SESUDAH pembayaran ini (bukan sisa
 * dokumen saat ini) tidak melebihi ambang.
 */
export function partialSettlement(input: {
  outstanding: MoneyInput;
  amount: MoneyInput;
  canWriteOff: boolean;
  writeOffMaxAmount: MoneyInput;
}): PartialSettlement {
  const outstanding = d(input.outstanding ?? 0);
  const amount = d(input.amount ?? 0);
  if (!amount.gt(0) || !amount.lt(outstanding)) return { kind: "none" };
  const remainder = outstanding.minus(amount);
  const max = d(input.writeOffMaxAmount ?? 0);
  if (!input.canWriteOff) {
    return {
      kind: "partial",
      remainder,
      writeOffEligible: false,
      writeOffBlockedReason:
        "Tutup sisa sebagai write-off memerlukan izin accounting.manage — sisa hanya dapat dibiarkan terbuka.",
    };
  }
  if (!max.gt(0)) {
    return {
      kind: "partial",
      remainder,
      writeOffEligible: false,
      writeOffBlockedReason:
        "Write-off belum diaktifkan perusahaan (ambang masih Rp 0 di Pengaturan) — sisa hanya dapat dibiarkan terbuka.",
    };
  }
  if (remainder.gt(max)) {
    return {
      kind: "partial",
      remainder,
      writeOffEligible: false,
      writeOffBlockedReason: `Sisa ${formatIDR(remainder)} melebihi ambang write-off perusahaan ${formatIDR(max)} — sisa tetap terbuka sesudah pembayaran ini.`,
    };
  }
  return { kind: "partial", remainder, writeOffEligible: true, writeOffBlockedReason: null };
}

/**
 * A-24 T4 — kalimat inti potongan pajak (withholding) yang SAMA di
 * semua form pembayaran (form per dokumen & input cepat), agar
 * penjelasan konsepnya tidak berdrift antar form: potongan bukan
 * diskon — ia menjadi utang PPh dipotong yang disetor terpisah.
 */
export const WITHHOLDING_CORE_NOTE =
  "Potongan menjadi utang PPh dipotong yang disetor terpisah; nominal final yang terisi di sini dijurnal sebagai utang PPh dipotong.";
