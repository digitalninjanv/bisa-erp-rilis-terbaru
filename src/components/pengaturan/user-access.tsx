"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Plus, Search, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import { Field } from "@/components/blocks/field";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import {
  DataTable,
  DataTableColumnHeader,
  DataTableToolbar,
} from "@/components/blocks/data-table";
import { Modal } from "@/components/blocks/modal";
import { MODULE_PERMISSIONS, PERMISSIONS, type Permission } from "@/lib/permissions";
import type { ModuleKey } from "@/lib/modules";
import {
  createCompanyUserAction,
  deleteCompanyRoleAction,
  removeCompanyUserAction,
  resetUserPasswordAction,
  saveCompanyRoleAction,
  updateUserRolesBatchAction,
} from "@/server/actions/users";

export type UserRow = {
  userId: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  modules: ModuleKey[];
  permissions: Permission[];
  createdAt: string;
};

export type RoleRow = {
  id: string | null;
  key: string;
  name: string;
  modules: ModuleKey[];
  permissions: Permission[];
  builtin: boolean;
  members: number;
};

const MODULE_LABELS: Record<ModuleKey, string> = {
  pos: "POS",
  gudang: "Gudang",
  akuntansi: "Akuntansi",
  hr: "HR",
  analisa: "Analisa",
};

const DEFAULT_PERMISSION: Record<ModuleKey, Permission> = {
  pos: "pos.sell",
  gudang: "inventory.view",
  akuntansi: "accounting.view",
  hr: "payroll.view",
  analisa: "analytics.view",
};

