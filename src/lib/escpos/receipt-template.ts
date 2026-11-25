import { EscPosEncoder } from "./encoder";
import type { ReceiptData, SessionReportData } from "./types";
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

  const outstanding = data.outstanding ?? data.payments
    .filter((payment) => payment.methodType === "credit")
    .reduce((sum, payment) => sum + payment.amount, 0);
  if (outstanding > 0) {
    encoder.bold(true).row("Sisa utang:", formatIDR(outstanding)).bold(false);
    encoder.row("Status:", "BELUM LUNAS");
  }
  // Kembalian
  if (data.change > 0) {
    encoder.bold(true).row("KEMBALIAN:", formatIDR(data.change)).bold(false);
  } else if (outstanding <= 0) {
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
    // Standard ESC/POS ignores ESC a for GS ( k. Centering requires margin offset.
    // 58mm: 384 dots wide, module 4 is ~104 dots -> offset ~140 dots
    // 80mm: 576 dots wide, module 4 is ~104 dots -> offset ~236 dots
    const offset = paper === "80mm" ? 236 : 140;
    encoder.leftMargin(offset);
    encoder.qrCode(data.saleNumber);
    encoder.leftMargin(0);
    encoder.align("center").line(data.saleNumber);
  }

  // 8. Pakan Kertas & Potong (Cutter)
  if (data.cutPaper !== false) {
    encoder.cut();
  } else {
    encoder.feed(4);
  }

  return encoder.encode();
}

/**
 * Susun payload ESC/POS untuk halaman uji coba koneksi printer thermal.
 */
export function buildTestReceiptEscPos(params: {
  paperWidth: "58mm" | "80mm";
  type: string;
  cutPaper: boolean;
}): Uint8Array {
  const encoder = new EscPosEncoder(params.paperWidth);
  encoder
    .init()
    .align("center")
    .bold(true)
    .size(false, true)
    .line("BISA ERP POS")
    .size(false, false)
    .bold(false)
    .line("Uji Coba Printer Thermal")
    .divider("=")
    .align("left")
    .row("Status Koneksi :", "TERHUBUNG")
    .row("Tipe Printer   :", params.type.toUpperCase())
    .row("Lebar Kertas   :", params.paperWidth)
    .row("Waktu Uji      :", new Date().toLocaleTimeString("id-ID"))
    .divider("-")
    .align("center")
    .line("Printer siap digunakan!")
    .line("Cetak cepat tanpa dialog aktif.")
    .divider("=")
    .feed(2);

  if (params.cutPaper) {
    encoder.cut();
  } else {
    encoder.feed(3);
  }
  return encoder.encode();
}

/**
 * Format laporan tutup sesi kasir (Z-Report) atau laporan sementara (X-Report)
 * menjadi deretan byte ESC/POS siap kirim ke printer thermal 58mm / 80mm.
 */
export function formatSessionReportToEscPos(data: SessionReportData): Uint8Array {
  const paper = data.paperWidth ?? "58mm";
  const encoder = new EscPosEncoder(paper);

  encoder.init();
  encoder.align("center").bold(true).size(false, true).line(data.companyName).size(false, false).bold(false);
  if (data.address) encoder.line(data.address);
  if (data.phone) encoder.line(`Telp: ${data.phone}`);

  encoder.divider("=");
  encoder.align("center").bold(true);
  encoder.line(data.isX ? "LAPORAN SEMENTARA (X)" : "LAPORAN TUTUP SESI (Z)");
  encoder.bold(false).line(`SESI: ${data.sessionId.slice(0, 8).toUpperCase()}`);
  encoder.divider("-");

  encoder.align("left");
  if (data.cashierName) encoder.row("Kasir   :", data.cashierName);
  if (data.branchName) encoder.row("Cabang  :", data.branchName);
  encoder.row("Buka    :", data.openedAt);
  if (data.closedAt) encoder.row("Tutup   :", data.closedAt);

  encoder.divider("-");
  encoder.bold(true).line("RINGKASAN PENJUALAN").bold(false);
  encoder.row("Jumlah Transaksi :", String(data.totals.salesCount));
  encoder.row("Penjualan Tunai  :", formatIDR(data.totals.cashSales));
  encoder.row("Penjualan Non-Tun:", formatIDR(data.totals.nonCashSales));
  encoder.bold(true).row("TOTAL PENJUALAN  :", formatIDR(data.totals.totalSales)).bold(false);

  if (data.paymentBreakdown.length > 0) {
    encoder.divider("-");
    encoder.bold(true).line("RINCIAN METODE BAYAR").bold(false);
    for (const p of data.paymentBreakdown) {
      encoder.row(p.methodName, formatIDR(p.amount));
    }
  }

  encoder.divider("-");
  encoder.bold(true).line("KAS FISIK LACI").bold(false);
  encoder.row("Modal Awal      :", formatIDR(data.openingCash));
  if (data.totals.cashIn > 0) encoder.row("Kas Masuk (+)   :", formatIDR(data.totals.cashIn));
  if (data.totals.cashOut > 0) encoder.row("Kas Keluar (-)  :", formatIDR(data.totals.cashOut));
  encoder.row("Ekspektasi Kas  :", formatIDR(data.expectedCash));
  if (data.closingCash != null) {
    encoder.bold(true).row("Kas Dihitung    :", formatIDR(data.closingCash)).bold(false);
    const diff = data.cashDifference ?? 0;
    if (diff !== 0) {
      encoder.bold(true).row(diff > 0 ? "LEBIH FISIK (+):" : "SELISIH FISIK (-):", formatIDR(Math.abs(diff))).bold(false);
      if (data.differenceReason) encoder.line(`Alasan: ${data.differenceReason}`);
    } else {
      encoder.row("Selisih Fisik   :", "Rp 0 (PAS)");
    }
  }

  encoder.divider("=");
  encoder.align("center");
  encoder.line("Dicetak otomatis oleh Sistem POS");
  encoder.feed(3);
  encoder.cut();

  return encoder.encode();
}
