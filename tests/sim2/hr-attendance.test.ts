import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  attendanceRecords,
  companySettings,
  employeeShiftAssignments,
  employees,
  member,
  organization,
  user,
  workShifts,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  assignEmployeeShiftAction,
  saveWorkShiftAction,
} from "@/server/actions/hr/organisasi";
import {
  importAttendanceCsvAction,
  recordAttendanceAction,
} from "@/server/actions/hr/presensi";
import { getAttendanceRecap } from "@/server/hr";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * SIM-2 S7B-1 Batch 2 — Absensi & shift (§6B).
 *
 * Master shift terkonfigurasi, penugasan per karyawan bertanggal
 * efektif, catatan harian dengan menit terlambat terhitung dari shift,
 * impor CSV dengan laporan baris gagal, rekap per periode, dan isolasi
 * antar-perusahaan. Absensi tidak menyentuh payroll di batch ini.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/session", () => {
  const ctx = async () => ({
    company: { id: "01900000-0000-7000-8000-00000000e702" },
    user: { id: "01900000-0000-7000-8000-00000000e720" },
    role: "owner",
  });
  return { requirePermission: ctx, requirePermissionInModule: ctx, requireAuth: ctx };
});

const ORG = "01900000-0000-7000-8000-00000000e702";
const OTHER = "01900000-0000-7000-8000-00000000e709";
const OWNER = "01900000-0000-7000-8000-00000000e720";


const F = { shift: "", emp: "", emp2: "" };

async function wipeOrg(org: string) {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, org);
}