export function UserAccessManager({
  users,
  roles,
  canAssignOwner,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleRow[];
  canAssignOwner: boolean;
  currentUserId: string;
}) {
  const [tab, setTab] = useState<"pengguna" | "peran">("pengguna");

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {[
          { key: "pengguna" as const, label: `Pengguna (${users.length})` },
          { key: "peran" as const, label: `Peran (${roles.length})` },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`inline-flex h-11 items-center rounded-full px-3 text-[11px] font-medium lg:h-8 ${
              tab === item.key ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "pengguna" ? (
        <UsersPanel users={users} roles={roles} canAssignOwner={canAssignOwner} currentUserId={currentUserId} />
      ) : (
        <RolesPanel roles={roles} />
      )}
    </div>
  );
}

function UsersPanel({
  users,
  roles,
  canAssignOwner,
  currentUserId,
}: {
  users: UserRow[];
  roles: RoleRow[];
  canAssignOwner: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [roleDraft, setRoleDraft] = useState<Record<string, string>>(
    Object.fromEntries(users.map((row) => [row.userId, row.role])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [removingUser, setRemovingUser] = useState<UserRow | null>(null);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  // A-25 U6 (POLA-05/PNG-06, diperkuat MD-03): perubahan peran semua pengguna
  // tersimpan atomik dalam satu transaksi via updateUserRolesBatchAction
  // (aturan owner/diri sendiri tidak berubah: baris diri sendiri
  // tetap terkunci dan tidak pernah ikut tersimpan).
  async function saveAllRoles() {
    const changed = users.filter(
      (user) =>
        user.userId !== currentUserId &&
        (roleDraft[user.userId] ?? user.role) !== user.role,
    );
    if (changed.length === 0) return;
    const updates = changed.map((user) => ({
      userId: user.userId,
      role: roleDraft[user.userId] ?? user.role,
    }));
    const result = await updateUserRolesBatchAction({ updates });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    toast.success("Perubahan peran berhasil disimpan.");
    router.refresh();
  }

  const { setDirty } = useSettingsSection("peran-pengguna", saveAllRoles);
  const anyRoleChanged = users.some(
    (user) => (roleDraft[user.userId] ?? user.role) !== user.role,
  );

  useEffect(() => {
    setDirty(anyRoleChanged);
  }, [anyRoleChanged, setDirty]);

  function roleControl(user: UserRow, self: boolean) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <select
          value={roleDraft[user.userId] ?? user.role}
          onChange={(event) =>
            setRoleDraft((current) => ({ ...current, [user.userId]: event.target.value }))
          }
          disabled={self}
          aria-label={`Peran ${user.name}`}
          className="h-11 min-w-[150px] rounded-md border border-input bg-background px-2 text-[12px] disabled:opacity-60 lg:h-9 lg:text-[11px]"
        >
          {roles.map((row) => (
            <option key={row.key} value={row.key} disabled={row.key === "owner" && !canAssignOwner}>
              {row.name}
              {row.builtin ? "" : " (kustom)"}
            </option>
          ))}
        </select>
        {!self && (roleDraft[user.userId] ?? user.role) !== user.role ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-tone-amber">
            <span aria-hidden className="size-1.5 rounded-full bg-tone-amber" />
            Berubah
          </span>
        ) : null}
      </span>
    );
  }

  function userActions(user: UserRow, self: boolean) {
    const items = [
      ...(canAssignOwner || user.role !== "owner"
        ? [{ key: "reset", label: "Reset kata sandi" }]
        : []),
      ...(!self && user.role !== "owner"
        ? [{ key: "remove", label: "Cabut akses", danger: true, disabled: busy === `remove:${user.userId}` }]
        : []),
    ];
    if (items.length === 0) return null;
    return (
      <RowMenu
        label={`Aksi untuk pengguna ${user.name}`}
        items={items}
        onAction={(key) => {
          if (key === "reset") setResetFor(user);
          if (key === "remove") setRemovingUser(user);
        }}
      />
    );
  }

  const columns: ColumnDef<UserRow>[] = [
    {
      id: "name",
      accessorFn: (user) => `${user.name} ${user.email}`,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Pengguna" />,
      enableHiding: false,
      cell: ({ row }) => {
        const user = row.original;
        const self = user.userId === currentUserId;
        return (
          <div>
            <p className="text-[12px] font-medium">
              {user.name}
              {self ? (
                <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  Anda
                </span>
              ) : null}
            </p>
            <p className="text-[11px] text-muted-foreground">{user.email}</p>
          </div>
        );
      },
    },
    {
      id: "roleName",
      accessorFn: (user) => user.roleName,
      header: ({ column }) => <DataTableColumnHeader column={column} title="Peran" />,
      cell: ({ row }) => roleControl(row.original, row.original.userId === currentUserId),
    },
    {
      id: "modules",
      accessorFn: (user) => user.modules.map((module) => MODULE_LABELS[module] ?? module).join(" "),
      header: ({ column }) => <DataTableColumnHeader column={column} title="Modul" />,
      cell: ({ row }) => {
        const user = row.original;
        const role = roles.find((entry) => entry.key === user.role);
        return (
          <div>
            <div className="flex flex-wrap gap-1">
              {user.modules.length === 0 ? (
                <span className="text-[11px] text-muted-foreground">Tanpa modul</span>
              ) : (
                user.modules.map((module) => (
                  <span key={module} className="rounded-full bg-tone-teal-soft px-1.5 py-0.5 text-[11px] font-semibold text-tone-teal">
                    {MODULE_LABELS[module] ?? module}
                  </span>
                ))
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {role?.permissions.length ?? user.permissions.length} izin
            </p>
          </div>
        );
      },
    },
    {
      id: "createdAt",
      accessorKey: "createdAt",
      header: ({ column }) => <DataTableColumnHeader column={column} title="Dibuat" />,
      cell: ({ row }) => (
        <span className="num whitespace-nowrap text-[11px] text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
        </span>
      ),
    },
    {
      id: "actions",
      header: () => <span className="block text-right text-[12px] font-medium text-muted-foreground">Aksi</span>,
      enableSorting: false,
      enableHiding: false,
      enableGlobalFilter: false,
      cell: ({ row }) => (
        <div className="flex items-center justify-end">
          {userActions(row.original, row.original.userId === currentUserId)}
        </div>
      ),
    },
  ];

  // TanStack Table intentionally exposes non-memoizable functions.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: users,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: "includesString",
  });

  async function remove(user: UserRow) {
    setBusy(`remove:${user.userId}`);
    const result = await removeCompanyUserAction(user.userId);
    setBusy(null);
    setRemovingUser(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Akses pengguna dicabut.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Users className="size-3.5 text-muted-foreground" /> Akun pengguna
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Buat akun login, atur peran, reset kata sandi, dan cabut akses.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted lg:h-8"
        >
          <UserPlus className="size-3.5" /> Pengguna baru
        </button>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <DataTableToolbar
          table={table}
          columnLabels={{ name: "Pengguna", roleName: "Peran", modules: "Modul", createdAt: "Dibuat" }}
          search={
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder="Cari nama, email, atau peran…"
                aria-label="Cari pengguna"
                className={`${fieldClass} h-11 pl-8 lg:h-9`}
              />
            </div>
          }
        />
        <DataTable
          table={table}
          density="normal"
          ariaLabel="Tabel pengguna dan peran"
          emptyState={<span>Belum ada pengguna.</span>}
          mobileCard={(user) => {
            const self = user.userId === currentUserId;
            return (
              <div className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {user.name}
                      {self ? (
                        <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                          Anda
                        </span>
                      ) : null}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
                  </div>
                  <div className="shrink-0">{userActions(user, self)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {roleControl(user, self)}
                  {user.modules.map((module) => (
                    <span key={module} className="rounded-full bg-tone-teal-soft px-1.5 py-0.5 text-[11px] font-semibold text-tone-teal">
                      {MODULE_LABELS[module] ?? module}
                    </span>
                  ))}
                </div>
                <p className="mt-1.5 num text-[11px] text-muted-foreground">
                  Dibuat {formatDateTime(user.createdAt)}
                </p>
              </div>
            );
          }}
        />
      </section>

      {createOpen ? (
        <CreateUserModal
          roles={roles}
          canAssignOwner={canAssignOwner}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            router.refresh();
          }}
        />
      ) : null}

      {resetFor ? (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onSaved={() => {
            setResetFor(null);
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removingUser !== null}
        title={removingUser ? `Cabut akses ${removingUser.name} (${removingUser.email}) dari perusahaan ini?` : ""}
        description="Pengguna tidak lagi bisa masuk ke perusahaan ini. Akunnya sendiri tidak dihapus."
        confirmLabel="Cabut akses"
        danger
        busy={busy !== null}
        onConfirm={() => {
          if (removingUser) void remove(removingUser);
        }}
        onCancel={() => setRemovingUser(null)}
      />
    </div>
  );
}

function CreateUserModal({
  roles,
  canAssignOwner,
  onClose,
  onSaved,
}: {
  roles: RoleRow[];
  canAssignOwner: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: roles.find((row) => row.key === "cashier")?.key ?? roles[0]?.key ?? "",
  });
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await createCompanyUserAction(form);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Akun ${result.data.email} dibuat.`);
    onSaved();
  }

  return (
    <Modal title="Pengguna baru" onClose={onClose} onSubmit={submit} busy={busy}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Nama" required className="sm:col-span-2">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Email login" required>
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={fieldClass} placeholder="nama@toko.id" />
        </Field>
        <Field label="Kata sandi" required>
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={fieldClass} placeholder="Minimal 8 karakter" />
        </Field>
        <Field label="Peran" required className="sm:col-span-2">
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })} className={fieldClass}>
            {roles.map((row) => (
              <option key={row.key} value={row.key} disabled={row.key === "owner" && !canAssignOwner}>
                {row.name}
                {row.builtin ? "" : " (kustom)"} · {row.modules.map((m) => MODULE_LABELS[m]).join(", ")}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-[10px] leading-4 text-muted-foreground sm:col-span-2">
          Pengguna langsung bisa login dengan email dan kata sandi ini. Modul dan izin mengikuti peran yang dipilih.
        </p>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    const result = await resetUserPasswordAction({ userId: user.userId, password });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Kata sandi diperbarui.");
    onSaved();
  }

  return (
    <Modal title={`Reset kata sandi · ${user.name}`} onClose={onClose} onSubmit={submit} busy={busy}>
      <Field label="Kata sandi baru" required>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className={fieldClass} placeholder="Minimal 8 karakter" />
      </Field>
    </Modal>
  );
}

function RolesPanel({ roles }: { roles: RoleRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [removingRole, setRemovingRole] = useState<RoleRow | null>(null);

  async function remove(role: RoleRow) {
    if (!role.id) return;
    setBusy(role.key);
    const result = await deleteCompanyRoleAction(role.id);
    setBusy(null);
    setRemovingRole(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Peran dihapus.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <ShieldCheck className="size-3.5 text-muted-foreground" /> Peran & hak akses
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Peran menentukan modul yang bisa dibuka dan izin di dalamnya. Peran bawaan hanya bisa dilihat.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="inline-flex h-11 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted lg:h-8"
        >
          <Plus className="size-3.5" /> Peran baru
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {roles.map((role) => (
          <section key={role.key} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold">
                  {role.name}
                  {role.builtin ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Bawaan</span>
                  ) : (
                    <span className="ml-1.5 rounded-full bg-[#f1e8ee] px-1.5 py-0.5 text-[11px] font-semibold text-[#714b67]">Kustom</span>
                  )}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {role.members} anggota · {role.permissions.length} izin
                </p>
              </div>
              {!role.builtin ? (
                <RowMenu
                  label={`Aksi untuk peran ${role.name}`}
                  items={[
                    { key: "edit", label: "Ubah" },
                    { key: "delete", label: "Hapus peran", danger: true, disabled: busy === role.key },
                  ]}
                  onAction={(key) => {
                    if (key === "edit") setEditing(role);
                    if (key === "delete") setRemovingRole(role);
                  }}
                />
              ) : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {role.modules.map((module) => (
                <span key={module} className="rounded-full bg-tone-teal-soft px-1.5 py-0.5 text-[11px] font-semibold text-tone-teal">
                  {MODULE_LABELS[module]}
                </span>
              ))}
              {role.modules.length === 0 ? <span className="text-[10px] text-muted-foreground">Tanpa modul</span> : null}
            </div>
            <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground">
              {role.permissions.map((permission) => PERMISSIONS[permission]).join(" · ")}
            </p>
          </section>
        ))}
      </div>

      {createOpen || editing ? (
        <RoleModal
          role={editing}
          onClose={() => {
            setCreateOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setCreateOpen(false);
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removingRole !== null}
        title={removingRole ? `Hapus peran "${removingRole.name}"?` : ""}
        description="Peran yang masih dipakai pengguna tidak bisa dihapus."
        confirmLabel="Hapus peran"
        danger
        busy={busy !== null}
        onConfirm={() => {
          if (removingRole) void remove(removingRole);
        }}
        onCancel={() => setRemovingRole(null)}
      />
    </div>
  );
}

function RoleModal({
  role,
  onClose,
  onSaved,
}: {
  role: RoleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [modules, setModules] = useState<ModuleKey[]>(role?.modules ?? []);
  const [permissions, setPermissions] = useState<Permission[]>(role?.permissions ?? []);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(
    () =>
      (Object.keys(MODULE_PERMISSIONS) as ModuleKey[]).map((module) => ({
        module,
        items: MODULE_PERMISSIONS[module].map((permission) => ({
          key: permission,
          label: PERMISSIONS[permission],
        })),
      })),
    [],
  );

  function toggleModule(module: ModuleKey, checked: boolean) {
    setModules((current) => (checked ? [...new Set([...current, module])] : current.filter((item) => item !== module)));
    if (checked) {
      setPermissions((current) => [...new Set([...current, DEFAULT_PERMISSION[module]])]);
    } else {
      setPermissions((current) => current.filter((permission) => !MODULE_PERMISSIONS[module].includes(permission)));
    }
  }

  function togglePermission(permission: Permission, checked: boolean) {
    setPermissions((current) =>
      checked ? [...new Set([...current, permission])] : current.filter((item) => item !== permission),
    );
  }

  async function submit() {
    setBusy(true);
    const result = await saveCompanyRoleAction({
      id: role?.id ?? undefined,
      name,
      modules,
      permissions,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Peran disimpan.");
    onSaved();
  }

  return (
    <Modal title={role ? `Ubah peran · ${role.name}` : "Peran baru"} onClose={onClose} onSubmit={submit} busy={busy} wide>
      <div className="space-y-3">
        <Field label="Nama peran" required>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder="Kasir Senior, Admin Gudang…" disabled={Boolean(role)} />
        </Field>

        <div>
          <p className={labelClass}>Modul yang bisa diakses</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {(Object.keys(MODULE_LABELS) as ModuleKey[]).map((module) => (
              <label key={module} className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-[11px]">
                <input
                  type="checkbox"
                  checked={modules.includes(module)}
                  onChange={(event) => toggleModule(module, event.target.checked)}
                />
                {MODULE_LABELS[module]}
              </label>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <p className={labelClass}>Izin</p>
          {grouped.map((group) => (
            <div key={group.module} className="rounded-md border border-border p-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {MODULE_LABELS[group.module]}
              </p>
              <div className="grid gap-1 sm:grid-cols-2">
                {group.items.map((item) => (
                  <label key={item.key} className="flex items-center gap-1.5 text-[11px]">
                    <input
                      type="checkbox"
                      checked={permissions.includes(item.key)}
                      onChange={(event) => togglePermission(item.key, event.target.checked)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* G1 (FRM-01): Modal lokal yang menduplikasi Modal bersama
   dihapus — berkas ini memakai @/components/blocks/modal. */
