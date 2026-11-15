import { d } from "@/lib/money";
import type { PickedPackaging } from "@/components/gudang/product-picker";

export type LabelOption = { value: string; label: string };

export type BatchOption = { id: string; batchNumber: string | null; expiryDate: string | null; qty: string };

export type ReturnLine = {
  key: number;
  productId: string;
  name: string;
  sku: string;
  qty: string;
  trackBatch: boolean;
  batchId: string;
  stock: number | null;
  batches: BatchOption[];
  /** Harga pokok master produk saat dipilih — HANYA untuk perkiraan
   * nilai retur hidup di rel ringkasan. Nilai posting tetap dibekukan
   * domain dari AVCO berjalan; field ini tidak dikirim ke server.
   * null = harga pokok tidak terlihat bagi petugas (tanpa
   * inventory.cost, R3 K-3) — perkiraan nilai disembunyikan. */
  unitCost: string | null;
  /** Satuan kemasan (S2): kemasan aktif produk + pilihan baris ini.
   * qty baris dinyatakan dalam kemasan terpilih; kosong = satuan dasar. */
  packagings: PickedPackaging[];
  packagingId: string;
  /** Jejak ke baris penerimaan asal saat retur dimulai dari GRN. */
  receiptLineId?: string | null;
  /** Batas sisa dari baris faktur asal; ditegakkan lagi saat posting. */
  returnableQty?: string;
  /** Batch dan jumlah fisik pada penerimaan asal, bila lot tercatat. */
  sourceBatchId?: string | null;
  sourceBatchNumber?: string | null;
  sourceExpiryDate?: string | null;
  sourceBatchQty?: string | null;
};

export type InitialReturnLine = {
  receiptLineId: string;
  productId: string;
  name: string;
  sku: string;
  qty: string;
  returnableQty: string;
  trackBatch: boolean;
  sourceBatchId?: string | null;
  sourceBatchNumber?: string | null;
  sourceExpiryDate?: string | null;
  sourceBatchQty?: string | null;
  unitCost?: string | null;
};

export function returnLineMaxQty(line: ReturnLine): string | undefined {
  if (!line.trackBatch) return line.returnableQty;
  if (line.receiptLineId) {
    const selected = line.batches.find((batch) => batch.id === line.batchId);
    const available = line.sourceBatchId ? line.sourceBatchQty : selected?.qty;
    if (!line.batchId || available == null) return "0";
    const invoiceRemaining = d(line.returnableQty ?? 0);
    const batchAvailable = d(available);
    return (invoiceRemaining.lt(batchAvailable) ? invoiceRemaining : batchAvailable).toFixed(4);
  }
  if (!line.batchId) return undefined;
  return line.batches.find((batch) => batch.id === line.batchId)?.qty;
}

/** Qty baris retur dalam SATUAN DASAR (qty masukan × isi kemasan). */
export function returnLineBaseQty(line: ReturnLine) {
  const pack = line.packagings.find((row) => row.id === line.packagingId);
  const qty = displayDecimal(line.qty);
  return pack ? qty.mul(d(pack.isi)) : qty;
}

/** Perkiraan nilai satu baris; null bila harga pokok tidak terlihat. */
export function lineEstimatedValue(line: ReturnLine) {
  return line.unitCost === null
    ? null
    : returnLineBaseQty(line).mul(displayDecimal(line.unitCost));
}

/** Parse aman untuk tampilan hidup: ketikan qty yang belum terbaca
 * angka dinilai 0 di ringkasan (validasi kirim tetap jalan asal). */
export function displayDecimal(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? d(parsed) : d(0);
}

