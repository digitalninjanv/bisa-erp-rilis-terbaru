import { EscPosEncoder } from "./encoder";
import type { ReceiptData } from "./types";
import { formatIDR, formatNumber } from "@/lib/money";

/**
 * Format data nota penjualan menjadi deretan byte ESC/POS siap kirim ke printer thermal.
 */
export function formatReceiptToEscPos(data: ReceiptData): Uint8Array {
  const paper = data.paperWidth ?? "58mm";
  const encoder = new EscPosEncoder(paper);

  // 1. Inisialisasi & Pembuka Laci Kasir (bila ada pembayaran tunai)
  encoder.init();
  const hasCash = data.payments.some(
    (p) => p.methodType === "cash" || p.methodName.toLowerCase().includes("tunai") || p.methodName.toLowerCase().includes("cash"),
  );
  if (data.openCashDrawer && hasCash) {
    encoder.pulseDrawer();
  }

  // 2. Kop Toko / Perusahaan
  encoder.align("center").bold(true).size(false, true).line(data.companyName).size(false, false).bold(false);

  if (data.address) {
    encoder.line(data.address);
  }
  if (data.phone) {
    encoder.line(`Telp: ${data.phone}`);
  }
  if (data.headerText) {
    encoder.line(data.headerText);
  }

  encoder.divider("=");

  if ((data.copyIndex ?? 0) > 0) {
    encoder.align("center").bold(true).line("SALINAN").bold(false);
    encoder.line("- BUKAN NOTA ASLI -");
    encoder.align("left").divider("-");
  }

  // 3. Metadata Transaksi
  encoder.align("left");
  encoder.row("No. Nota:", data.saleNumber);
  encoder.row("Tanggal :", data.date);

  if (data.showCashier && data.cashierName) {
    encoder.row("Kasir   :", data.cashierName);
  }
  if (data.showCustomer && data.customerName) {
    encoder.row("Pelanggan:", data.customerName);
  }

  encoder.divider("-");

  // 4. Daftar Item Produk
  for (const item of data.lines) {
    // Baris 1: Nama produk
    encoder.line(item.name);

    // Baris 2: Qty x Harga Satuan -> Subtotal
    const unitPart = item.unit ? ` ${item.unit}` : "";
    const qtyPrice = `  ${formatNumber(item.qty)}${unitPart} x ${formatIDR(item.price)}`;
    const subtotalText = formatIDR(item.subtotal);
    encoder.row(qtyPrice, subtotalText);

    // Baris 3: Diskon jika ada
    if (item.discount && item.discount > 0) {
      encoder.row(`  (Diskon)`, `-${formatIDR(item.discount)}`);
    }
  }

  encoder.divider("-");

  // 5. Total & Pembayaran
  if (data.discountTotal && data.discountTotal > 0) {
    encoder.row("Subtotal:", formatIDR(data.subtotal));
    encoder.row("Total Diskon:", `-${formatIDR(data.discountTotal)}`);
  }

  if (data.showTax && data.taxTotal && data.taxTotal > 0) {
    encoder.row("PPN (Pajak):", formatIDR(data.taxTotal));
  }

  // TOTAL (Tebal & Lebih Besar)
  encoder.bold(true).size(false, true).row("TOTAL:", formatIDR(data.total)).size(false, false).bold(false);

  encoder.divider("-");

  // Rincian Pembayaran
  for (const pay of data.payments) {
    const payLabel = `Bayar (${pay.methodName}):`;
    encoder.row(payLabel, formatIDR(pay.tendered ?? pay.amount));
  }

  // Kembalian
  if (data.change > 0) {
    encoder.bold(true).row("KEMBALIAN:", formatIDR(data.change)).bold(false);
  } else {
    encoder.row("Status:", "LUNAS");
  }

  encoder.divider("=");

  // 6. Catatan Kaki / Footer
  encoder.align("center");
  if (data.footerText) {
    encoder.line(data.footerText);
  } else {
    encoder.line("Terima kasih atas kunjungan Anda!");
    encoder.line("Barang yang sudah dibeli");
    encoder.line("tidak dapat ditukar/dikembalikan.");
  }

  // 7. QR Code (Opsional)
  if (data.showQr) {
    encoder.feed(1);
    encoder.qrCode(data.saleNumber);
    encoder.line(data.saleNumber);
  }

  // 8. Pakan Kertas & Potong (Cutter)
  if (data.cutPaper !== false) {
    encoder.cut();
  } else {
    encoder.feed(4);
  }

  return encoder.encode();
}
