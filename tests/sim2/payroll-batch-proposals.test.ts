import { describe, expect, it } from "vitest";


import { employeeAdvances, employees } from "@/db/schema";
import {
  getOpenAdvanceTotal,
  proposeAdvanceDeductions,
  proposeAdvanceDeductionsBatch,
} from "@/server/employee-advances";
import { makeRollbackTransaction } from "../helpers/rollback-transaction";

// SIM-2 S4 (PERF-01): usulan potongan kasbon batch (satu query untuk
// semua karyawan, dipakai halaman payroll) harus menghasilkan angka
// yang IDENTIK dengan jalur per-karyawan lama (getOpenAdvanceTotal +
// proposeAdvanceDeductions) — termasuk plafon gaji bersih, FIFO antar
// kasbon, dan pengecualian karyawan nonaktif/tanpa kasbon/lunas.
// Transaksi rollback pada perusahaan fixture aa61 (pola employee-advances).

const ORG = "01900000-0000-7000-8000-00000000aa61";
const ACCOUNT_ID = "01900000-0000-7000-8000-00000000ac01";


const rollbackTransaction = makeRollbackTransaction(ORG);

type StaffSeed = {
  code: string;
  baseSalary: string;
  allowances?: string;
  deductions?: string;
  isActive?: boolean;
  advances: Array<{
    date: string;
    amount: string;
    remaining: string;
    planMode: "full" | "fixed" | "percent";
    planValue?: string;
    status?: "open" | "settled";
  }>;
};

const STAFF: StaffSeed[] = [
  {
    // fixed 300rb lalu percent 50% (basis gaji pokok 5jt → 2,5jt,
    // dibatasi sisa 2jt): total usulan 2.300.000, plafon tidak tercapai.
    code: "EMP-BATCH-A",
    baseSalary: "5000000",
    allowances: "500000",
    deductions: "100000",
    advances: [
      { date: "2025-01-10", amount: "1000000", remaining: "900000", planMode: "fixed", planValue: "300000" },
      { date: "2025-02-10", amount: "2000000", remaining: "2000000", planMode: "percent", planValue: "50" },
    ],
  },
  {
    // plafon gaji bersih: bruto 2jt − potongan tetap 1,9jt = 100rb;
    // kasbon full 800rb terpotong hanya 100rb.
    code: "EMP-BATCH-B",
    baseSalary: "2000000",
    allowances: "0",
    deductions: "1900000",
    advances: [
      { date: "2025-01-05", amount: "800000", remaining: "800000", planMode: "full" },
    ],
  },
  {
    // tanpa kasbon → tidak muncul di hasil batch.
    code: "EMP-BATCH-C",
    baseSalary: "4000000",
    advances: [],
  },
  {
    // nonaktif berkasbon → tidak muncul.
    code: "EMP-BATCH-D",
    baseSalary: "4000000",
    isActive: false,
    advances: [
      { date: "2025-01-01", amount: "500000", remaining: "500000", planMode: "full" },
    ],
  },
  {
    // kasbon sudah lunas → tidak muncul.
    code: "EMP-BATCH-E",
    baseSalary: "4000000",
    advances: [
      { date: "2025-01-01", amount: "500000", remaining: "0", planMode: "full", status: "settled" },
    ],
  },
  {
    // FIFO dua kasbon full: tertua terisi penuh dulu, berikutnya sisa plafon.
    code: "EMP-BATCH-F",
    baseSalary: "1000000",
    advances: [
      { date: "2025-01-01", amount: "600000", remaining: "600000", planMode: "full" },
      { date: "2025-03-01", amount: "600000", remaining: "600000", planMode: "full" },
    ],
  },
];

describe("PERF-01: usulan kasbon batch identik dengan per-karyawan", () => {
  it("total, sisa terbuka, dan alokasi FIFO sama persis untuk semua pola rencana", async () => {
    await rollbackTransaction(async (tx) => {
      const staffRows = [];
      let seq = 0;
      for (const seed of STAFF) {
        const [person] = await tx
          .insert(employees)
          .values({
            companyId: ORG,
            code: seed.code,
            name: `Karyawan ${seed.code}`,
            baseSalary: seed.baseSalary,
            allowances: seed.allowances ?? "0",
            deductions: seed.deductions ?? "0",
            isActive: seed.isActive ?? true,
          })
          .returning();
        staffRows.push(person);
        for (const adv of seed.advances) {
          seq++;
          await tx.insert(employeeAdvances).values({
            companyId: ORG,
            number: `KSB-BATCH-${String(seq).padStart(3, "0")}`,
            employeeId: person.id,
            date: adv.date,
            amount: adv.amount,
            remainingAmount: adv.remaining,
            accountId: ACCOUNT_ID,
            planMode: adv.planMode,
            planValue: adv.planValue ?? null,
            status: adv.status ?? "open",
            // createdAt eksplisit menaik agar urutan FIFO deterministik.
            createdAt: new Date(Date.UTC(2025, 0, 1, 0, 0, seq)),
          });
        }
      }

      // Jalur lama: loop per karyawan persis seperti halaman dulu.
      const legacy = new Map<
        string,
        { openTotal: string; total: string; allocations: Array<{ advanceId: string; amount: string }> }
      >();
      for (const person of staffRows) {
        if (!person.isActive) continue;
        const openTotal = await getOpenAdvanceTotal(tx, ORG, person.id);
        if (!openTotal.gt(0)) continue;
        const proposal = await proposeAdvanceDeductions(tx, ORG, person);
        legacy.set(person.id, {
          openTotal: openTotal.toFixed(2),
          total: proposal.total.toFixed(2),
          allocations: proposal.allocations.map((a) => ({
            advanceId: a.advanceId,
            amount: a.amount.toFixed(2),
          })),
        });
      }

      const batch = await proposeAdvanceDeductionsBatch(tx, ORG, staffRows);
      const batchMap = new Map(
        batch.map((row) => [
          row.employeeId,
          {
            openTotal: row.openTotal.toFixed(2),
            total: row.proposal.total.toFixed(2),
            allocations: row.proposal.allocations.map((a) => ({
              advanceId: a.advanceId,
              amount: a.amount.toFixed(2),
            })),
          },
        ]),
      );

      expect(batchMap).toEqual(legacy);
      // Hanya A, B, F yang berhak muncul.
      expect(batch).toHaveLength(3);

      const byCode = new Map(staffRows.map((p) => [p.code, p.id]));
      // Nilai tangan dari skenario (bukan sekadar konsisten antar-jalur):
      expect(batchMap.get(byCode.get("EMP-BATCH-A")!)?.total).toBe("2300000.00");
      expect(batchMap.get(byCode.get("EMP-BATCH-A")!)?.openTotal).toBe("2900000.00");
      expect(batchMap.get(byCode.get("EMP-BATCH-B")!)?.total).toBe("100000.00");
      const fifo = batchMap.get(byCode.get("EMP-BATCH-F")!)!;
      expect(fifo.total).toBe("1000000.00");
      expect(fifo.allocations.map((a) => a.amount)).toEqual(["600000.00", "400000.00"]);

      // Perusahaan lain tidak bocor ke hasil batch.
      const foreign = await proposeAdvanceDeductionsBatch(tx, "01900000-0000-7000-8000-00000000aa99", staffRows);
      expect(foreign).toHaveLength(0);
    });
  });
});
