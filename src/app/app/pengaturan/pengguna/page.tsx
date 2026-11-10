import { withCompanyReadOnly } from "@/db/tenant";
import { listCompanyMembers, listCustomRoles } from "@/server/member-permissions";
import { requirePermissionPage } from "@/lib/session";
import { BUILTIN_ROLES, BUILTIN_ROLE_KEYS, type RoleDefinition } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import { PageHeader } from "@/components/blocks/page-header";
import { SettingsPageFrame } from "@/components/pengaturan/settings-page-frame";
import { UserAccessManager, type RoleRow, type UserRow } from "@/components/pengaturan/user-access";

export const metadata = { title: "Pengguna & peran" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const ctx = await requirePermissionPage("users.manage");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [members, customRoles] = await Promise.all([
      listCompanyMembers(tx, ctx.company.id),
      listCustomRoles(tx, ctx.company.id),
    ]);
    return { members, customRoles };
  });

  const customByKey = new Map(data.customRoles.map((row) => [row.key, row]));

  function resolve(roleKey: string): { name: string; modules: ModuleKey[]; permissions: UserRow["permissions"] } {
    const builtin = BUILTIN_ROLES[roleKey];
    if (builtin) return builtin;
    const custom = customByKey.get(roleKey);
    if (custom) {
      return {
        name: custom.name,
        modules: custom.modules as ModuleKey[],
        permissions: custom.permissions as UserRow["permissions"],
      };
    }
    return { name: `${roleKey} (tidak ditemukan)`, modules: [], permissions: [] };
  }

  const memberCount = new Map<string, number>();
  for (const row of data.members) memberCount.set(row.role, (memberCount.get(row.role) ?? 0) + 1);

  const roleRows: RoleRow[] = [
    ...BUILTIN_ROLE_KEYS.map((key) => {
      const role = BUILTIN_ROLES[key] as RoleDefinition;
      return {
        id: null,
        key,
        name: role.name,
        modules: role.modules,
        permissions: role.permissions,
        builtin: true,
        members: memberCount.get(key) ?? 0,
      };
    }),
    ...data.customRoles.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      modules: row.modules as ModuleKey[],
      permissions: row.permissions as UserRow["permissions"],
      builtin: false,
      members: memberCount.get(row.key) ?? 0,
    })),
  ];

  const users: UserRow[] = data.members.map((row) => {
    const role = resolve(row.role);
    return {
      userId: row.userId,
      name: row.name,
      email: row.email,
      role: row.role,
      roleName: role.name,
      modules: role.modules,
      permissions: role.permissions,
      createdAt: row.createdAt.toISOString(),
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Pengaturan"
        title="Pengguna & peran"
        description="Buat akun login, tentukan modul yang bisa diakses, dan atur izin tindakan untuk setiap peran."
      />
      {/* A-25 U6: halaman ini ikut bingkai SettingsLayout yang
          sama; perubahan peran pengguna adalah saver seksinya,
          dialog buat/peran tetap simpan langsung (pola CRUD). */}
      <SettingsPageFrame>
        <UserAccessManager
          users={users}
          roles={roleRows}
          canAssignOwner={ctx.role === "owner"}
          currentUserId={ctx.user.id}
        />
      </SettingsPageFrame>
    </div>
  );
}
