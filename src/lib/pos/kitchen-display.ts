/** Kitchen/preparation display — kontrak murni untuk POS desktop.
 *
 * Tiket dapur dibangun dari penjualan yang sudah terposting. Tidak ada
 * status "ready" di server saat ini, jadi tiket baru disebut "baru" dan
 * ditandai sudah terlihat setelah kasir membuka layar dapur. Ini
 * sesuai pola preparation display Odoo (antrian + waktu + items) dan
 * Kitchen Display Accurate (urutan datang + penanda usia pesanan).
 */

export type KitchenTicketLine = {
  productName: string;
  qty: number;
  unitCode: string | null;
  packagingName: string | null;
};

export type KitchenTicket = {
  saleId: string;
  number: string;
  createdAt: string;
  lines: KitchenTicketLine[];
};

export type KitchenTicketSource = {
  id: string;
  number: string;
  createdAt: Date | string;
  lines: Array<{
    productName: string | null;
    qty: string | number;
    unitCode?: string | null;
    packagingName?: string | null;
  }>;
};

/** Urutkan tiket dari yang paling lama (FIFO dapur) dan buang yang kosong. */
export function buildKitchenTickets(sales: KitchenTicketSource[]): KitchenTicket[] {
  return sales
    .map((sale) => ({
      saleId: sale.id,
      number: sale.number,
      createdAt:
        sale.createdAt instanceof Date ? sale.createdAt.toISOString() : String(sale.createdAt),
      lines: sale.lines
        .filter((line) => Number(line.qty) > 0)
        .map((line) => ({
          productName: line.productName || "Produk tanpa nama",
          qty: Number(line.qty),
          unitCode: line.unitCode ?? null,
          packagingName: line.packagingName ?? null,
        })),
    }))
    .filter((ticket) => ticket.lines.length > 0)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Label usia tiket untuk penanda dapur (menit). */
export function kitchenTicketAgeLabel(createdAt: string, now = new Date()): string {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return "waktu tidak diketahui";
  const minutes = Math.max(0, Math.floor((now.getTime() - created) / 60_000));
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  return `${hours} jam ${minutes % 60} menit lalu`;
}
