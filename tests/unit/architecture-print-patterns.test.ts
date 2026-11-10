import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * POS-NOTA-01 (Perbaikan Nota POS) — toast tidak boleh tercetak.
 *
 * Akar temuan terukur: toast sukses Sonner ("Transaksi … tersimpan")
 * adalah elemen `position: fixed` lapisan tertinggi tanpa penanda
 * no-print; autoprint nota POS terpicu 400ms sesudah toast tampil
 * (umur toast ±4 detik), sehingga toast selalu ikut terrender ke
 * hasil cetak dan menimpa kop nota pada kertas thermal (bukti PDF
 * di docs/form-crud/PERBAIKAN-NOTA-POS.md).
 *
 * Dua lapis perbaikan dikunci di sini agar tidak regresi diam-diam:
 *  1. Aturan @media print di globals.css menyembunyikan wadah &
 *     butir toast Sonner dari SEMUA permukaan cetak.
 *  2. Pemicu cetak bersama (ReceiptPrint) membuang toast lebih dulu
 *     sebelum window.print(), pada jalur otomatis maupun manual.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const globalsCss = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const receiptPrint = readFileSync(
  path.join(ROOT, "src/components/pos/receipt-print.tsx"),
  "utf8",
);

function printBlock(css: string): string {
  const start = css.indexOf("@media print");
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start);
}

describe("POS-NOTA-01: toast Sonner tidak tercetak", () => {
  it("globals.css menyembunyikan toaster & toast Sonner di @media print", () => {
    const block = printBlock(globalsCss);
    expect(block).toContain("[data-sonner-toaster]");
    expect(block).toContain("[data-sonner-toast]");
    expect(block).toMatch(/\[data-sonner-toast\]\s*\{\s*display:\s*none\s*!important/);
  });

  it("ReceiptPrint membuang toast sebelum window.print()", () => {
    const dismissAt = receiptPrint.indexOf("toast.dismiss()");
    const printAt = receiptPrint.indexOf("window.print()");
    expect(dismissAt).toBeGreaterThanOrEqual(0);
    expect(printAt).toBeGreaterThan(dismissAt);
  });
});
