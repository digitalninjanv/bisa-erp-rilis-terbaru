"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { account, companyRoles, member, session, user } from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { writeAudit } from "@/server/audit";
import { requirePermission } from "@/lib/session";
import { requireFreshSession } from "@/lib/session-freshness";
import { AppError, guard } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";
import {
  MODULE_PERMISSIONS,
  moduleForPermission,
  builtinRole,
  can,
  sanitizeModules,
  sanitizePermissions,
  type Permission,
} from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";

// A-13: skema di berkas ini wajib membawa pesan Bahasa Indonesia dan
// diurai lewat parseInput (bukan .parse mentah). Kegagalan Zod yang
// dibiarkan lolos sebagai ZodError diterjemahkan guard() menjadi
// INTERNAL "Terjadi kesalahan pada server" — persis keluhan pengguna
// bahwa tambah pengguna "eror", padahal penyebabnya validasi biasa
// (sandi < 8 karakter, email tak berformat, nama < 2 karakter).
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Format email tidak valid.")
  .max(160, "Email maksimal 160 karakter.");
const passwordSchema = z
  .string()
  .min(8, "Kata sandi minimal 8 karakter.")
  .max(128, "Kata sandi maksimal 128 karakter.");
const roleKeySchema = z
  .string()
  .trim()
  .min(1, "Peran wajib dipilih.")
  .max(60, "Kode peran maksimal 60 karakter.")
  .regex(/^[a-z0-9_-]+$/, "Kode peran tidak valid.");

async function assertRoleExists(
  tx: Parameters<Parameters<typeof withCompany>[1]>[0],
  companyId: string,
  role: string,
) {
  if (builtinRole(role)) return;
  const [custom] = await tx
    .select({ id: companyRoles.id, isActive: companyRoles.isActive })
    .from(companyRoles)
    .where(and(eq(companyRoles.companyId, companyId), eq(companyRoles.key, role)))
    .limit(1);
  if (!custom?.isActive) throw new AppError("VALIDATION", "Peran tidak ditemukan atau nonaktif.");
}

function assertCanAssignRole(actorRole: string, targetRole: string) {
  if ((targetRole === "owner" || targetRole === "admin") && actorRole !== "owner") {
    throw new AppError("FORBIDDEN", "Hanya owner yang dapat memberikan peran owner atau admin.");
  }
}

export async function createCompanyUserAction(input: {
  name: string;
  email: string;
  password: string;
  role: string;
}) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({
        name: z
          .string()
          .trim()
          .min(2, "Nama minimal 2 karakter.")
          .max(160, "Nama maksimal 160 karakter."),
        email: emailSchema,
        password: passwordSchema,
        role: roleKeySchema,
      }),
      input,
    );
    assertCanAssignRole(ctx.role, data.role);

    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(data.password);

    const result = await withCompany(ctx.company.id, async (tx) => {
      await assertRoleExists(tx, ctx.company.id, data.role);

      const [existing] = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, data.email))
        .limit(1);
      if (existing) throw new AppError("CONFLICT", "Email sudah terdaftar. Gunakan email lain.");

      await tx.insert(user).values({
        id: userId,
        name: data.name,
        email: data.email,
        emailVerified: true,
        role: "user",
      });
      await tx.insert(account).values({
        id: crypto.randomUUID(),
        accountId: userId,
        providerId: "credential",
        userId,
        password: passwordHash,
      });
      await tx.insert(member).values({
        id: crypto.randomUUID(),
        organizationId: ctx.company.id,
        userId,
        role: data.role,
      });

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "user.create",
        entityType: "user",
        entityId: userId,
        after: { email: data.email, name: data.name, role: data.role },
      });

      return { id: userId, name: data.name, email: data.email, role: data.role };
    });

    revalidatePath("/app/pengaturan/pengguna");
    return result;
  });
}

