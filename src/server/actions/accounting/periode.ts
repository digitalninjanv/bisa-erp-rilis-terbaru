// A-26 Q4 (K-03): pecahan src/server/actions/accounting.ts per sub-domain (A-26 Q4). Nama aksi, skema Zod, izin, & payload tidak berubah; pemanggil kini mengimpor dari berkas sub-domain ini langsung (re-export silang antar berkas "use server" tidak dipakai — pelajaran A-24 T2).

"use server";

import {
  and,
  eq,
} from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { withCompany } from "@/db/tenant";
import { fiscalPeriods } from "@/db/schema";
import { ensureFiscalPeriods } from "@/server/accounting";
import {
  lockYearPeriods,
  postYearEndClosing,
} from "@/server/year-end-closing";

import { writeAudit } from "@/server/audit";
import { requirePermissionInModule } from "@/lib/session";
import { requireFreshSession } from "@/lib/session-freshness";

import {
  AppError,
  guard,
} from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

export async function setPeriodStatusAction(input: {
  year: number;
  month: number;
  status: "open" | "closed" | "locked";
  reason?: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({
        year: z.number().int().min(2000).max(2100),
        month: z.number().int().min(1).max(12),
        status: z.enum(["open", "closed", "locked"]),
        reason: z.string().trim().min(3).max(200).optional(),
      }),
      input,
    );
    await withCompany(ctx.company.id, async (tx) => {
      // FIX-P1 Tahap 3 (AK6-02): baris periode dikunci FOR UPDATE — kunci
      // yang sama diambil assertPeriodOpen di jalur posting, sehingga
      // penutupan terserialisasi dua arah terhadap posting yang sedang
      // berjalan (penutupan menunggu posting selesai; posting yang datang
      // sesudahnya membaca status terbaru dan ditolak).
      const [current] = await tx
        .select({ id: fiscalPeriods.id, status: fiscalPeriods.status })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.companyId, ctx.company.id),
            eq(fiscalPeriods.year, data.year),
            eq(fiscalPeriods.month, data.month),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) throw new AppError("NOT_FOUND", "Periode fiskal tidak ditemukan.");

      // AK-P2-01: membuka kembali periode yang sudah DIKUNCI bukan transisi
      // biasa. Hanya owner yang boleh, wajib dengan alasan, dan alasannya
      // tercatat di audit log. Transisi lain (open↔closed, close→lock) tetap
      // seperti sebelumnya. (FIX-P1 Tahap 3/AK1-01: bulan tanpa baris
      // periode kini dianggap TERTUTUP — lihat assertPeriodOpen; tahun di
      // luar jendela otomatis dibuat eksplisit lewat
      // seedMissingPeriodsAction.)
      const unlocking = current.status === "locked" && data.status !== "locked";
      if (unlocking) {
        if (ctx.role !== "owner") {
          throw new AppError(
            "FORBIDDEN",
            "Periode yang sudah dikunci hanya dapat dibuka kembali oleh pemilik (owner).",
          );
        }
        if (!data.reason) {
          throw new AppError(
            "VALIDATION",
            "Alasan membuka kembali periode yang dikunci wajib diisi (minimal 3 karakter).",
          );
        }
      }

      const [updated] = await tx
        .update(fiscalPeriods)
        .set({
          status: data.status,
          closedAt: data.status === "open" ? null : new Date(),
          closedBy: data.status === "open" ? null : ctx.user.id,
        })
        .where(
          and(
            eq(fiscalPeriods.companyId, ctx.company.id),
            eq(fiscalPeriods.year, data.year),
            eq(fiscalPeriods.month, data.month),
          ),
        )
        .returning({ id: fiscalPeriods.id });
      if (!updated) throw new AppError("NOT_FOUND", "Periode fiskal tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: `period.${data.status}`,
        entityType: "fiscal_period",
        entityId: updated.id,
        after: {
          year: data.year,
          month: data.month,
          status: data.status,
          ...(unlocking ? { previousStatus: current.status, reason: data.reason } : {}),
        },
      });
    });
    revalidatePath("/app/akuntansi");
    return data;
  });
}

export async function seedMissingPeriodsAction(input: { year: number }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    const data = parseInput(z.object({ year: z.number().int().min(2000).max(2100) }), input);
    // FIX-P1 Tahap 3 (AK1-01): sejak periode tanpa baris berarti TERTUTUP,
    // materialisasi adalah keputusan membuka tahun buku. Tahun berjalan &
    // berikutnya berada di jendela materialisasi otomatis (boleh oleh
    // pemegang accounting.manage, seperti sebelumnya); tahun di luar
    // jendela itu — terutama tahun lampau, vektor backdating — hanya
    // boleh dibuat oleh owner dan selalu tercatat di audit log.
    const currentYear = new Date().getFullYear();
    const inAutoWindow = data.year === currentYear || data.year === currentYear + 1;
    if (!inAutoWindow && ctx.role !== "owner") {
      throw new AppError(
        "FORBIDDEN",
        `Membuat periode tahun ${data.year} hanya dapat dilakukan oleh pemilik (owner), karena tahun tersebut berada di luar tahun berjalan dan tahun berikutnya.`,
      );
    }
    await withCompany(ctx.company.id, async (tx) => {
      const existing = await tx
        .select({ month: fiscalPeriods.month })
        .from(fiscalPeriods)
        .where(and(eq(fiscalPeriods.companyId, ctx.company.id), eq(fiscalPeriods.year, data.year)));
      const createdMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(
        (month) => !existing.some((row) => row.month === month),
      );
      await ensureFiscalPeriods(tx, ctx.company.id, data.year);
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "period.materialize",
        entityType: "fiscal_period",
        after: { year: data.year, createdMonths },
      });
    });
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/periode");
    return data;
  });
}

/**
 * FIX-P1 Tahap 5 (AK5-04 + AK1-05): posting jurnal penutup tahunan.
 * Pratinjau dihitung server di halaman Periode; aksi ini hanya menerima
 * tahun + akun laba ditahan pilihan pengguna dan menyerahkan seluruh
 * perhitungan ke domain `postYearEndClosing` (idempoten per tahun).
 */
export async function postYearEndClosingAction(input: {
  year: number;
  retainedEarningsAccountId: string;
}) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({
        year: z.number().int().min(2000).max(2100),
        retainedEarningsAccountId: z.string().uuid(),
      }),
      input,
    );
    const entry = await withCompany(ctx.company.id, (tx) =>
      postYearEndClosing(tx, {
        companyId: ctx.company.id,
        year: data.year,
        retainedEarningsAccountId: data.retainedEarningsAccountId,
        createdBy: ctx.user.id,
      }),
    );
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/periode");
    revalidatePath("/app/akuntansi/laporan");
    return entry;
  });
}

/**
 * FIX-P1 Tahap 5 (AK5-04): kunci ke-12 periode satu tahun — aksi
 * terpisah dan eksplisit sesudah tutup buku, bukan efek sampingnya.
 */
export async function lockYearPeriodsAction(input: { year: number }) {
  return guard(async () => {
    const ctx = await requirePermissionInModule("accounting.manage", "akuntansi");
    requireFreshSession(ctx);
    const data = parseInput(z.object({ year: z.number().int().min(2000).max(2100) }), input);
    const result = await withCompany(ctx.company.id, (tx) =>
      lockYearPeriods(tx, { companyId: ctx.company.id, year: data.year, userId: ctx.user.id }),
    );
    revalidatePath("/app/akuntansi");
    revalidatePath("/app/akuntansi/periode");
    return result;
  });
}
