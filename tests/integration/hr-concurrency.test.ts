import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminSql } from "@/db/admin";
import { employees, leaveRequests, leaveTypes, overtimeRequests } from "@/db/schema";
import { withCompany, withCompanyReadOnly } from "@/db/tenant";
import { decideLeaveRequest, submitLeaveRequest } from "@/server/hr/leave";
import { decideOvertimeRequest, submitOvertimeRequest } from "@/server/hr/overtime";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const COMPANY_ID = `audit-hr-${crypto.randomUUID()}`;
const USER_ID = `audit-hr-user-${crypto.randomUUID()}`;
let employeeId = "";
let leaveTypeId = "";

beforeAll(async () => {
  await withCompany(COMPANY_ID, async (tx) => {
    const [employee] = await tx.insert(employees).values({
      companyId: COMPANY_ID,
      code: `HR-${crypto.randomUUID()}`,
      name: "Employee Concurrency Fixture",
    }).returning({ id: employees.id });
    employeeId = employee.id;
    const [leaveType] = await tx.insert(leaveTypes).values({
      companyId: COMPANY_ID,
      code: "annual-audit",
      name: "Annual Audit Leave",
      daysPerYear: "10",
    }).returning({ id: leaveTypes.id });
    leaveTypeId = leaveType.id;
  });
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, COMPANY_ID);
});

describe("HR concurrency invariants", () => {
  it("serializes concurrent overtime submissions for the same employee/date", async () => {
    const input = {
      companyId: COMPANY_ID,
      userId: USER_ID,
      employeeId,
      date: "2026-11-10",
      dayType: "workday" as const,
      hours: 2,
    };
    const results = await Promise.allSettled([
      withCompany(COMPANY_ID, (tx) => submitOvertimeRequest(tx, input)),
      withCompany(COMPANY_ID, (tx) => submitOvertimeRequest(tx, input)),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const rows = await withCompanyReadOnly(COMPANY_ID, (tx) => tx
      .select({ id: overtimeRequests.id })
      .from(overtimeRequests)
      .where(and(
        eq(overtimeRequests.companyId, COMPANY_ID),
        eq(overtimeRequests.employeeId, employeeId),
        eq(overtimeRequests.date, input.date),
      )));
    expect(rows).toHaveLength(1);
  });

  it("legacy overlapping overtime requires rejecting one duplicate before approval", async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await withCompany(COMPANY_ID, (tx) => tx.insert(overtimeRequests).values(ids.map((id) => ({
      id,
      companyId: COMPANY_ID,
      employeeId,
      date: "2026-11-11",
      dayType: "workday",
      hours: "2",
      status: "pending",
    }))));

    const results = await Promise.allSettled(ids.map((id) => withCompany(COMPANY_ID, (tx) =>
      decideOvertimeRequest(tx, {
        companyId: COMPANY_ID,
        userId: USER_ID,
        userRole: "owner",
        id,
        approve: true,
      }),
    )));
    // The overlap guard must reject both approvals while the duplicate is
    // still active. This is the safe outcome; a supervisor must reject one
    // duplicate first, then approve the survivor.
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(0);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(2);

    const before = await withCompanyReadOnly(COMPANY_ID, (tx) => tx
      .select({ status: overtimeRequests.status })
      .from(overtimeRequests)
      .where(and(eq(overtimeRequests.companyId, COMPANY_ID), eq(overtimeRequests.date, "2026-11-11"))));
    expect(before.filter((row) => row.status === "pending")).toHaveLength(2);

    await withCompany(COMPANY_ID, (tx) => decideOvertimeRequest(tx, {
      companyId: COMPANY_ID, userId: USER_ID, userRole: "owner", id: ids[0], approve: false,
    }));
    await withCompany(COMPANY_ID, (tx) => decideOvertimeRequest(tx, {
      companyId: COMPANY_ID, userId: USER_ID, userRole: "owner", id: ids[1], approve: true,
    }));

    const after = await withCompanyReadOnly(COMPANY_ID, (tx) => tx
      .select({ status: overtimeRequests.status })
      .from(overtimeRequests)
      .where(and(eq(overtimeRequests.companyId, COMPANY_ID), eq(overtimeRequests.date, "2026-11-11"))));
    expect(after.filter((row) => row.status === "approved")).toHaveLength(1);
    expect(after.filter((row) => row.status === "rejected")).toHaveLength(1);
  });

  it("rechecks leave quota while approvals for one employee are serialized", async () => {
    const first = await withCompany(COMPANY_ID, (tx) => submitLeaveRequest(tx, {
      companyId: COMPANY_ID,
      userId: USER_ID,
      employeeId,
      leaveTypeId,
      startDate: "2026-11-02",
      endDate: "2026-11-09",
    }));
    const second = await withCompany(COMPANY_ID, (tx) => submitLeaveRequest(tx, {
      companyId: COMPANY_ID,
      userId: USER_ID,
      employeeId,
      leaveTypeId,
      startDate: "2026-11-16",
      endDate: "2026-11-23",
    }));
    expect(Number(first.days)).toBe(6);
    expect(Number(second.days)).toBe(6);

    const results = await Promise.allSettled([first.id, second.id].map((id) => withCompany(COMPANY_ID, (tx) =>
      decideLeaveRequest(tx, {
        companyId: COMPANY_ID,
        userId: USER_ID,
        userRole: "owner",
        id,
        approve: true,
      }),
    )));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const rows = await withCompanyReadOnly(COMPANY_ID, (tx) => tx
      .select({ status: leaveRequests.status })
      .from(leaveRequests)
      .where(and(eq(leaveRequests.companyId, COMPANY_ID), eq(leaveRequests.employeeId, employeeId))));
    expect(rows.filter((row) => row.status === "approved")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "pending")).toHaveLength(1);
  });
});
