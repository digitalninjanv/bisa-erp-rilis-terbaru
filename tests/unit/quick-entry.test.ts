import { describe, expect, it } from "vitest";
import { d } from "@/lib/money";
import {
  allocateFifo,
  buildQuickEntryPreview,
  splitCashSale,
  splitCashSaleWithDiscount,
} from "@/lib/quick-entry";

// A-12 (D-23): logika murni modal Catat Transaksi.
// - Pembelahan pajak penjualan tunai memakai lineTax inklusif yang sama
//   seperti POS, sehingga pratinjau modal dan jurnal yang diposting
//   server tidak pernah berbeda angka.
// - Alokasi FIFO pembayaran pihak dihitung dari daftar dokumen terbuka
//   yang sudah terurut tertua-dulu oleh server.

describe("splitCashSale", () => {
  it("termasuk pajak 11%: bruto 111.000 → pajak 11.000, bersih 100.000", () => {
    const { tax, net } = splitCashSale("111000", "11", true);
    expect(tax.toFixed(2)).toBe("11000.00");
    expect(net.toFixed(2)).toBe("100000.00");
  });

  it("tanpa opsi termasuk pajak: pajak 0 dan bersih = bruto", () => {
    const { tax, net } = splitCashSale("111000", "11", false);
    expect(tax.toFixed(2)).toBe("0.00");
    expect(net.toFixed(2)).toBe("111000.00");
  });

  it("tarif 0: tidak ada pajak walau opsi dicentang", () => {
    const { tax, net } = splitCashSale("50000", "0", true);
    expect(tax.toFixed(2)).toBe("0.00");
    expect(net.toFixed(2)).toBe("50000.00");
  });

  it("pembulatan Decimal: pajak + bersih selalu tepat sama dengan bruto", () => {
    const { tax, net } = splitCashSale("100000", "11", true);
    expect(tax.toFixed(4)).toBe("9909.9099");
    expect(net.toFixed(4)).toBe("90090.0901");
    expect(tax.plus(net).equals(d("100000"))).toBe(true);
  });
});

describe("splitCashSaleWithDiscount (R3-05)", () => {
  it("tanpa pajak: kas = bruto − diskon, pendapatan tetap bruto", () => {
    const result = splitCashSaleWithDiscount("100000", "11", false, "10000");
    expect(result.cash.toFixed(0)).toBe("90000");
    expect(result.discount.toFixed(0)).toBe("10000");
    expect(result.revenue.toFixed(0)).toBe("100000");
    expect(result.tax.toFixed(0)).toBe("0");
  });

  it("termasuk pajak: pajak dihitung atas dasar sesudah diskon (pola POS), pendapatan dikredit bruto", () => {
    // Bruto 111.000, diskon 11.000 → dasar pajak 100.000 →
    // PPN = 100.000 × 11/111 = 9.909,9099; pendapatan = bruto − pajak.
    const result = splitCashSaleWithDiscount("111000", "11", true, "11000");
    expect(result.tax.toFixed(4)).toBe("9909.9099");
    expect(result.revenue.toFixed(4)).toBe("101090.0901");
    expect(result.cash.toFixed(0)).toBe("100000");
    // Kas + diskon selalu tepat sama dengan pendapatan + pajak (bruto).
    expect(result.cash.plus(result.discount).equals(result.revenue.plus(result.tax))).toBe(true);
  });

  it("diskon 0 identik dengan splitCashSale biasa", () => {
    const withDiscount = splitCashSaleWithDiscount("111000", "11", true, "0");
    const plain = splitCashSale("111000", "11", true);
    expect(withDiscount.tax.equals(plain.tax)).toBe(true);
    expect(withDiscount.revenue.equals(plain.net)).toBe(true);
    expect(withDiscount.cash.toFixed(0)).toBe("111000");
  });
});

describe("allocateFifo", () => {
  const docs = [
    { id: "a", number: "DOK-A", outstanding: "50000" },
    { id: "b", number: "DOK-B", outstanding: "30000" },
  ];

  it("mengisi dokumen tertua dulu lalu sisanya ke dokumen berikutnya", () => {
    const portions = allocateFifo(docs, "65000");
    expect(portions.map((p) => [p.doc.id, p.amount.toFixed(0)])).toEqual([
      ["a", "50000"],
      ["b", "15000"],
    ]);
  });

  it("nominal sebesar total melunasi semua dokumen", () => {
    const portions = allocateFifo(docs, "80000");
    expect(portions.map((p) => p.amount.toFixed(0))).toEqual(["50000", "30000"]);
  });

  it("nominal 0 menghasilkan alokasi kosong", () => {
    expect(allocateFifo(docs, "0")).toEqual([]);
  });

  it("dokumen bersisa 0 dilewati", () => {
    const portions = allocateFifo(
      [
        { id: "x", number: "DOK-X", outstanding: "0" },
        { id: "y", number: "DOK-Y", outstanding: "10000" },
      ],
      "4000",
    );
    expect(portions.map((p) => [p.doc.id, p.amount.toFixed(0)])).toEqual([["y", "4000"]]);
  });
});

