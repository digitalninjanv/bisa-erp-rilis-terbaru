"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getSession } from "@/lib/session";
import { COMPANY_COOKIE_NAME } from "@/lib/company-selection";
import { AppError, guard } from "@/lib/errors";

/**
 * Switches the active company for a multi-company user (LINTAS-01).
 *
 * The choice is stored in an httpOnly cookie that carries only the
 * company id — role and permissions are always re-read from the target
 * company's membership on the server (see requireAuth). Membership is
 * validated here before the cookie is written, and requireAuth
 * re-validates it on every request via resolveMembership, so a forged
 * or stale cookie can never cross into another tenant.
 */
export async function switchCompanyAction(companyId: string) {
  return guard(async () => {
    const session = await getSession();
    if (!session?.user) {
      throw new AppError("FORBIDDEN", "Sesi tidak ditemukan. Silakan masuk kembali.");
    }
    const targetId = typeof companyId === "string" ? companyId.trim() : "";
    if (!targetId) {
      throw new AppError("VALIDATION", "Perusahaan tujuan wajib dipilih.");
    }

    const [membership] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.userId, session.user.id), eq(member.organizationId, targetId)))
      .limit(1);
    if (!membership) {
      throw new AppError("FORBIDDEN", "Anda bukan anggota perusahaan tersebut.");
    }

    (await cookies()).set(COMPANY_COOKIE_NAME, targetId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      // T4R-8: samakan dengan cookie sesi — hanya dikirim lewat HTTPS di
      // produksi (pengembangan lokal tetap HTTP).
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
    revalidatePath("/app", "layout");
    return { companyId: targetId };
  });
}
