import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { paymentMethods } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { d, type D, type MoneyInput } from "@/lib/money";

/**
 * A-21 Tahap R3-A (R3-01, sisa AK3-04): fee/MDR metode pembayaran.
 *
 * Tarif hidup sebagai konfigurasi per perusahaan di payment_methods
 * (fee_enabled + fee_type + fee_value, pola D-25): bawaan mati untuk
 * semua metode = perilaku sebelum fitur ini ada. Konfigurasi hanya
 * memberi NILAI AWAL — nominal fee final diputuskan pengguna di form
 * pembayaran (pola biaya transfer di createBankTransfer: konfigurasi
 * memberi bawaan, manusia memutuskan) dan dibekukan di baris
 * pembayaran (fee_amount), sehingga jurnal, void, dan laporan selalu
 * membaca angka yang sama.
 *
 * Semantik jurnal (fee selalu beban perusahaan, tidak mengurangi hak
 * pihak): penerimaan dipotong dari yang masuk (Dr akun neto + Dr
 * bank_fee / Cr bruto); pembayaran keluar ditambahkan di atas nominal
 * (Dr bruto + Dr bank_fee / Cr bruto + fee).
 */
export type FeeMethodConfig = {
  feeEnabled: boolean;
  feeType: string; // none | fixed | percent
  feeValue: string | number;
};

/** Fee bawaan dari konfigurasi untuk satu nominal dasar pembayaran. */
export function computeConfiguredFee(method: FeeMethodConfig, base: D): D {
  if (!method.feeEnabled) return d(0);
  if (method.feeType === "fixed") return d(method.feeValue);
  if (method.feeType === "percent") {
    // MDR riil dipotong sampai sen — bulatkan persen ke 2 desimal;
    // neto di jurnal selalu base − fee yang sama, jadi jurnal tetap
    // seimbang persis berapa pun hasil pembulatannya.
    return base.mul(d(method.feeValue)).div(100).toDecimalPlaces(2);
  }
  return d(0);
}

type FeeMethodRow = FeeMethodConfig & { id: string; name: string };

async function findMethodById(tx: Tx, companyId: string, methodId: string) {
  const [row] = await tx
    .select({
      id: paymentMethods.id,
      name: paymentMethods.name,
      feeEnabled: paymentMethods.feeEnabled,
      feeType: paymentMethods.feeType,
      feeValue: paymentMethods.feeValue,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.companyId, companyId), eq(paymentMethods.id, methodId)))
    .limit(1);
  return row as FeeMethodRow | undefined;
}

async function findMethodByAccount(tx: Tx, companyId: string, accountId: string) {
  // Pembayaran pihak memilih AKUN, bukan metode — metode pemilik akun
  // itulah yang konfigurasinya berlaku. Bila beberapa metode aktif
  // berbagi satu akun, yang pertama menurut urutan tampil metode
  // dipakai (deterministik; pemilik mengatur satu metode berfee per
  // akun agar tidak ambigu).
  const [row] = await tx
    .select({
      id: paymentMethods.id,
      name: paymentMethods.name,
      feeEnabled: paymentMethods.feeEnabled,
      feeType: paymentMethods.feeType,
      feeValue: paymentMethods.feeValue,
    })
    .from(paymentMethods)
    .where(
      and(
        eq(paymentMethods.companyId, companyId),
        eq(paymentMethods.accountId, accountId),
        eq(paymentMethods.isActive, true),
      ),
    )
    .orderBy(asc(paymentMethods.sortOrder), asc(paymentMethods.createdAt))
    .limit(1);
  return row as FeeMethodRow | undefined;
}

/**
 * Tentukan fee final satu pembayaran:
 * - `explicitFee` terisi (termasuk "0") → keputusan pengguna; wajib 0
 *   bila metode tidak berfee aktif (D-25: komponen nonaktif tidak
 *   dijurnal — fee yang dipaksakan ke metode nonaktif ditolak, bukan
 *   diam-diam dibuang).
 * - `explicitFee` kosong → bawaan konfigurasi metode (0 bila nonaktif
 *   atau akun tidak terhubung metode apa pun).
 */
export async function resolvePaymentFee(
  tx: Tx,
  companyId: string,
  opts: {
    methodId?: string;
    accountId?: string;
    base: D;
    explicitFee?: MoneyInput;
  },
): Promise<{ fee: D; method: FeeMethodRow | null }> {
  let method: FeeMethodRow | undefined;
  if (opts.methodId) {
    method = await findMethodById(tx, companyId, opts.methodId);
    if (!method) throw new AppError("VALIDATION", "Metode pembayaran tidak ditemukan di perusahaan ini.");
  } else if (opts.accountId) {
    method = await findMethodByAccount(tx, companyId, opts.accountId);
  }
  const feeActive = Boolean(method?.feeEnabled && method.feeType !== "none");

  if (opts.explicitFee !== undefined && opts.explicitFee !== null && opts.explicitFee !== "") {
    const fee = d(opts.explicitFee);
    if (!fee.isFinite() || fee.lt(0)) {
      throw new AppError("VALIDATION", "Biaya (fee) pembayaran tidak boleh negatif.");
    }
    if (fee.gt(0) && !feeActive) {
      throw new AppError(
        "VALIDATION",
        method
          ? `Fee tidak aktif untuk metode ${method.name}. Aktifkan tarif fee metode ini di Pengaturan bila pembayaran memang dipotong fee.`
          : "Akun ini tidak terhubung ke metode pembayaran berfee aktif, jadi fee tidak dapat dicatat. Aktifkan tarif fee pada metode pemilik akun ini di Pengaturan.",
      );
    }
    return { fee, method: method ?? null };
  }
  return { fee: feeActive && method ? computeConfiguredFee(method, opts.base) : d(0), method: method ?? null };
}
