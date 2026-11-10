import type { Decimal } from "@/lib/money";

/** Baris penerimaan setelah konversi kemasan, sebelum ditulis. */
export type EffectiveReceiptLine = {
  productId: string;
  productName: string;
  productSku: string;
  /** Selalu SATUAN DASAR sesudah konversi kemasan. */
  qty: Decimal;
  /** Selalu harga per satuan dasar sesudah konversi kemasan. */
  unitCost: Decimal;
  /** Diskon baris: nominal = total potongan, percent = % dari bruto. */
  discountType: "percent" | "nominal" | null;
  discountValue: Decimal;
  discountAmount: Decimal;
  /** Nilai baris setelah diskon (DPP bila PPN eksplisit). */
  lineNet: Decimal;
  stockUnitCost: Decimal;
  /** Harga jual master per satuan dasar (null = tidak diubah). */
  salePriceBase: Decimal | null;
  taxAmount: Decimal;
  /** Cuplikan kemasan baris (S2); qtyInput = qty sebagaimana dimasukkan. */
  packagingId: string | null;
  qtyInput: string;
  isiSnapshot: string;
  batchNumber: string | null;
  expiryDate: string | null;
  serialNumbers: string[];
};
