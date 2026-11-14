"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import { Field } from "@/components/blocks/field";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
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
            className={`inline-flex h-8 items-center rounded-full px-3 text-[11px] font-medium ${
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        >
          <UserPlus className="size-3.5" /> Pengguna baru
        </button>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pengguna</th>
                <th>Peran</th>
                <th>Modul</th>
                <th>Dibuat</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const role = roles.find((row) => row.key === user.role);
                const self = user.userId === currentUserId;
                return (
                  <tr key={user.userId}>
                    <td>
                      <p className="text-[12px] font-medium">
                        {user.name}
                        {self ? <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Anda</span> : null}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{user.email}</p>
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        <select
                          value={roleDraft[user.userId] ?? user.role}
                          onChange={(event) =>
                            setRoleDraft((current) => ({ ...current, [user.userId]: event.target.value }))
                          }
                          disabled={self}
                          className="h-9 min-w-[150px] rounded border border-input bg-background px-1.5 text-[11px] disabled:opacity-60"
                        >
                          {roles.map((row) => (
                            <option key={row.key} value={row.key} disabled={row.key === "owner" && !canAssignOwner}>
                              {row.name}
                              {row.builtin ? "" : " (kustom)"}
                            </option>
                          ))}
                        </select>
                        {!self && (roleDraft[user.userId] ?? user.role) !== user.role ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                            <span aria-hidden className="size-1.5 rounded-full bg-tone-amber" />
                            Berubah
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {user.modules.length === 0 ? (
                          <span className="text-[10px] text-muted-foreground">Tanpa modul</span>
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
                    </td>
                    <td className="num whitespace-nowrap text-[10px] text-muted-foreground">
                      {formatDateTime(user.createdAt)}
                    </td>
                    <td>
                      {/* G3 (UX4-01): aksi baris pengguna kini satu
                          menu ⋯ — sebelumnya dua tombol ikon permanen
                          (Reset kata sandi + Cabut akses). Syarat
                          tampil tiap aksi tidak berubah. */}
                      {(() => {
                        const items = [
                          ...(canAssignOwner || user.role !== "owner"
                            ? [{ key: "reset", label: "Reset kata sandi" }]
                            : []),
                          ...(!self && user.role !== "owner"
                            ? [{ key: "remove", label: "Cabut akses", danger: true, disabled: busy === `remove:${user.userId}` }]
                            : []),
                        ];
                        return items.length > 0 ? (
                          <div className="flex items-center justify-end">
                            <RowMenu
                              label={`Aksi untuk pengguna ${user.name}`}
                              items={items}
                              onAction={(key) => {
                                if (key === "reset") setResetFor(user);
                                if (key === "remove") setRemovingUser(user);
                              }}
                            />
                          </div>
                        ) : null;
                      })()}
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-[11px] text-muted-foreground">
                    Belum ada pengguna.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
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
        <Field label="Nama" className="sm:col-span-2">
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={fieldClass} />
        </Field>
        <Field label="Email login">
          <input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className={fieldClass} placeholder="nama@toko.id" />
        </Field>
        <Field label="Kata sandi">
          <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} className={fieldClass} placeholder="Minimal 8 karakter" />
        </Field>
        <Field label="Peran" className="sm:col-span-2">
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
      <Field label="Kata sandi baru">
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
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
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
        <Field label="Nama peran">
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
