import { and, asc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { companyRoles, member, session, user } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { writeAudit } from "@/server/audit";
import {
  builtinRole,
  permissionsFor,
  sanitizePermissions,
  type Permission,
} from "@/lib/permissions";

/**
 * FIX-POS Tahap 2 (POS3-02): izin seorang pengguna DI SEBUAH perusahaan
 * dinilai dari keanggotaannya — dipakai untuk menilai hak KASIR ASAL
 * penjualan offline (bukan hak penyinkron). Semantiknya meniru persis
 * `requireAuth`: peran bawaan dari peta peran; peran kustom dari
 * `company_roles` (nonaktif/tidak ditemukan → viewer); bukan anggota →
 * null.
 */
export async function resolveMemberPermissions(
  companyId: string,
  userId: string,
): Promise<Permission[] | null> {
  const [row] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, companyId), eq(member.userId, userId)))
    .limit(1);
  if (!row) return null;
  if (builtinRole(row.role)) return permissionsFor(row.role);
  const custom = await withCompanyReadOnly(companyId, (tx) =>
    tx
      .select({ permissions: companyRoles.permissions, isActive: companyRoles.isActive })
      .from(companyRoles)
      .where(eq(companyRoles.key, row.role))
      .limit(1),
  );
  if (custom[0]?.isActive) return sanitizePermissions(custom[0].permissions);
  return permissionsFor("viewer");
}

/** Bentuk ringkas yang dipakai jalur sinkronisasi offline. */
export type OriginEntitlement = { canSell: boolean; canDiscount: boolean };

export async function resolveOriginEntitlement(
  companyId: string,
  userId: string,
): Promise<OriginEntitlement | null> {
  const permissions = await resolveMemberPermissions(companyId, userId);
  if (!permissions) return null;
  return {
    canSell: permissions.includes("pos.sell"),
    canDiscount: permissions.includes("pos.discount"),
  };
}

// ---------------------------------------------------------------------------
// Fungsi baca halaman (FIX-ARS Tahap 6, ARS1-01): daftar anggota & peran
// kustom untuk halaman Pengguna & peran — dulu kueri inline ber-join di
// halaman. Badan kueri dipindah apa adanya.
// ---------------------------------------------------------------------------

export async function listCompanyMembers(tx: Tx, companyId: string) {
  return tx
    .select({
      userId: user.id,
      name: user.name,
      email: user.email,
      role: member.role,
      createdAt: member.createdAt,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, companyId))
    .orderBy(asc(user.name));
}

export async function listCustomRoles(tx: Tx, companyId: string) {
  return tx
    .select()
    .from(companyRoles)
    .where(eq(companyRoles.companyId, companyId))
    .orderBy(asc(companyRoles.name));
}

/**
 * Mencabut akses aplikasi seorang karyawan saat terminasi (offboarding).
 * Menghapus keanggotaan organisasi dan menginvalasi sesi aktifnya
 * sesuai standar keamanan NIST SP 800-53 PS-4 / OWASP IAM.
 */
export async function revokeEmployeeUserAccess(
  tx: Tx,
  companyId: string,
  employeeName: string,
  actorUserId?: string,
): Promise<{
  revoked: boolean;
  userId?: string;
  reason?: "not_found" | "ambiguous" | "owner_only";
}> {
  const matchedUsers = await tx
    .select({
      id: user.id,
      name: user.name,
      memberId: member.id,
      role: member.role,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(and(eq(member.organizationId, companyId), eq(user.name, employeeName)));

  if (matchedUsers.length === 0) {
    return { revoked: false, reason: "not_found" };
  }

  // HR-01: display names are not unique identities. Never mass-revoke all
  // accounts that happen to share a name; require an unambiguous match and
  // let a human resolve the ambiguous case in Pengaturan → Pengguna.
  const candidates = matchedUsers.filter((row) => row.role !== "owner");
  if (candidates.length === 0) {
    return { revoked: false, reason: "owner_only" };
  }
  if (candidates.length > 1) {
    return { revoked: false, reason: "ambiguous" };
  }

  const u = candidates[0];
  await tx
    .delete(member)
    .where(and(eq(member.organizationId, companyId), eq(member.userId, u.id)));

  await tx.delete(session).where(eq(session.userId, u.id));

  if (actorUserId) {
    await writeAudit(tx, {
      companyId,
      userId: actorUserId,
      action: "user.remove",
      entityType: "member",
      entityId: u.memberId,
      before: { userId: u.id, role: u.role, reason: "employee_termination" },
    });
  }

  return { revoked: true, userId: u.id };
}
