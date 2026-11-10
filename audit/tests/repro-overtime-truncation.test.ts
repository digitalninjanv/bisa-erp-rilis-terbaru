import { describe, expect, it } from "vitest";
import { computeOvertimePay, type StatutoryConfig } from "@/lib/payroll-indonesia";
import { d } from "@/lib/money";

describe("Audit Reproduction: HR-002 Pemotongan Jam Pecahan Lembur", () => {
  const dummyConfig: StatutoryConfig = {
    pph21Enabled: true,
    ptkp: [],
    terBrackets: { A: [], B: [], C: [] },
    taxBrackets: [],
    programs: [],
    parameters: {
      overtime_hourly_divisor: "173",
    },
    overtimeRules: [
      { id: "1", dayType: "workday", hourFrom: 1, hourTo: 1, multiplier: "1.5" },
      { id: "2", dayType: "workday", hourFrom: 2, hourTo: null, multiplier: "2.0" },
    ],
  };

  it("membuktikan bahwa lembur 1.5 jam memotong 0.5 jam akibat perulangan integer", () => {
    const monthlyWage = 1730000; // Hourly wage = 1.730.000 / 173 = 10.000 / jam
    
    // Karyawan bekerja lembur 1.5 jam pada hari kerja
    const result = computeOvertimePay({
      config: dummyConfig,
      monthlyWage,
      entries: [{ dayType: "workday", hours: 1.5 }],
    });

    // Perhitungan normatif yang seharusnya:
    // Jam 1 (1.0 jam) x 1.5 x Rp10.000 = Rp15.000
    // Jam 2 (0.5 jam) x 2.0 x Rp10.000 = Rp10.000
    // Total seharusnya = Rp25.000
    const expectedCorrect = d(25000);

    // Namun implementasi saat ini:
    // Loop `for (let hour = 1; hour <= 1.5; hour += 1)` hanya berjalan untuk hour = 1 (Rp15.000)
    // Sisa 0.5 jam (Rp10.000) dipotong dan hilang!
    console.log("Hasil aktual dari fungsi computeOvertimePay:", result.total.toString());
    console.log("Hasil yang seharusnya (normatif):", expectedCorrect.toString());

    // Membuktikan cacat logika: hasil aktual bernilai 15.000, bukan 25.000!
    expect(result.total.toNumber()).toBe(15000);
    expect(result.total.toNumber()).not.toBe(expectedCorrect.toNumber());
  });
});
