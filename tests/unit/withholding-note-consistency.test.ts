import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WITHHOLDING_CORE_NOTE } from "@/lib/payment-settlement";

/**
 * A-24 T4 — konsistensi label & penjelasan potongan pajak
 * (withholding) antar kedua form pembayaran: label field memang
 * sudah identik (Jenis / Tarif (%) / Nominal potongan, opsi PPh 23 &
 * PPh 4(2)); yang dijaga di sini adalah kalimat inti konsepnya —
 * potongan menjadi utang PPh dipotong — tidak berdrift antar form
 * karena keduanya memakai konstanta yang sama.
 */
const root = process.cwd();

describe("A-24 T4: penjelasan withholding konsisten antar form", () => {
  it("kalimat inti menyebut utang PPh dipotong yang disetor terpisah", () => {
    expect(WITHHOLDING_CORE_NOTE).toContain("utang PPh dipotong");
    expect(WITHHOLDING_CORE_NOTE).toContain("disetor terpisah");
  });

  it.each([
    "src/components/akuntansi/payment-form.tsx",
    // A-26 Q7 (K-07): bidang form Catat Transaksi kini tinggal di
    // quick-entry/kind-fields.tsx (quick-entry-modal.tsx orkestrator).
    "src/components/akuntansi/quick-entry/kind-fields.tsx",
  ])("%s memakai konstanta bersama & label field yang sama", (file) => {
    const source = readFileSync(join(root, file), "utf8");
    expect(source).toContain("WITHHOLDING_CORE_NOTE");
    expect(source).toContain("Potongan pajak (withholding)");
    expect(source).toContain("Jenis");
    expect(source).toContain("Tarif (%)");
    expect(source).toContain("Nominal potongan");
    expect(source).toContain("PPh 23");
    expect(source).toContain("PPh 4(2)");
  });
});
