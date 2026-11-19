import type { ModuleKey } from "@/lib/modules";
import { AppError } from "@/lib/errors";

export const PERMISSIONS = {
  "pos.sell": "POS: proses penjualan",
  "pos.discount": "POS: diskon manual di atas ambang",
  "pos.void": "POS: void transaksi",
  "pos.return": "POS: retur penjualan",
  "pos.session": "POS: buka/tutup kas",
  "pos.receipt.reprint": "POS: cetak ulang nota",
  "inventory.view": "Gudang: lihat data",
  "inventory.manage": "Gudang: kelola produk & stok",
  "inventory.cost": "Gudang: lihat harga beli",
  "inventory.cost_override": "Gudang: ubah harga pokok penyesuaian stok",
  // FIX-GDG Tahap 3 (GDG3-11): mengubah harga master produk yang sudah
  // ada (harga jual & harga pokok) dipisahkan dari inventory.manage —
  // staf gudang mengelola stok, bukan harga yang berlaku di POS.
  "inventory.price": "Gudang: ubah harga jual & harga pokok produk",
  "accounting.view": "Akuntansi: lihat laporan",
  "accounting.post": "Akuntansi: posting jurnal",
  "accounting.manage": "Akuntansi: COA & pengaturan",
  // A-24 T2: kunci izin TIDAK berubah (payroll.*), hanya labelnya
  // dinetralkan ke modul pemiliknya yang baru — HR.
  "payroll.view": "HR: lihat data karyawan, payroll & kasbon",
  // A-28 Tahap 5 (H-HR-01): angka gaji adalah data sensitif LEVEL
  // FIELD — izin lihatnya sendiri, mengikuti pola inventory.cost
  // (lihat harga beli) vs inventory.view. payroll.view membuka
  // halaman HR, tetapi komponen gaji per karyawan, total run, slip
  // dan rekap ekspor hanya tampil/terbit bagi pemegang izin ini;
  // aksi tulis tetap payroll.manage.
  "payroll.salary": "HR: lihat angka gaji (komponen, slip & rekap)",
  "payroll.manage": "HR: kelola karyawan & penggajian",
  "analytics.view": "Analisa: lihat indikator kinerja & risiko",
  "settings.manage": "Pengaturan: ubah konfigurasi",
  "users.manage": "Pengaturan: kelola pengguna & peran",
  "import.manage": "Migrasi data: impor",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_MODULES: ModuleKey[] = ["pos", "gudang", "akuntansi", "hr", "analisa"];

export const MODULE_PERMISSIONS: Record<ModuleKey, Permission[]> = {
  pos: ["pos.sell", "pos.discount", "pos.void", "pos.return", "pos.session", "pos.receipt.reprint"],
  gudang: ["inventory.view", "inventory.manage", "inventory.cost", "inventory.cost_override", "inventory.price", "import.manage"],
  akuntansi: [
    "accounting.view",
    "accounting.post",
    "accounting.manage",
    "settings.manage",
    "users.manage",
  ],
  // A-24 T2: payroll.* kini milik modul HR (kunci izin tidak berubah).
  // A-28 Tahap 5: payroll.salary bergabung sebagai izin lihat angka gaji.
  hr: ["payroll.view", "payroll.salary", "payroll.manage"],
  analisa: ["analytics.view"],
};

export function moduleForPermission(permission: Permission): ModuleKey | null {
  for (const moduleKey of ALL_MODULES) {
    if (MODULE_PERMISSIONS[moduleKey].includes(permission)) return moduleKey;
  }
  return null;
}

/**
 * A-24 T2: modul pemilik setiap izin yang dipegang ikut serta.
 * `saveCompanyRoleAction` selalu menanam modul pemilik izin ke daftar
 * modul peran saat peran disimpan; resolusi sesi menerapkan pelengkap
 * yang sama pada daftar tersimpan/template, supaya pemetaan
 * izin→modul yang berubah (payroll.*: akuntansi → hr) tidak mencabut
 * akses sah peran kustom lama yang daftar modulnya ditulis sebelum
 * modul hr ada. Pelengkap hanya MENAMBAH modul yang izinnya memang
 * dipegang peran itu — tidak pernah memberi izin baru.
 */
export function withImpliedModules(
  modules: readonly ModuleKey[],
  permissions: readonly Permission[],
): ModuleKey[] {
  const held = new Set<ModuleKey>(modules);
  for (const permission of permissions) {
    const owner = moduleForPermission(permission);
    if (owner) held.add(owner);
  }
  return ALL_MODULES.filter((key) => held.has(key));
}

const OWNER: Permission[] = Object.keys(PERMISSIONS) as Permission[];

export type RoleDefinition = {
  key: string;
  name: string;
  modules: ModuleKey[];
  permissions: Permission[];
  builtin: boolean;
};

/** Built-in role presets. Owner/admin always receive every permission. */
export const BUILTIN_ROLES: Record<string, RoleDefinition> = {
  owner: { key: "owner", name: "Owner", modules: ALL_MODULES, permissions: OWNER, builtin: true },
  admin: { key: "admin", name: "Admin", modules: ALL_MODULES, permissions: OWNER, builtin: true },
  manager: {
    key: "manager",
    name: "Manager",
    modules: ALL_MODULES,
    permissions: [
      "pos.sell",
      "pos.discount",
      "pos.void",
      "pos.return",
      "pos.session",
      "pos.receipt.reprint",
      "inventory.view",
      "inventory.manage",
      "inventory.cost",
      "inventory.cost_override",
      "inventory.price",
      "accounting.view",
      "accounting.post",
      "payroll.view",
      // A-28 Tahap 5 (H-HR-01): manager kemarin memang melihat angka
      // gaji lewat halaman payroll berizin payroll.view — payroll.salary
      // mempertahankan akses efektif itu pada izin barunya. Bukan
      // perluasan: peran yang kemarin tidak melihat gaji (akuntan,
      // lihat-saja, kasir, gudang) tetap tidak menerimanya; jalurnya
      // adalah peran kustom dari pemilik.
      "payroll.salary",
      "analytics.view",
      "import.manage",
    ],
    builtin: true,
  },
  cashier: {
    key: "cashier",
    name: "Kasir",
    // A-23 SIS-02 (mandat pemilik: "kasir hanya POS"): template Kasir
    // tidak lagi membawa modul Gudang — sebelumnya kasir membaca
    // dashboard gudang, produk beserta HPP, dan nilai persediaan.
    // Peran kustom di company_roles tidak disentuh oleh perubahan
    // template ini; pemilik menyuntingnya di Pengguna & peran.
    // A-23 SIS-03: pos.return ikut dibawa — retur dengan nota adalah
    // pekerjaan harian kasir (struk sendiri menjanjikan tukar dengan
    // nota) dan domain retur memang berizin terpisah serta mencatat
    // refund tunai ke sesi kasir pemroses. pos.void & pos.discount
    // sengaja tetap di luar: keduanya kontrol penghapusan/harga,
    // bukan layanan retur. PIN supervisor (POS3-12) adalah lapisan
    // persetujuan tambahan — keputusan pemilik tersendiri, bukan
    // alasan menahan jalur dasarnya.
    modules: ["pos"],
    permissions: ["pos.sell", "pos.return", "pos.session"],
    builtin: true,
  },
  warehouse: {
    key: "warehouse",
    name: "Staf Gudang",
    modules: ["gudang"],
    permissions: ["inventory.view", "inventory.manage", "inventory.cost"],
    builtin: true,
  },
  accountant: {
    key: "accountant",
    name: "Akuntan",
    modules: ["akuntansi", "gudang", "analisa"],
    permissions: [
      "accounting.view",
      "accounting.post",
      "accounting.manage",
      "inventory.view",
      "inventory.cost",
      "analytics.view",
    ],
    builtin: true,
  },
  viewer: {
    key: "viewer",
    name: "Lihat Saja",
    modules: ["gudang", "akuntansi", "analisa"],
    permissions: ["inventory.view", "accounting.view", "analytics.view"],
    builtin: true,
  },
};

export const BUILTIN_ROLE_KEYS = Object.keys(BUILTIN_ROLES);

export function builtinRole(role: string | null | undefined): RoleDefinition | null {
  if (!role) return null;
  return BUILTIN_ROLES[role] ?? null;
}

export function permissionsFor(role: string | null | undefined): Permission[] {
  return builtinRole(role)?.permissions ?? BUILTIN_ROLES.viewer.permissions;
}

export function modulesFor(role: string | null | undefined): ModuleKey[] {
  return builtinRole(role)?.modules ?? BUILTIN_ROLES.viewer.modules;
}

export function roleLabel(role: string | null | undefined): string {
  return builtinRole(role)?.name ?? role ?? "Tanpa peran";
}

type PermissionSubject =
  | string
  | null
  | undefined
  | { role?: string | null; permissions?: readonly Permission[] };

export function can(subject: PermissionSubject, permission: Permission): boolean {
  if (!subject) return false;
  if (typeof subject === "string") return permissionsFor(subject).includes(permission);
  if (subject.permissions) return subject.permissions.includes(permission);
  return permissionsFor(subject.role).includes(permission);
}

export class PermissionError extends AppError {
  constructor(permission: Permission) {
    super("FORBIDDEN", `Tidak punya akses: ${PERMISSIONS[permission]}`);
  }
}

export function assertCan(subject: PermissionSubject, permission: Permission): void {
  if (!can(subject, permission)) throw new PermissionError(permission);
}

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}

export function sanitizePermissions(values: unknown): Permission[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is Permission => typeof value === "string" && isPermission(value)))];
}

export function sanitizeModules(values: unknown): ModuleKey[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value): value is ModuleKey => ALL_MODULES.includes(value as ModuleKey)))];
}
