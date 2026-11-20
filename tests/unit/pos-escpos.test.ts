import { describe, expect, it } from "vitest";
import { EscPosEncoder } from "@/lib/escpos/encoder";
import { formatReceiptToEscPos, formatSessionReportToEscPos } from "@/lib/escpos/receipt-template";
import type { ReceiptData, SessionReportData } from "@/lib/escpos/types";

describe("ESC/POS Encoder & Thermal Receipt Engine", () => {
  it("menginisialisasi buffer dengan ESC @ (0x1B, 0x40)", () => {
    const encoder = new EscPosEncoder("58mm");
    const bytes = encoder.encode();
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
  });

  it("menghasilkan baris 2-kolom dengan padding spasi pas 32 karakter pada 58mm", () => {
    const encoder = new EscPosEncoder("58mm");
    encoder.row("Total", "Rp 15.000");
    const bytes = encoder.encode();
    // Cari teks di dalam bytes (abaikan ESC @ diawal)
    const str = Buffer.from(bytes).toString("latin1");
    // "Total" + spasi + "Rp 15.000\n"
    expect(str).toContain("Total");
    expect(str).toContain("Rp 15.000");
    const line = str.split("\n")[0].replace(/^\x1b@/, "");
    expect(line.length).toBe(32);
  });

  it("menghasilkan baris 2-kolom dengan padding spasi pas 48 karakter pada 80mm", () => {
    const encoder = new EscPosEncoder("80mm");
    encoder.row("Subtotal Belanja", "Rp 150.000");
    const bytes = encoder.encode();
    const str = Buffer.from(bytes).toString("latin1");
    expect(str).toContain("Subtotal Belanja");
    expect(str).toContain("Rp 150.000");
    const line = str.split("\n")[0].replace(/^\x1b@/, "");
    expect(line.length).toBe(48);
  });

  it("perintah buka laci kasir (pulseDrawer) menghasilkan ESC p 0 25 250", () => {
    const encoder = new EscPosEncoder("58mm");
    encoder.pulseDrawer();
    const bytes = encoder.encode();
    // Cek keberadaan sequence [0x1b, 0x70, 0x00, 0x19, 0xfa]
    let found = false;
    for (let i = 0; i < bytes.length - 4; i++) {
      if (
        bytes[i] === 0x1b &&
        bytes[i + 1] === 0x70 &&
        bytes[i + 2] === 0x00 &&
        bytes[i + 3] === 0x19 &&
        bytes[i + 4] === 0xfa
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("formatReceiptToEscPos menyusun nota lengkap 58mm dengan pemotong kertas", () => {
    const sampleReceipt: ReceiptData = {
      companyName: "Minimarket Barokah",
      address: "Jl. Merdeka No. 10",
      phone: "08123456789",
      saleNumber: "POS-2026-00001",
      date: "16 Nov 2026",
      cashierName: "Siti",
      lines: [
        {
          name: "Minyak Goreng 2L",
          qty: 1,
          price: 34000,
          subtotal: 34000,
        },
        {
          name: "Gula Pasir 1kg",
          qty: 2,
          price: 15000,
          subtotal: 30000,
        },
      ],
      subtotal: 64000,
      total: 64000,
      payments: [
        {
          methodName: "Tunai",
          methodType: "cash",
          amount: 64000,
          tendered: 70000,
        },
      ],
      change: 6000,
      paperWidth: "58mm",
      showCashier: true,
      openCashDrawer: true,
      cutPaper: true,
    };

    const bytes = formatReceiptToEscPos(sampleReceipt);
    expect(bytes.length).toBeGreaterThan(50);
    const text = Buffer.from(bytes).toString("latin1");

    expect(text).toContain("Minimarket Barokah");
    expect(text).toContain("POS-2026-00001");
    expect(text).toContain("Minyak Goreng 2L");
    expect(text).toContain("Gula Pasir 1kg");
    expect(text).toContain("TOTAL:");
    expect(text).toContain("KEMBALIAN:");
    expect(text).toContain("Terima kasih");

    // Pemotong kertas GS V (0x1D, 0x56) ada di akhir
    expect(bytes[bytes.length - 2]).toBe(0x42);
    expect(bytes[bytes.length - 1]).toBe(0x00);
  });

  it("melakukan transliterasi karakter non-ASCII (em-dash, bullet, aksen) ke ASCII bersih", () => {
    const encoder = new EscPosEncoder("58mm");
    encoder.line("Kopi Robusta — 250g • Café “Spesial”");
    const bytes = encoder.encode();
    const str = Buffer.from(bytes).toString("latin1");
    expect(str).toContain("Kopi Robusta - 250g * Cafe \"Spesial\"");
    expect(str).not.toContain("Kopi Robusta   250g");
  });

  it("formatSessionReportToEscPos menyusun Z-Report lengkap untuk printer thermal 58mm", () => {
    const sessionData: SessionReportData = {
      companyName: "Minimarket Barokah",
      address: "Jl. Merdeka No. 10",
      phone: "08123456789",
      isX: false,
      sessionId: "sess-abc12345-6789",
      cashierName: "Budi Santoso",
      branchName: "Cabang Utama",
      openedAt: "2026-11-20 08:00",
      closedAt: "2026-11-20 16:00",
      openingCash: 200000,
      closingCash: 1250000,
      expectedCash: 1250000,
      cashDifference: 0,
      totals: {
        salesCount: 45,
        cashSales: 1050000,
        nonCashSales: 500000,
        totalSales: 1550000,
        cashIn: 0,
        cashOut: 0,
      },
      paymentBreakdown: [
        { methodName: "Tunai", amount: 1050000 },
        { methodName: "QRIS", amount: 500000 },
      ],
      paperWidth: "58mm",
    };

    const bytes = formatSessionReportToEscPos(sessionData);
    expect(bytes.length).toBeGreaterThan(100);
    const text = Buffer.from(bytes).toString("latin1");

    expect(text).toContain("Minimarket Barokah");
    expect(text).toContain("LAPORAN TUTUP SESI (Z)");
    expect(text).toContain("Budi Santoso");
    expect(text).toContain("RINGKASAN PENJUALAN");
    expect(text).toContain("TOTAL PENJUALAN");
    expect(text).toContain("KAS FISIK LACI");
    expect(text).toContain("PAS");
  });
});
