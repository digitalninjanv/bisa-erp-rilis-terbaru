import { describe, expect, it } from "vitest";
import {
  partialSettlement,
  paymentAccountLabel,
  paymentDirection,
} from "@/lib/payment-settlement";

/**
 * A-22 Tahap K4 (UX-09 audit / UX-10 mandat + Pola 5): label akun pada
 * dialog pembayaran mengikuti ARAH uang (piutang = "Masuk ke", utang =
 * "Bayar dari"), dan pembayaran parsial memaksa keputusan eksplisit
 * atas sisanya — biarkan terbuka vs tutup sebagai write-off bila jalur
 * sah A-21 tersedia. Logika keputusan murni di lib agar teruji unit;
 * komponen hanya menyajikan.
 */

describe("paymentDirection & paymentAccountLabel", () => {
  it("piutang adalah uang masuk — label akun tujuan 'Masuk ke'", () => {
    expect(paymentDirection("receivable")).toBe("in");
    expect(paymentDirection("opening-receivable")).toBe("in");
    expect(paymentAccountLabel("receivable")).toBe("Masuk ke");
    expect(paymentAccountLabel("opening-receivable")).toBe("Masuk ke");
  });

  it("utang, saldo awal utang, dan beban terutang adalah uang keluar — label 'Bayar dari'", () => {
    expect(paymentDirection("payable")).toBe("out");
    expect(paymentDirection("opening-payable")).toBe("out");
    expect(paymentDirection("expense-payable")).toBe("out");
    expect(paymentAccountLabel("payable")).toBe("Bayar dari");
    expect(paymentAccountLabel("opening-payable")).toBe("Bayar dari");
    expect(paymentAccountLabel("expense-payable")).toBe("Bayar dari");
  });
});

describe("partialSettlement", () => {
  const base = { outstanding: "1000000", canWriteOff: true, writeOffMaxAmount: "250000" };

  it("pembayaran penuh atau lebih bukan parsial", () => {
    expect(partialSettlement({ ...base, amount: "1000000" }).kind).toBe("none");
    expect(partialSettlement({ ...base, amount: "1250000" }).kind).toBe("none");
  });

  it("nominal nol/kosong bukan parsial", () => {
    expect(partialSettlement({ ...base, amount: "0" }).kind).toBe("none");
    expect(partialSettlement({ ...base, amount: "" }).kind).toBe("none");
  });

  it("parsial dengan sisa dalam ambang & berizin → write-off tersedia", () => {
    const result = partialSettlement({ ...base, amount: "800000" });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.remainder.toString()).toBe("200000");
    expect(result.writeOffEligible).toBe(true);
    expect(result.writeOffBlockedReason).toBeNull();
  });

  it("sisa tepat sama dengan ambang tetap tersedia", () => {
    const result = partialSettlement({ ...base, amount: "750000" });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.writeOffEligible).toBe(true);
  });

  it("tanpa izin accounting.manage → write-off tidak tersedia, alasan izin", () => {
    const result = partialSettlement({ ...base, amount: "800000", canWriteOff: false });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.writeOffEligible).toBe(false);
    expect(result.writeOffBlockedReason).toMatch(/izin/i);
  });

  it("ambang perusahaan 0 → fitur mati, alasan ambang belum diatur", () => {
    const result = partialSettlement({ ...base, amount: "800000", writeOffMaxAmount: "0" });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.writeOffEligible).toBe(false);
    expect(result.writeOffBlockedReason).toMatch(/ambang/i);
  });

  it("sisa melebihi ambang → tidak tersedia, alasan menyebut kedua angka", () => {
    const result = partialSettlement({ ...base, amount: "500000" });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.writeOffEligible).toBe(false);
    expect(result.writeOffBlockedReason).toContain("500.000");
    expect(result.writeOffBlockedReason).toContain("250.000");
  });

  it("alasan izin didahulukan dari alasan ambang (urutan penjaga domain)", () => {
    const result = partialSettlement({
      outstanding: "1000000",
      amount: "500000",
      canWriteOff: false,
      writeOffMaxAmount: "0",
    });
    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") throw new Error("expected partial");
    expect(result.writeOffBlockedReason).toMatch(/izin/i);
  });
});
