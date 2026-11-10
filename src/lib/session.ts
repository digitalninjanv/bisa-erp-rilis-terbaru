import "server-only";

import { asc, eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { companyRoles, companySettings, member, organization } from "@/db/schema";
import { withCompanyReadOnly } from "@/db/tenant";
import { auth } from "@/lib/auth";
import { COMPANY_COOKIE_NAME, resolveMembership } from "@/lib/company-selection";
import {
  assertCan,
  builtinRole,
  can,
  modulesFor,
  permissionsFor,
  roleLabel,
  sanitizeModules,
  sanitizePermissions,
  withImpliedModules,
  type Permission,
} from "@/lib/permissions";
import { denialRedirectPath } from "@/lib/landing";
import {
  assertModuleEnabled,
  resolveModuleAccess,
  sanitizeEnabledModules,
  type ModuleKey,
} from "@/lib/modules";

export type CompanyContext = {
  user: { id: string; name: string; email: string; image?: string | null };
  /** createdAt = waktu masuk asli sesi (R3 K-5): refresh updateAge
   * Better Auth tidak pernah menggesernya, jadi umur sesi untuk
   * pemeriksaan kesegaran selalu diukur dari masuk terakhir. */
  session: { id: string; createdAt: Date };
  company: { id: string; name: string; slug: string; logo?: string | null };
  /** Every company the user belongs to, earliest membership first. */
  companies: { id: string; name: string }[];
  role: string;
  roleName: string;
  permissions: Permission[];
  /** Modules this account's role may enter. */
  modules: ModuleKey[];
  /**
   * Modules the company itself has switched on (T5-2, D-16). A module
   * is reachable only when it appears in both lists; Pengaturan and
   * Beranda are never switchable.
   */
  enabledModules: ModuleKey[];
};

export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

type MembershipRow = {
  role: string;
  companyId: string;
  companyName: string;
  companySlug: string;
  companyLogo: string | null;
};

/** All memberships of a user, earliest first (the resolution order). */
export async function listUserMemberships(userId: string): Promise<MembershipRow[]> {
  return db
    .select({
      role: member.role,
      companyId: organization.id,
      companyName: organization.name,
      companySlug: organization.slug,
      companyLogo: organization.logo,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
}

export async function requireAuth(): Promise<CompanyContext> {
  const session = await getSession();
  if (!session?.user) redirect("/login");

  const rows = await listUserMemberships(session.user.id);

  // LINTAS-01: the company cookie only chooses among the user's own
  // memberships; anything else falls back to the earliest membership.
  // Reading cookies can fail outside a request scope — that must never
  // lock a signed-in user out, so failures keep the default behaviour.
  let selectedCompanyId: string | undefined;
  try {
    selectedCompanyId = (await cookies()).get(COMPANY_COOKIE_NAME)?.value;
  } catch {
    selectedCompanyId = undefined;
  }

  const membership = resolveMembership(rows, selectedCompanyId);
  if (!membership) redirect("/login?error=no-company");

  let permissions = permissionsFor(membership.role);
  let modules = modulesFor(membership.role);
  let roleName = roleLabel(membership.role);

  if (!builtinRole(membership.role)) {
    const custom = await withCompanyReadOnly(membership.companyId, (tx) =>
      tx
        .select({
          name: companyRoles.name,
          modules: companyRoles.modules,
          permissions: companyRoles.permissions,
          isActive: companyRoles.isActive,
        })
        .from(companyRoles)
        .where(eq(companyRoles.key, membership.role))
        .limit(1),
    );
    if (custom[0]?.isActive) {
      roleName = custom[0].name;
      permissions = sanitizePermissions(custom[0].permissions);
      modules = sanitizeModules(custom[0].modules);
    } else {
      permissions = permissionsFor("viewer");
      modules = modulesFor("viewer");
      roleName = `${membership.role} (tidak ditemukan)`;
    }
  }

  // A-24 T2: lengkapi daftar modul dengan modul pemilik izin yang
  // dipegang (invarian yang sama dengan saveCompanyRoleAction). Tanpa
  // ini, peran kustom yang disimpan sebelum modul "hr" ada — berizin
  // payroll.* tetapi daftar modulnya hanya "akuntansi" — akan
  // kehilangan seluruh akses payroll begitu HR menjadi modul sendiri.
  modules = withImpliedModules(modules, permissions);

  // T5-2 (D-16): the company-level module switch lives on
  // company_settings; a company without a settings row (or without the
  // column set) keeps every module enabled.
  const enabledModules = await withCompanyReadOnly(membership.companyId, async (tx) => {
    const [settings] = await tx
      .select({ enabledModules: companySettings.enabledModules })
      .from(companySettings)
      .where(eq(companySettings.companyId, membership.companyId))
      .limit(1);
    return sanitizeEnabledModules(settings?.enabledModules);
  });

  return {
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    },
    session: { id: session.session.id, createdAt: session.session.createdAt },
    company: {
      id: membership.companyId,
      name: membership.companyName,
      slug: membership.companySlug,
      logo: membership.companyLogo,
    },
    companies: rows.map((row) => ({ id: row.companyId, name: row.companyName })),
    role: membership.role,
    roleName,
    permissions,
    modules,
    enabledModules,
  };
}

export async function requirePermission(permission: Permission): Promise<CompanyContext> {
  const ctx = await requireAuth();
  assertCan(ctx, permission);
  return ctx;
}

// R3 K-5: gerbang kesegaran sesi untuk operasi sensitif bernama.
// Implementasinya hidup di modul daun lib/session-freshness.ts
// (murni, tanpa dependensi sesi) dan di-re-export di sini agar
// permukaan DAL tetap satu pintu di samping requirePermission.
export { assertSessionFresh, requireFreshSession } from "@/lib/session-freshness";

/**
 * A-23 SIS-04: the PAGE variant of `requirePermission`. Server actions
 * keep the throwing guard above (their `guard(...)` translates the
 * AppError), but a page that throws lands on the generic error
 * boundary — in production the error message is stripped, so the
 * boundary cannot even tell a denial from a crash, and the user is
 * told to "try again" something that will never succeed. Pages
 * therefore bounce to a surface the user can open (their single
 * module's home, or Beranda) with `?forbidden=<permission>`, where the
 * explanation banner renders — the same shape as the module-level
 * denial in `requireModuleAccess` below.
 */
export async function requirePermissionPage(permission: Permission): Promise<CompanyContext> {
  const ctx = await requireAuth();
  if (can(ctx, permission)) return ctx;
  redirect(denialRedirectPath(ctx, permission));
}

/**
 * A-23 SIS-04: page variant of `requirePermissionInModule` — same two
 * checks, but a disabled module bounces with `?disabled=` exactly like
 * `requireModuleAccess` instead of throwing onto the error boundary.
 */
export async function requirePermissionPageInModule(
  permission: Permission,
  module: ModuleKey,
): Promise<CompanyContext> {
  const ctx = await requireAuth();
  if (!ctx.enabledModules.includes(module)) redirect(`/app?disabled=${module}`);
  if (can(ctx, permission)) return ctx;
  redirect(denialRedirectPath(ctx, permission));
}

/**
 * T5R-2: `requirePermission` plus the company module switch (D-16).
 * Write actions of a switchable module use this so a disabled module
 * rejects writes even from clients that never re-render a page (an
 * already-open POS terminal, a stale tab). Only the action layer is
 * gated — domain functions stay open for cross-module automation.
 */
export async function requirePermissionInModule(
  permission: Permission,
  module: ModuleKey,
): Promise<CompanyContext> {
  const ctx = await requirePermission(permission);
  assertModuleEnabled(ctx.enabledModules, module);
  return ctx;
}

export async function requireModuleAccess(module: ModuleKey): Promise<CompanyContext> {
  const ctx = await requireAuth();
  const decision = resolveModuleAccess(ctx.modules, ctx.enabledModules, module);
  if (decision === "denied") redirect(`/app?denied=${module}`);
  if (decision === "disabled") redirect(`/app?disabled=${module}`);
  return ctx;
}

export async function getCompanyId(): Promise<string> {
  return (await requireAuth()).company.id;
}
