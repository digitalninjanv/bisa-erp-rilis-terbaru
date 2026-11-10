// A-24 Tahap T4B: bagian dari pemecahan src/server/hr.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/hr.ts.

import {
  and,
  eq,
} from "drizzle-orm";
import type { Tx } from "@/db";
import {
  employees,
  payrollComponentDrafts,
} from "@/db/schema";
import {
  d,
  toDb,
  Decimal,
} from "@/lib/money";
import {
  fullMonthsBetween,
  periodRange,
} from "@/lib/hr";
import { computeThr } from "@/lib/payroll-indonesia";
import { AppError } from "@/lib/errors";
import { writeAudit } from "@/server/audit";
import { loadHrPayrollConfig } from "./shared";

export interface ThrComputation {
  created: number;
  skipped: number;
  total: Decimal;
}

/**
 * "Hitung THR" (§6D): menghasilkan DRAF komponen THR per karyawan
 * untuk periode target memakai aturan konfigurasi perusahaan (ambang
 * minimum & penuh + prorata masa kerja). Draf tidak memposting jurnal;
 * ia masuk run payroll periode yang sama sebagai baris bernama.
 * Menghitung ulang mem-void draf lama yang belum terpakai.
 */
export async function computeThrDrafts(
  tx: Tx,
  input: { companyId: string; userId: string | null; period: string },
): Promise<ThrComputation> {
  const { end } = periodRange(input.period);
  const config = await loadHrPayrollConfig(tx, input.companyId, `${input.period}-01`);
  const staff = await tx
    .select()
    .from(employees)
    .where(and(eq(employees.companyId, input.companyId), eq(employees.isActive, true)));
  let created = 0;
  let skipped = 0;
  let total = d(0);
  for (const person of staff) {
    const monthlyWage = d(person.baseSalary).plus(d(person.allowances));
    const months = person.joinedAt ? fullMonthsBetween(person.joinedAt, end) : 0;
    const amount = computeThr({ config, monthlyWage, monthsOfService: months });
    // Draf lama periode ini selalu digantikan hasil hitung terbaru.
    await tx
      .update(payrollComponentDrafts)
      .set({ status: "void" })
      .where(
        and(
          eq(payrollComponentDrafts.companyId, input.companyId),
          eq(payrollComponentDrafts.employeeId, person.id),
          eq(payrollComponentDrafts.kind, "thr"),
          eq(payrollComponentDrafts.period, input.period),
          eq(payrollComponentDrafts.status, "draft"),
        ),
      );
    if (amount.lte(0)) {
      skipped += 1;
      continue;
    }
    await tx.insert(payrollComponentDrafts).values({
      companyId: input.companyId,
      employeeId: person.id,
      kind: "thr",
      period: input.period,
      amount: toDb(amount),
      basisSnapshot: {
        monthsOfService: months,
        monthlyWage: toDb(monthlyWage),
        joinedAt: person.joinedAt,
        asOf: end,
      },
      createdBy: input.userId,
    });
    created += 1;
    total = total.plus(amount);
  }
  return { created, skipped, total };
}

export interface ComponentDraftView {
  id: string;
  employeeId: string;
  kind: string;
  period: string;
  amount: string;
  status: string;
}

/** Membaca draf komponen aktif satu periode per karyawan (tanpa mengubah status). */
export async function peekComponentDrafts(
  tx: Tx,
  input: { companyId: string; period: string; kind: string },
): Promise<Map<string, { amount: Decimal; draftIds: string[] }>> {
  const rows = await tx
    .select()
    .from(payrollComponentDrafts)
    .where(
      and(
        eq(payrollComponentDrafts.companyId, input.companyId),
        eq(payrollComponentDrafts.kind, input.kind),
        eq(payrollComponentDrafts.period, input.period),
        eq(payrollComponentDrafts.status, "draft"),
      ),
    );
  const byEmployee = new Map<string, { amount: Decimal; draftIds: string[] }>();
  for (const row of rows) {
    const entry = byEmployee.get(row.employeeId) ?? { amount: d(0), draftIds: [] };
    entry.amount = entry.amount.plus(d(row.amount));
    entry.draftIds.push(row.id);
    byEmployee.set(row.employeeId, entry);
  }
  return byEmployee;
}

/**
 * Menandai draf satu periode sebagai consumed oleh run yang baru
 * dibuat. Berjalan di transaksi run yang sama — run yang
 * gagal/rollback tidak mengonsumsi apa pun.
 */
export async function markComponentDraftsConsumed(
  tx: Tx,
  input: { companyId: string; runId: string; period: string; kind: string },
): Promise<void> {
  await tx
    .update(payrollComponentDrafts)
    .set({ status: "consumed", consumedRunId: input.runId })
    .where(
      and(
        eq(payrollComponentDrafts.companyId, input.companyId),
        eq(payrollComponentDrafts.kind, input.kind),
        eq(payrollComponentDrafts.period, input.period),
        eq(payrollComponentDrafts.status, "draft"),
      ),
    );
}

/** Void run: draf yang terpakai run itu kembali menjadi draft (pola pemulihan kasbon). */
export async function restoreComponentDrafts(
  tx: Tx,
  input: { companyId: string; runId: string },
): Promise<void> {
  await tx
    .update(payrollComponentDrafts)
    .set({ status: "draft", consumedRunId: null })
    .where(
      and(
        eq(payrollComponentDrafts.companyId, input.companyId),
        eq(payrollComponentDrafts.consumedRunId, input.runId),
        eq(payrollComponentDrafts.status, "consumed"),
      ),
    );
}

/**
 * A-26 Q4 (K-03): pembatalan draf komponen payroll — dipindah utuh
 * dari voidComponentDraftAction; lapisan aksi kini hanya auth,
 * parsing, dan revalidasi. Perilaku & pesan identik.
 */
export async function voidComponentDraft(
  tx: Tx,
  input: { companyId: string; userId: string; id: string },
) {
  const [row] = await tx
    .update(payrollComponentDrafts)
    .set({ status: "void" })
    .where(
      and(
        eq(payrollComponentDrafts.companyId, input.companyId),
        eq(payrollComponentDrafts.id, input.id),
        eq(payrollComponentDrafts.status, "draft"),
      ),
    )
    .returning({ id: payrollComponentDrafts.id });
  if (!row) throw new AppError("INVALID_STATE", "Draf tidak ditemukan atau sudah terpakai.");
  await writeAudit(tx, {
    companyId: input.companyId,
    userId: input.userId,
    action: "payroll_component_draft.void",
    entityType: "payroll_component_draft",
    entityId: input.id,
    after: { status: "void" },
  });
}

/* ------------------------------------------------------------------ */
/* Cuti (§6C)                                                          */
/* ------------------------------------------------------------------ */