export async function updateUserRoleAction(input: { userId: string; role: string }) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({ userId: z.string().min(1, "Pengguna tidak valid."), role: roleKeySchema }),
      input,
    );
    if (data.userId === ctx.user.id) {
      throw new AppError("VALIDATION", "Tidak bisa mengubah peran akun sendiri.");
    }
    assertCanAssignRole(ctx.role, data.role);

    await withCompany(ctx.company.id, async (tx) => {
      await assertRoleExists(tx, ctx.company.id, data.role);
      const [target] = await tx
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, data.userId)))
        .limit(1);
      if (!target) throw new AppError("NOT_FOUND", "Anggota tidak ditemukan.");
      if (target.role === "owner" && ctx.role !== "owner") {
        throw new AppError("FORBIDDEN", "Hanya owner yang dapat mengubah peran owner.");
      }
      if (target.role === "owner" && data.role !== "owner") {
        const [owners] = await tx
          .select({ value: sql<number>`count(*)::int` })
          .from(member)
          .where(and(eq(member.organizationId, ctx.company.id), eq(member.role, "owner")));
        if ((owners?.value ?? 0) <= 1) {
          throw new AppError("VALIDATION", "Minimal harus ada satu owner di perusahaan.");
        }
      }
      const [row] = await tx
        .update(member)
        .set({ role: data.role })
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, data.userId)))
        .returning({ id: member.id });
      if (!row) throw new AppError("NOT_FOUND", "Anggota tidak ditemukan.");
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "user.role.update",
        entityType: "member",
        entityId: row.id,
        after: { userId: data.userId, role: data.role },
      });
    });

    revalidatePath("/app/pengaturan/pengguna");
    return data;
  });
}

export async function updateUserRolesBatchAction(input: {
  updates: { userId: string; role: string }[];
}) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({
        updates: z
          .array(
            z.object({
              userId: z.string().min(1, "Pengguna tidak valid."),
              role: roleKeySchema,
            }),
          )
          .min(1, "Daftar perubahan peran kosong."),
      }),
      input,
    );

    for (const item of data.updates) {
      if (item.userId === ctx.user.id) {
        throw new AppError("VALIDATION", "Tidak bisa mengubah peran akun sendiri.");
      }
      assertCanAssignRole(ctx.role, item.role);
    }

    await withCompany(ctx.company.id, async (tx) => {
      const uniqueRoles = [...new Set(data.updates.map((u) => u.role))];
      for (const r of uniqueRoles) {
        await assertRoleExists(tx, ctx.company.id, r);
      }

      const [ownersCountRow] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.role, "owner")));
      let remainingOwners = ownersCountRow?.value ?? 0;

      for (const item of data.updates) {
        const [target] = await tx
          .select({ role: member.role })
          .from(member)
          .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, item.userId)))
          .limit(1);
        if (!target) throw new AppError("NOT_FOUND", `Anggota dengan ID ${item.userId} tidak ditemukan.`);
        if (target.role === "owner" && ctx.role !== "owner") {
          throw new AppError("FORBIDDEN", "Hanya owner yang dapat mengubah peran owner.");
        }
        if (target.role === "owner" && item.role !== "owner") {
          remainingOwners -= 1;
        } else if (target.role !== "owner" && item.role === "owner") {
          remainingOwners += 1;
        }
      }

      if (remainingOwners < 1) {
        throw new AppError("VALIDATION", "Minimal harus ada satu owner di perusahaan.");
      }

      for (const item of data.updates) {
        const [row] = await tx
          .update(member)
          .set({ role: item.role })
          .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, item.userId)))
          .returning({ id: member.id });
        if (row) {
          await writeAudit(tx, {
            companyId: ctx.company.id,
            userId: ctx.user.id,
            action: "user.role.update",
            entityType: "member",
            entityId: row.id,
            after: { userId: item.userId, role: item.role },
          });
        }
      }
    });

    revalidatePath("/app/pengaturan/pengguna");
    return data;
  });
}

