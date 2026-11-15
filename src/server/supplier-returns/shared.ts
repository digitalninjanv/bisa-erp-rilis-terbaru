// A-24 Tahap T4B: bagian dari pemecahan src/server/supplier-returns.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/supplier-returns.ts.

import { supplierReturns } from "@/db/schema";
import { type Decimal } from "@/lib/money";

export const SUPPLIER_RETURN_REASON_LABELS: Record<string, string> = {
  damaged: "Rusak",
  expired: "Kedaluwarsa",
  wrong_item: "Salah kirim",
  over_delivery: "Kelebihan kirim",
  quality: "Kualitas tidak sesuai",
  other: "Lainnya",
};

export const SUPPLIER_RETURN_RESOLUTION_LABELS: Record<string, string> = {
  replacement: "Diganti barang baru",
  next_purchase_credit: "Potong utang pembelian berikutnya",
  purchase_advance: "Jadikan uang muka pembelian berikutnya",
  refund: "Refund tunai/transfer",
  other: "Lainnya (catatan bebas)",
};

export type SupplierReturnRow = typeof supplierReturns.$inferSelect;

/* ------------------------------------------------------------------ */
/* Open-payable bookkeeping (shared with listPayables & payments)      */
/* ------------------------------------------------------------------ */

export function DecimalMin(a: Decimal, b: Decimal): Decimal {
  return a.lt(b) ? a : b;
}

/* ------------------------------------------------------------------ */
/* GDG1-01 — plafon asal-usul (provenance) retur                       */
/* ------------------------------------------------------------------ */

/** Status retur yang qty-nya sudah benar-benar keluar dari perusahaan. */
export { POSTED_RETURN_STATUSES } from "@/lib/supplier-return-status";

/**
 * A-26 Q1b (D-07): format qty untuk pesan validasi retur — presisi
 * PENUH tanpa pemisah ribuan (integer tanpa desimal; pecahan apa
 * adanya persis seperti tercatat). SENGAJA berbeda dari `formatQty`
 * di lib/money (tampilan id-ID, maks 3 desimal): pesan kesalahan
 * harus menunjukkan qty sesungguhnya. Nama dibedakan agar keduanya
 * tidak tertukar impor — sebelumnya fungsi ini juga bernama
 * `formatQty` dengan perilaku berbeda (jebakan nama).
 */
export function formatQtyExact(value: Decimal): string {
  return value.isInteger() ? value.toFixed(0) : value.toString();
}
