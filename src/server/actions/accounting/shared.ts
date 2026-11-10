// A-26 Q4 (K-03): helper bersama antar berkas aksi akuntansi (bukan berkas "use server": hanya fungsi murni yang dipakai berkas-berkas aksi di folder ini).

import { AppError } from "@/lib/errors";

import { d } from "@/lib/money";

/**
 * A-21 Tahap R3-A (R3-06): rakit input potongan pajak dari field aksi
 * yang datar. Nominal 0/kosong = tanpa potongan; nominal terisi tanpa
 * jenis adalah kesalahan pengguna yang harus terdengar.
 */
export function buildWithholdingInput(data: {
  withholdingType?: string;
  withholdingRate?: string;
  withholdingAmount?: string;
}) {
  if (!data.withholdingAmount || d(data.withholdingAmount).lte(0)) return undefined;
  if (!data.withholdingType) {
    throw new AppError("VALIDATION", "Pilih jenis potongan pajak (PPh 23 / PPh 4(2)) bila nominal potongan diisi.");
  }
  return {
    type: data.withholdingType,
    rate: data.withholdingRate,
    amount: data.withholdingAmount,
  };
}
