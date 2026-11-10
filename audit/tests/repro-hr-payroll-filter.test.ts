import { describe, expect, it } from "vitest";

describe("Audit Reproduction: HR-001 Premature Payroll Enrollment", () => {
  it("membuktikan bahwa query karyawan aktif tanpa filter joinedAt akan menyertakan karyawan masa depan", () => {
    // Skenario simulasi data karyawan di database
    const staffDatabase = [
      { id: "emp-1", name: "Budi (Karyawan Lama)", isActive: true, joinedAt: "2024-01-15" },
      { id: "emp-2", name: "Siti (Karyawan Baru Masuk Des)", isActive: true, joinedAt: "2026-12-01" },
      { id: "emp-3", name: "Joko (Nonaktif/Resign)", isActive: false, joinedAt: "2023-05-10" },
    ];

    const payrollPeriod = "2026-11";
    const periodEnd = "2026-11-30";

    // Query filter aktual di src/server/actions/hr/payroll.ts baris 128:
    // where(and(eq(employees.companyId, ctx.company.id), eq(employees.isActive, true)))
    const actualSelected = staffDatabase.filter((emp) => emp.isActive === true);

    // Filter yang seharusnya (normatif):
    const correctSelected = staffDatabase.filter(
      (emp) => emp.isActive === true && emp.joinedAt <= periodEnd,
    );

    console.log(`Karyawan yang terproses pada periode ${payrollPeriod} (Aktual):`, actualSelected.map((e) => e.name));
    console.log("Karyawan yang seharusnya terproses (Normatif):", correctSelected.map((e) => e.name));

    // Membuktikan cacat logika: Siti yang baru bergabung 1 Des 2026 ikut terbayar di gaji Nov 2026!
    expect(actualSelected.some((e) => e.name.includes("Siti"))).toBe(true);
    expect(correctSelected.some((e) => e.name.includes("Siti"))).toBe(false);
  });
});
