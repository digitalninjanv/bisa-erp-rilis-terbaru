/**
 * A-24 T3 (pola G1): resolusi pindaian Mode Operasi gudang.
 *
 * Staf memindai barcode operasi (nomor dokumen tercetak pada PO/GRN/
 * surat jalan transfer) → dokumen operasi itu terbuka. Memindai
 * barcode PRODUK → operasi yang memuat produk itu: tepat satu →
 * terbuka; lebih dari satu → daftar pasangan ditampilkan untuk
 * dipilih; nol → tidak ditemukan. Logika murni ini dipakai komponen
 * Mode Operasi; resolusi barcode→produk terjadi lewat pencarian
 * server yang sudah ada sebelum fungsi ini dipanggil.
 */

export type OperationKind = "purchase_order" | "transfer" | "opname_task";

export type OperationRef = {
  kind: OperationKind;
  id: string;
  /** Nomor dokumen persis seperti tercetak (yang dipindai). */
  number: string;
  /** Rute halaman kerja operasi ini. */
  href: string;
  /** Produk yang termuat di operasi (untuk pasangan pindaian produk). */
  productIds: string[];
};

export type OperationScanResult =
  | { type: "open"; operation: OperationRef; via: "number" | "product" }
  | { type: "matches"; operations: OperationRef[] }
  | { type: "none" };

/**
 * @param code teks hasil pindaian/ketikan (nomor dokumen atau kode produk mentah)
 * @param operations antrean operasi yang sedang menunggu
 * @param scannedProduct produk hasil resolusi server atas `code`
 *   (null bila kode bukan barcode/SKU produk yang dikenal)
 */
export function resolveOperationScan(
  code: string,
  operations: OperationRef[],
  scannedProduct: { id: string } | null,
): OperationScanResult {
  const normalized = code.trim().toLowerCase();
  if (!normalized) return { type: "none" };

  const byNumber = operations.find(
    (operation) => operation.number.trim().toLowerCase() === normalized,
  );
  if (byNumber) return { type: "open", operation: byNumber, via: "number" };

  if (scannedProduct) {
    const containing = operations.filter((operation) =>
      operation.productIds.includes(scannedProduct.id),
    );
    if (containing.length === 1) {
      return { type: "open", operation: containing[0], via: "product" };
    }
    if (containing.length > 1) return { type: "matches", operations: containing };
  }

  return { type: "none" };
}