export async function resetUserPasswordAction(input: { userId: string; password: string }) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const data = parseInput(
      z.object({ userId: z.string().min(1, "Pengguna tidak valid."), password: passwordSchema }),
      input,
    );
    const passwordHash = await hashPassword(data.password);

    await withCompany(ctx.company.id, async (tx) => {
      const [membership] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, data.userId)))
        .limit(1);
      if (!membership) throw new AppError("NOT_FOUND", "Anggota tidak ditemukan.");
      if (membership.role === "owner" && ctx.role !== "owner") {
        throw new AppError("FORBIDDEN", "Kata sandi owner hanya bisa direset oleh owner.");
      }
      if (membership.role === "admin" && ctx.role !== "owner") {
        throw new AppError("FORBIDDEN", "Kata sandi admin hanya bisa direset oleh owner.");
      }

      const [credential] = await tx
        .select({ id: account.id })
        .from(account)
        .where(and(eq(account.userId, data.userId), eq(account.providerId, "credential")))
        .limit(1);
      if (credential) {
        await tx
          .update(account)
          .set({ password: passwordHash, updatedAt: new Date() })
          .where(eq(account.id, credential.id));
      } else {
        await tx.insert(account).values({
          id: crypto.randomUUID(),
          accountId: data.userId,
          providerId: "credential",
          userId: data.userId,
          password: passwordHash,
        });
      }

      // Reset password harus memutus sesi lama (mis. akun compromized).
      await tx.delete(session).where(eq(session.userId, data.userId));

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "user.password.reset",
        entityType: "user",
        entityId: data.userId,
      });
    });

    revalidatePath("/app/pengaturan/pengguna");
    return { userId: data.userId };
  });
}

export async function removeCompanyUserAction(userId: string) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const targetUserId = parseInput(z.string().min(1, "Pengguna tidak valid."), userId);
    if (targetUserId === ctx.user.id) {
      throw new AppError("VALIDATION", "Tidak bisa menghapus akun sendiri.");
    }

    await withCompany(ctx.company.id, async (tx) => {
      const [target] = await tx
        .select({ id: member.id, role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, targetUserId)))
        .limit(1);
      if (!target) throw new AppError("NOT_FOUND", "Anggota tidak ditemukan.");
      if (target.role === "owner") {
        throw new AppError("VALIDATION", "Peran owner tidak bisa dihapus dari perusahaan.");
      }

      await tx
        .delete(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.userId, targetUserId)));

      await tx.delete(session).where(eq(session.userId, targetUserId));

      const [remaining] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(member)
        .where(eq(member.userId, targetUserId));
      if ((remaining?.value ?? 0) === 0) {
        await tx
          .update(user)
          .set({ banned: true, banReason: "Keanggotaan perusahaan dicabut" })
          .where(eq(user.id, targetUserId));
      }

      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "user.remove",
        entityType: "member",
        entityId: target.id,
        before: { userId: targetUserId, role: target.role },
      });
    });

    revalidatePath("/app/pengaturan/pengguna");
    return { userId: targetUserId };
  });
}

