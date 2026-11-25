/**
 * Keadaan pembayaran setelah penjualan selesai. Konfirmasi non-tunai adalah
 * atestasi per transaksi dan tidak boleh terbawa ke transaksi berikutnya.
 */
export function paymentStateAfterCompletedSale(): {
  entries: Record<string, never>;
  nonCashConfirmedFor: null;
} {
  return { entries: {}, nonCashConfirmedFor: null };
}
