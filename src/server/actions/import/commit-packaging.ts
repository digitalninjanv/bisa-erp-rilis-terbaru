// S6 (Program Satuan Kemasan): pra-cek kemasan impor produk —
// pecahan commit-phases.ts demi plafon ukuran berkas (pola
// shared.ts/commit-phases.ts: bukan berkas "use server").

import type { Tx } from "@/db";
import { AppError } from "@/lib/errors";
import type { MappedProduct } from "@/lib/import-parse";
import {
  PackagingSyncError,
  planPackagingSync,
  type PackagingInput,
  type PackagingSnapshot,
} from "@/lib/packaging";
import { assertBarcodeAvailable } from "@/server/catalog";

/**
 * S6 — pra-cek kemasan satu baris impor SEBELUM produknya ditulis:
 * mengembalikan daftar kemasan siap serah ke `syncProductPackagings`
 * (id tersimpan dicocokkan lewat NAMA — identitas kemasan di berkas
 * impor), atau melempar AppError yang menjadi pesan gagal baris itu.
 * Pra-cek memakai penjaga domain yang sama dengan formulir produk
 * (rencana sinkron murni + keunikan barcode satu ruang nama), sehingga
 * penerapan sesudah tulis produk tidak menemukan kejutan baru:
 * - barcode kemasan tidak boleh sama dengan barcode dasar baris ini;
 * - barcode harus bebas di seluruh perusahaan (produk & kemasan lain);
 * - kemasan tersimpan yang HILANG dari daftar impor adalah permintaan
 *   hapus — ditolak rencana sinkron bila sudah terpakai transaksi.
 * Semantik daftar impor = daftar kemasan lengkap yang diinginkan
 * untuk produk itu, persis semantik formulir produk.
 */
export async function prepareImportPackagings(
  tx: Tx,
  input: {
    companyId: string;
    value: MappedProduct;
    existingId: string | null;
    current: PackagingSnapshot[];
    usedIds: ReadonlySet<string>;
  },
): Promise<PackagingInput[]> {
  const { companyId, value, existingId } = input;
  const current = input.current;
  const currentByName = new Map(current.map((pack) => [pack.name.toLowerCase(), pack]));
  const submitted: PackagingInput[] = value.packagings.map((pack) => {
    const match = currentByName.get(pack.name.toLowerCase());
    return match ? { ...pack, id: match.id } : { ...pack };
  });

  for (const pack of submitted) {
    if (pack.barcode && value.barcode && pack.barcode === value.barcode) {
      throw new AppError(
        "VALIDATION",
        `Barcode kemasan "${pack.name}" sama dengan barcode satuan dasar produk ini — satu barcode hanya boleh berarti satu hal.`,
      );
    }
    if (pack.barcode) {
      await assertBarcodeAvailable(tx, companyId, pack.barcode, {
        productId: existingId ?? undefined,
        packagingId: pack.id,
      });
    }
  }
  try {
    planPackagingSync(current, submitted, input.usedIds);
  } catch (error) {
    if (error instanceof PackagingSyncError) throw new AppError(error.code, error.message);
    throw error;
  }
  return submitted;
}
