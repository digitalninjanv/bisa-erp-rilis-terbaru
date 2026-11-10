import { and, asc, eq } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { companyRoles, member, user } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
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