const roleWriteSchema = z.object({
  id: z.string().uuid("ID peran tidak valid.").optional(),
  name: z
    .string()
    .trim()
    .min(2, "Nama peran minimal 2 karakter.")
    .max(80, "Nama peran maksimal 80 karakter."),
  modules: z.array(z.string()).max(5),
  permissions: z.array(z.string()).max(100),
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export async function saveCompanyRoleAction(input: z.input<typeof roleWriteSchema>) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const data = parseInput(roleWriteSchema, input);
    const modules = sanitizeModules(data.modules) as ModuleKey[];
    const permissions = sanitizePermissions(data.permissions) as Permission[];
    if (modules.length === 0) throw new AppError("VALIDATION", "Pilih minimal satu modul.");
    if (permissions.length === 0) throw new AppError("VALIDATION", "Pilih minimal satu izin.");
    if (ctx.role !== "owner") {
      for (const permission of permissions) {
        if (!can(ctx, permission)) {
          throw new AppError(
            "FORBIDDEN",
            `Anda tidak dapat memberikan izin "${permission}" yang tidak Anda miliki.`,
          );
        }
      }
    }
    for (const permission of permissions) {
      const moduleKey = moduleForPermission(permission);
      if (moduleKey && !modules.includes(moduleKey)) modules.push(moduleKey);
    }
    for (const moduleKey of modules) {
      if (!permissions.some((permission) => MODULE_PERMISSIONS[moduleKey].includes(permission))) {
        throw new AppError("VALIDATION", `Modul ${moduleKey} belum memiliki izin. Centang minimal satu izin modul itu.`);
      }
    }

    const result = await withCompany(ctx.company.id, async (tx) => {
      if (data.id) {
        const [existing] = await tx
          .select({ id: companyRoles.id, key: companyRoles.key })
          .from(companyRoles)
          .where(and(eq(companyRoles.companyId, ctx.company.id), eq(companyRoles.id, data.id)))
          .limit(1);
        if (!existing) throw new AppError("NOT_FOUND", "Peran tidak ditemukan.");
        if (builtinRole(existing.key)) throw new AppError("VALIDATION", "Peran bawaan tidak bisa diubah.");
        if (existing.key === ctx.role) {
          throw new AppError(
            "FORBIDDEN",
            "Anda tidak dapat mengubah peran yang sedang Anda pakai sendiri. Minta owner atau pengguna lain yang berwenang.",
          );
        }

        const [row] = await tx
          .update(companyRoles)
          .set({ name: data.name, modules, permissions, updatedAt: new Date() })
          .where(and(eq(companyRoles.companyId, ctx.company.id), eq(companyRoles.id, data.id)))
          .returning({ id: companyRoles.id, key: companyRoles.key });
        await writeAudit(tx, {
          companyId: ctx.company.id,
          userId: ctx.user.id,
          action: "role.update",
          entityType: "company_role",
          entityId: row.id,
          after: { name: data.name, modules, permissions },
        });
        return row;
      }

      const baseKey = slugify(data.name);
      if (!baseKey) throw new AppError("VALIDATION", "Nama peran tidak valid.");
      if (builtinRole(baseKey)) throw new AppError("VALIDATION", "Nama peran bentrok dengan peran bawaan.");
      const [conflict] = await tx
        .select({ id: companyRoles.id })
        .from(companyRoles)
        .where(and(eq(companyRoles.companyId, ctx.company.id), eq(companyRoles.key, baseKey)))
        .limit(1);
      if (conflict) throw new AppError("CONFLICT", "Peran dengan nama itu sudah ada.");

      const [row] = await tx
        .insert(companyRoles)
        .values({
          companyId: ctx.company.id,
          key: baseKey,
          name: data.name,
          modules,
          permissions,
        })
        .returning({ id: companyRoles.id, key: companyRoles.key });
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "role.create",
        entityType: "company_role",
        entityId: row.id,
        after: { key: row.key, name: data.name, modules, permissions },
      });
      return row;
    });

    revalidatePath("/app/pengaturan/pengguna");
    revalidatePath("/app");
    return result;
  });
}

export async function deleteCompanyRoleAction(id: string) {
  return guard(async () => {
    const ctx = await requirePermission("users.manage");
    requireFreshSession(ctx);
    const roleId = parseInput(z.string().uuid("ID peran tidak valid."), id);

    await withCompany(ctx.company.id, async (tx) => {
      const [role] = await tx
        .select({ id: companyRoles.id, key: companyRoles.key })
        .from(companyRoles)
        .where(and(eq(companyRoles.companyId, ctx.company.id), eq(companyRoles.id, roleId)))
        .limit(1);
      if (!role) throw new AppError("NOT_FOUND", "Peran tidak ditemukan.");
      if (builtinRole(role.key)) throw new AppError("VALIDATION", "Peran bawaan tidak bisa dihapus.");

      const [used] = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(member)
        .where(and(eq(member.organizationId, ctx.company.id), eq(member.role, role.key)));
      if ((used?.value ?? 0) > 0) {
        throw new AppError("CONFLICT", "Peran masih dipakai anggota. Pindahkan anggota ke peran lain dulu.");
      }

      await tx
        .delete(companyRoles)
        .where(and(eq(companyRoles.companyId, ctx.company.id), eq(companyRoles.id, roleId)));
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "role.delete",
        entityType: "company_role",
        entityId: roleId,
      });
    });

    revalidatePath("/app/pengaturan/pengguna");
    return { id: roleId };
  });
}
