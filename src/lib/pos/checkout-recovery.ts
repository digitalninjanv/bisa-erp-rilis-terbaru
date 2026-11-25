/**
 * Kontrak pemulihan checkout POS.
 *
 * Server action mengembalikan `AppError` hanya setelah transaksi di-rollback;
 * semuanya adalah hasil definitif. Hanya kegagalan transport/unknown yang boleh
 * tetap disimpan sebagai percobaan pending untuk diperiksa ulang.
 */
const DEFINITIVE_CHECKOUT_CODES = new Set([
  "VALIDATION",
  "NOT_FOUND",
  "INVALID_STATE",
  "INSUFFICIENT_STOCK",
  "PERIOD_CLOSED",
  "CONFLICT",
  "ALREADY_POSTED",
]);

export function isDefinitiveCheckoutError(code: string | null | undefined): boolean {
  return code != null && DEFINITIVE_CHECKOUT_CODES.has(code);
}

/**
 * Pesan server saat dokumen tahanan sudah tidak ada/berubah. Terminal harus
 * melepaskan tautan tahanan agar kasir dapat melanjutkan transaksi baru tanpa
 * memuat ulang halaman.
 */
export function isHeldSaleUnavailableMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return /pesanan tahanan sudah diselesaikan atau tidak tersedia/i.test(message);
}
