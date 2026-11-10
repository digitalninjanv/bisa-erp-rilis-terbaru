// FIX-P1 Tahap 4 (AK1-06/AK4-04): resolusi PPN Masukan penerimaan
// dipisah dari receipts.ts agar berkas domain tetap di bawah ratchet
// ukuran. Semua penolakan (PPN nonaktif / tarif 0 / pemetaan hilang)
// tetap terjadi sebelum apa pun ditulis.

import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import { Decimal, d } from "@/lib/money";
import { getAccountId } from "@/server/accounting";
import { getCompanySettingsRow } from "@/server/settings";
import type { ReceiptSource } from "./receipt-journal";

export type ReceiptTaxContext = {
  taxIncluded: boolean;
  taxRate: Decimal;
  /** PPN Masukan nominal eksplisit (ditambahkan di atas DPP baris). */
  explicitTax: Decimal;
  /** PPN dalam persen — dihitung dari total DPP baris. */
  taxPercent: Decimal;
  taxInputAccountId: string | null;
};

/**
 * Validasi mode PPN dokumen penerimaan: inklusif (tarif perusahaan),
 * nominal eksplisit, atau persen (0–100). Harga baris selalu DPP pada
 * dua mode terakhir.
 */
export async function resolveReceiptTax(
  tx: Tx,
  input: {
    companyId: string;
    source: ReceiptSource;
    taxIncluded?: boolean;
    taxAmount?: string | number;
    taxPercent?: string | number;
  },
): Promise<ReceiptTaxContext> {
  const { companyId, source } = input;
  const taxIncluded = input.taxIncluded ?? false;
  const explicitTax = d(input.taxAmount ?? 0);
  const taxPercent = d(input.taxPercent ?? 0);
  if (!explicitTax.isFinite() || explicitTax.lt(0)) {
    throw new AppError("VALIDATION", "PPN Masukan tidak boleh negatif.");
  }
  if (!taxPercent.isFinite() || taxPercent.lt(0) || taxPercent.gt(100)) {
    throw new AppError("VALIDATION", "PPN (%) harus antara 0 dan 100.");
  }
  if (explicitTax.gt(0) && taxIncluded) {
    throw new AppError(
      "VALIDATION",
      "Pilih salah satu: isi nominal PPN Masukan, ATAU centang harga termasuk PPN — tidak keduanya.",
    );
  }
  if (taxPercent.gt(0) && (taxIncluded || explicitTax.gt(0))) {
    throw new AppError(
      "VALIDATION",
      "PPN (%) tidak dapat digabung dengan nominal PPN atau opsi harga termasuk PPN.",
    );
  }
  let taxRate = d(0);
  let taxInputAccountId: string | null = null;
  if (explicitTax.gt(0) || taxPercent.gt(0)) {
    if (source !== "purchase") {
      throw new AppError(
        "VALIDATION",
        "PPN Masukan hanya berlaku untuk penerimaan pembelian dari pemasok.",
      );
    }
    // Akun tidak ditebak; melempar VALIDATION yang menyebut pemetaannya.
    taxInputAccountId = await getAccountId(tx, companyId, "tax_input");
  }
  if (taxIncluded) {
    if (source !== "purchase") {
      throw new AppError(
        "VALIDATION",
        "Penandaan \"harga termasuk PPN\" hanya berlaku untuk penerimaan pembelian dari pemasok.",
      );
    }
    const settings = await getCompanySettingsRow(tx, companyId);
    if (!settings?.taxEnabled) {
      throw new AppError(
        "VALIDATION",
        "Penandaan \"harga termasuk PPN\" dipilih, tetapi PPN perusahaan sedang nonaktif. Aktifkan PPN di Pengaturan terlebih dahulu, atau terima barang tanpa penandaan PPN.",
      );
    }
    taxRate = d(settings.taxRate);
    if (!taxRate.isFinite() || taxRate.lte(0)) {
      throw new AppError(
        "VALIDATION",
        "Penandaan \"harga termasuk PPN\" dipilih, tetapi tarif PPN perusahaan masih 0. Atur tarif PPN di Pengaturan terlebih dahulu.",
      );
    }
    // Melempar VALIDATION yang menyebut pemetaannya bila belum diatur.
    taxInputAccountId = await getAccountId(tx, companyId, "tax_input");
  }
  return {
    taxIncluded,
    taxRate,
    explicitTax,
    taxPercent,
    taxInputAccountId,
  };
}