describe("buildQuickEntryPreview", () => {
  it("penjualan tunai termasuk pajak: Dr kas bruto, Cr pendapatan bersih, Cr PPN", () => {
    const preview = buildQuickEntryPreview({
      kind: "cash_sale",
      amount: "111000",
      cashAccountLabel: "1000 — Kas",
      counterAccountLabel: "4000 — Penjualan",
      taxIncluded: true,
      taxRate: "11",
      taxAccountLabel: "2200 — PPN Keluaran",
    });
    expect(preview.balanced).toBe(true);
    expect(d(preview.totalDebit).toFixed(0)).toBe("111000");
    expect(d(preview.totalCredit).toFixed(0)).toBe("111000");
    expect(preview.lines).toHaveLength(3);
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("111000");
    expect(d(preview.lines[1].credit).toFixed(0)).toBe("100000");
    expect(d(preview.lines[2].credit).toFixed(0)).toBe("11000");
  });

  it("penjualan tunai dengan diskon tanpa pajak: Dr kas neto, Dr diskon, Cr pendapatan bruto (R3-05)", () => {
    const preview = buildQuickEntryPreview({
      kind: "cash_sale",
      amount: "100000",
      discount: "10000",
      cashAccountLabel: "1000 — Kas",
      counterAccountLabel: "4000 — Penjualan",
      discountAccountLabel: "4010 — Diskon Penjualan",
      taxIncluded: false,
      taxRate: "11",
    });
    expect(preview.lines).toHaveLength(3);
    expect(preview.lines[0].label).toBe("1000 — Kas");
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("90000");
    expect(preview.lines[1].label).toBe("4010 — Diskon Penjualan");
    expect(d(preview.lines[1].debit).toFixed(0)).toBe("10000");
    expect(preview.lines[2].label).toBe("4000 — Penjualan");
    expect(d(preview.lines[2].credit).toFixed(0)).toBe("100000");
    expect(preview.balanced).toBe(true);
    expect(d(preview.totalDebit).toFixed(0)).toBe("100000");
    expect(d(preview.totalCredit).toFixed(0)).toBe("100000");
  });

  it("penjualan tunai dengan diskon + pajak: empat baris, pajak atas dasar sesudah diskon (R3-05)", () => {
    const preview = buildQuickEntryPreview({
      kind: "cash_sale",
      amount: "111000",
      discount: "11000",
      cashAccountLabel: "1000 — Kas",
      counterAccountLabel: "4000 — Penjualan",
      discountAccountLabel: "4010 — Diskon Penjualan",
      taxIncluded: true,
      taxRate: "11",
      taxAccountLabel: "2200 — PPN Keluaran",
    });
    expect(preview.lines).toHaveLength(4);
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("100000");
    expect(d(preview.lines[1].debit).toFixed(0)).toBe("11000");
    expect(d(preview.lines[2].credit).toFixed(2)).toBe("101090.09");
    expect(d(preview.lines[3].credit).toFixed(2)).toBe("9909.91");
    expect(preview.balanced).toBe(true);
    expect(d(preview.totalDebit).toFixed(0)).toBe("111000");
    expect(d(preview.totalCredit).toFixed(0)).toBe("111000");
  });

  it("penjualan tunai dengan diskon eksplisit 0: bentuk lama persis, tanpa baris diskon (R3-05)", () => {
    const preview = buildQuickEntryPreview({
      kind: "cash_sale",
      amount: "75000",
      discount: "0",
      cashAccountLabel: "1100 — Bank",
      counterAccountLabel: "4000 — Penjualan",
      discountAccountLabel: "4010 — Diskon Penjualan",
      taxIncluded: false,
      taxRate: "11",
    });
    expect(preview.lines).toHaveLength(2);
    expect(preview.balanced).toBe(true);
  });

  it("penjualan tunai tanpa pajak: dua baris seimbang", () => {
    const preview = buildQuickEntryPreview({
      kind: "cash_sale",
      amount: "75000",
      cashAccountLabel: "1100 — Bank",
      counterAccountLabel: "4000 — Penjualan",
      taxIncluded: false,
      taxRate: "11",
      taxAccountLabel: "2200 — PPN Keluaran",
    });
    expect(preview.lines).toHaveLength(2);
    expect(preview.balanced).toBe(true);
  });

  it("beban: Dr akun beban, Cr akun pembayaran", () => {
    const preview = buildQuickEntryPreview({
      kind: "expense",
      amount: "250000",
      cashAccountLabel: "1000 — Kas",
      counterAccountLabel: "6100 — Beban Listrik",
    });
    expect(preview.lines).toHaveLength(2);
    expect(preview.lines[0].label).toBe("6100 — Beban Listrik");
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("250000");
    expect(d(preview.lines[1].credit).toFixed(0)).toBe("250000");
    expect(preview.balanced).toBe(true);
  });

  it("terima piutang: jurnal ringkas + rincian alokasi FIFO per dokumen", () => {
    const preview = buildQuickEntryPreview({
      kind: "receive",
      amount: "65000",
      cashAccountLabel: "1000 — Kas",
      receivableAccountLabel: "1200 — Piutang Usaha",
      fifoDocs: [
        { id: "a", number: "OPR-2026-00001", outstanding: "50000" },
        { id: "b", number: "INV-2026-00007", outstanding: "30000" },
      ],
    });
    expect(preview.lines).toHaveLength(2);
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("65000");
    expect(d(preview.lines[1].credit).toFixed(0)).toBe("65000");
    expect(preview.allocations).toEqual([
      { number: "OPR-2026-00001", amount: expect.any(String) },
      { number: "INV-2026-00007", amount: expect.any(String) },
    ]);
    expect(d(preview.allocations[0].amount).toFixed(0)).toBe("50000");
    expect(d(preview.allocations[1].amount).toFixed(0)).toBe("15000");
  });

  it("bayar utang: Dr utang, Cr kas", () => {
    const preview = buildQuickEntryPreview({
      kind: "pay",
      amount: "40000",
      cashAccountLabel: "1100 — Bank",
      payableAccountLabel: "2000 — Utang Usaha",
      fifoDocs: [{ id: "a", number: "RCV-2026-00003", outstanding: "90000" }],
    });
    expect(preview.lines[0].label).toBe("2000 — Utang Usaha");
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("40000");
    expect(d(preview.lines[1].credit).toFixed(0)).toBe("40000");
    expect(d(preview.allocations[0].amount).toFixed(0)).toBe("40000");
  });

  it("transfer: Dr rekening tujuan, Cr rekening asal", () => {
    const preview = buildQuickEntryPreview({
      kind: "transfer",
      amount: "1000000",
      fromAccountLabel: "1000 — Kas",
      toAccountLabel: "1100 — Bank",
    });
    expect(preview.lines[0].label).toBe("1100 — Bank");
    expect(preview.lines[1].label).toBe("1000 — Kas");
    expect(preview.balanced).toBe(true);
  });

  it("transfer dengan biaya eksplisit 0: tetap dua baris seperti tanpa biaya", () => {
    const preview = buildQuickEntryPreview({
      kind: "transfer",
      amount: "1000000",
      fee: "0",
      fromAccountLabel: "1000 — Kas",
      toAccountLabel: "1100 — Bank",
    });
    expect(preview.lines).toHaveLength(2);
    expect(d(preview.totalDebit).toFixed(0)).toBe("1000000");
    expect(d(preview.totalCredit).toFixed(0)).toBe("1000000");
    expect(preview.balanced).toBe(true);
  });

  it("transfer dengan biaya > 0: tiga baris — Dr tujuan, Dr biaya admin, Cr asal nominal+biaya", () => {
    const preview = buildQuickEntryPreview({
      kind: "transfer",
      amount: "1000000",
      fee: "6500",
      fromAccountLabel: "1000 — Kas",
      toAccountLabel: "1100 — Bank",
    });
    expect(preview.lines).toHaveLength(3);
    expect(preview.lines[0].label).toBe("1100 — Bank");
    expect(d(preview.lines[0].debit).toFixed(0)).toBe("1000000");
    // Label bawaan mengikuti deskripsi jalur khusus (createBankTransfer).
    expect(preview.lines[1].label).toBe("Biaya administrasi bank");
    expect(d(preview.lines[1].debit).toFixed(0)).toBe("6500");
    expect(preview.lines[2].label).toBe("1000 — Kas");
    expect(d(preview.lines[2].credit).toFixed(0)).toBe("1006500");
    expect(d(preview.totalDebit).toFixed(0)).toBe("1006500");
    expect(d(preview.totalCredit).toFixed(0)).toBe("1006500");
    expect(preview.balanced).toBe(true);
  });

  it("transfer dengan biaya: label akun biaya terpetakan dipakai bila diberikan", () => {
    const preview = buildQuickEntryPreview({
      kind: "transfer",
      amount: "500000",
      fee: "2500",
      fromAccountLabel: "1000 — Kas",
      toAccountLabel: "1100 — Bank",
      feeAccountLabel: "6060 — Biaya Administrasi Bank",
    });
    expect(preview.lines[1].label).toBe("6060 — Biaya Administrasi Bank");
    expect(d(preview.lines[1].debit).toFixed(0)).toBe("2500");
    expect(preview.balanced).toBe(true);
  });
});