async function bootstrapFixture() {
  await wipeOrg(ORG);
  await wipeOrg(OTHER);
  await adminSql`DELETE FROM account WHERE user_id = ${OWNER}`;
  await adminSql`DELETE FROM "user" WHERE id = ${OWNER}`;
  await adminDb.insert(user).values({
    id: OWNER, name: "Sari Shift", email: "owner@hratt.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  for (const [org, name, slug] of [[ORG, "HrAtt", "hratt"], [OTHER, "HrOther", "hrother"]] as const) {
    await adminDb.insert(organization).values({ id: org, name, slug, createdAt: new Date() });
    await adminDb.insert(companySettings).values({
      companyId: org, legalName: name, roundingMode: "none", taxRate: "0", allowNegativeStock: false,
    });
  }
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  const rows = await adminDb
    .insert(employees)
    .values([
      { companyId: ORG, code: "AT-1", name: "Andi Absen", baseSalary: "5000000" },
      { companyId: ORG, code: "AT-2", name: "Rina Rekap", baseSalary: "4500000" },
      { companyId: OTHER, code: "AT-1", name: "Orang Lain", baseSalary: "4000000" },
    ])
    .returning({ id: employees.id, companyId: employees.companyId, code: employees.code });
  F.emp = rows.find((row) => row.companyId === ORG && row.code === "AT-1")!.id;
  F.emp2 = rows.find((row) => row.companyId === ORG && row.code === "AT-2")!.id;
}

describe("S7B-1 Batch 2 — absensi & shift", () => {
  beforeAll(bootstrapFixture);
  afterAll(async () => {
    await wipeOrg(ORG);
    await wipeOrg(OTHER);
  });

  it("master shift & penugasan bertanggal efektif", async () => {
    const shift = await saveWorkShiftAction({
      code: "PAGI", name: "Shift Pagi", startTime: "08:00", endTime: "17:00",
      workDays: [1, 2, 3, 4, 5],
    });
    expect(shift.ok).toBe(true);
    if (!shift.ok) throw new Error(shift.message);
    F.shift = shift.data.id;
    const [row] = await adminDb.select().from(workShifts).where(eq(workShifts.id, F.shift));
    expect(row.workDays).toEqual([1, 2, 3, 4, 5]);
    expect(row.crossesMidnight).toBe(false);

    const assigned = await assignEmployeeShiftAction({
      employeeId: F.emp, shiftId: F.shift, effectiveFrom: "2026-11-01",
    });
    expect(assigned.ok).toBe(true);
    const assigned2 = await assignEmployeeShiftAction({
      employeeId: F.emp2, shiftId: F.shift, effectiveFrom: "2026-11-01",
    });
    expect(assigned2.ok).toBe(true);
    const assignments = await adminDb
      .select()
      .from(employeeShiftAssignments)
      .where(eq(employeeShiftAssignments.employeeId, F.emp));
    expect(assignments).toHaveLength(1);
  });

  it("catatan hadir menghitung menit terlambat dari shift yang berlaku", async () => {
    const late = await recordAttendanceAction({
      employeeId: F.emp, date: "2026-11-02", status: "present",
      checkIn: "08:20", checkOut: "17:05",
    });
    expect(late.ok).toBe(true);
    const onTime = await recordAttendanceAction({
      employeeId: F.emp, date: "2026-11-03", status: "present",
      checkIn: "07:55", checkOut: "17:00",
    });
    expect(onTime.ok).toBe(true);
    const sick = await recordAttendanceAction({
      employeeId: F.emp, date: "2026-11-04", status: "sick", note: "Surat dokter",
    });
    expect(sick.ok).toBe(true);

    const rows = await adminDb
      .select()
      .from(attendanceRecords)
      .where(and(eq(attendanceRecords.companyId, ORG), eq(attendanceRecords.employeeId, F.emp)));
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.date === "2026-11-02")?.lateMinutes).toBe(20);
    expect(rows.find((row) => row.date === "2026-11-03")?.lateMinutes).toBe(0);
  });

  it("mencatat ulang tanggal yang sama memperbarui baris (tanpa duplikat)", async () => {
    const again = await recordAttendanceAction({
      employeeId: F.emp, date: "2026-11-04", status: "present",
      checkIn: "08:00", checkOut: "17:00",
    });
    expect(again.ok).toBe(true);
    const rows = await adminDb
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.companyId, ORG),
          eq(attendanceRecords.employeeId, F.emp),
          eq(attendanceRecords.date, "2026-11-04"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("present");
  });

  it("rekap periode cocok dengan catatan harian", async () => {
    const recap = await withCompany(ORG, (tx) => getAttendanceRecap(tx, ORG, "2026-11"));
    const mine = recap.find((row) => row.employeeId === F.emp);
    expect(mine).toBeDefined();
    expect(mine?.counts.present).toBe(3);
    expect(mine?.counts.sick).toBe(0);
    expect(mine?.totalLateMinutes).toBe(20);
  });

  it("impor CSV: baris sah masuk, baris rusak dilaporkan per baris", async () => {
    const csv = [
      "kode;tanggal;status;masuk;pulang;catatan",
      "AT-2;2026-11-02;hadir;08:05;17:00;",
      "AT-2;2026-11-03;izin;;;Urusan keluarga",
      "AT-2;2026-11-04;hadir;08:00;17:01;",
      "XX-9;2026-11-02;hadir;08:00;17:00;",
      "AT-2;2026-11-05;ngawur;;;",
    ].join("\n");
    const result = await importAttendanceCsvAction({ text: csv });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.data.imported).toBe(3);
    expect(result.data.errors).toHaveLength(2);
    const recap = await withCompany(ORG, (tx) => getAttendanceRecap(tx, ORG, "2026-11"));
    const rina = recap.find((row) => row.employeeId === F.emp2);
    expect(rina?.counts.present).toBe(2);
    expect(rina?.counts.permit).toBe(1);
    expect(rina?.totalLateMinutes).toBe(5);
  });

  it("absensi perusahaan lain terisolasi penuh", async () => {
    const recapOther = await withCompany(OTHER, (tx) => getAttendanceRecap(tx, OTHER, "2026-11"));
    expect(recapOther).toHaveLength(0);
    const visibleFromOther = await withCompany(OTHER, (tx) =>
      tx
        .select()
        .from(attendanceRecords)
        .where(eq(attendanceRecords.companyId, ORG)),
    );
    expect(visibleFromOther).toHaveLength(0);
  });
});
