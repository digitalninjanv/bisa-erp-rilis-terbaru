import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Banknote,
  Bookmark,
  CalendarCheck,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  ClipboardCheck,
  ClipboardList,
  CloudOff,
  Database,
  FileBarChart,
  FileSpreadsheet,
  HandCoins,
  History,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  ListTree,
  MonitorSmartphone,
  NotebookText,
  Package,
  PackageCheck,
  PauseCircle,
  ReceiptText,
  RotateCcw,
  ShieldAlert,
  Scale,
  ScanBarcode,
  Shapes,
  Settings,
  ShoppingCart,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/lib/permissions";
import { AppError } from "@/lib/errors";

export type ModuleKey = "pos" | "gudang" | "akuntansi" | "hr" | "analisa";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description?: string;
  permission?: Permission;
  /** Path families that should keep this item active without changing its destination. */
  activePaths?: string[];
  /**
   * Kepala kelompok sidebar. Item dalam modul yang sama dikelompokkan
   * berurutan; modul tanpa grup tetap dirender sebagai daftar datar.
   */
  group?: string;
};

export type NavGroup = { group: string | null; items: NavItem[] };

export function navGroupId(group: NavGroup): string {
  const stablePart = group.items[0]?.href ?? group.group ?? "ungrouped";
  return `nav-group-${stablePart.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/**
 * Mengelompokkan item navigasi yang BERURUTAN menurut `group`-nya.
 * Grup yang sama tetapi terpisah item lain tidak digabung paksa —
 * urutan array adalah urutan tampil. Item tanpa grup menjadi satu
 * kelompok tanpa nama (perilaku lama POS/Gudang).
 */
export function groupNavItems(items: NavItem[]): NavGroup[] {
  const groups: NavGroup[] = [];
  for (const item of items) {
    const name = item.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.group === name) last.items.push(item);
    else groups.push({ group: name, items: [item] });
  }
  return groups;
}

/** Resolve the same active destination for desktop and mobile navigation. */
export function resolveActiveNavItem(
  items: NavItem[],
  pathname: string,
  hash: string,
  activeHref?: string | null,
): NavItem | undefined {
  if (activeHref !== undefined) return items.find((item) => item.href === activeHref);

  return items
    .map((item, index) => {
      const [itemPath, itemHash = ""] = item.href.split("#", 2);
      if (itemHash) {
        return pathname === itemPath && hash === `#${itemHash}`
          ? { item, index, specificity: itemPath.length + itemHash.length + 1 }
          : null;
      }
      if (hash && pathname === itemPath) return null;

      const paths = [itemPath, ...(item.activePaths ?? [])];
      const specificity = paths.reduce((best, path) => {
        const matches = pathname === path || pathname.startsWith(`${path}/`);
        return matches ? Math.max(best, path.length) : best;
      }, -1);
      return specificity >= 0 ? { item, index, specificity } : null;
    })
    .filter((match): match is { item: NavItem; index: number; specificity: number } => match !== null)
    .sort((a, b) => b.specificity - a.specificity || a.index - b.index)[0]?.item;
}

export type ModuleConfig = {
  key: ModuleKey;
  name: string;
  tagline: string;
  description: string;
  href: string;
  icon: LucideIcon;
  accent: string;
  nav: NavItem[];
};

export const MODULES: Record<ModuleKey, ModuleConfig> = {
  pos: {
    key: "pos",
    name: "POS",
    tagline: "Kasir & penjualan",
    description: "Transaksi cepat, diskon pelanggan, pembayaran campuran, retur, dan sesi kas.",
    href: "/app/pos",
    icon: ShoppingCart,
    accent: "#0e9384",
    nav: [
      { label: "Kasir", href: "/app/pos", icon: ShoppingCart, description: "Mulai transaksi baru", permission: "pos.sell", group: "Penjualan" },
      { label: "Pesanan ditahan", href: "/app/pos/ditahan", icon: PauseCircle, permission: "pos.sell", group: "Penjualan" },
      { label: "Riwayat transaksi", href: "/app/pos/riwayat", icon: ReceiptText, permission: "pos.sell", group: "Penjualan" },
      { label: "Retur penjualan", href: "/app/pos/retur", icon: RotateCcw, permission: "pos.return", group: "Penjualan" },
      { label: "Piutang pelanggan", href: "/app/pos/piutang", icon: Banknote, permission: "pos.sell", group: "Penjualan" },
      { label: "Kelompok harga", href: "/app/pos/grup", icon: Users, permission: "pos.sell", group: "Pengaturan penjualan" },
      { label: "Sesi kas", href: "/app/pos/sesi", icon: Wallet, permission: "pos.session", group: "Sesi & Perangkat" },
      { label: "Riwayat sesi", href: "/app/pos/sesi/riwayat", icon: History, permission: "pos.session", group: "Sesi & Perangkat" },
      { label: "Terminal desktop", href: "/app/pos/terminal", icon: MonitorSmartphone, permission: "pos.session", group: "Sesi & Perangkat" },
      { label: "Peninjauan offline", href: "/app/pos/offline", icon: CloudOff, permission: "pos.sell", group: "Sesi & Perangkat" },
    ],
  },
  gudang: {
    key: "gudang",
    name: "Gudang",
    tagline: "Persediaan & pembelian",
    description: "Produk, penerimaan barang, transfer gudang, opname, dan kartu stok.",
    href: "/app/gudang",
    icon: Warehouse,
    accent: "#c28b36",
    // Ringkasan didahulukan; grup kerja mengikuti pengadaan, pemantauan
    // persediaan, operasi stok, lalu pemeliharaan data. Semua href
    // dipertahankan agar tautan, akses, dan deep-link yang ada tetap berlaku.
    nav: [
      { label: "Ringkasan", href: "/app/gudang", icon: LayoutDashboard, permission: "inventory.view" },
      { label: "Rekomendasi pembelian", href: "/app/gudang/rekomendasi", icon: Lightbulb, permission: "inventory.view", group: "Pengadaan" },
      { label: "Permintaan pembelian", href: "/app/gudang/purchase-request", icon: ListChecks, permission: "inventory.view", group: "Pengadaan" },
      { label: "Pesanan pembelian", href: "/app/gudang/pembelian", icon: ShoppingCart, permission: "inventory.view", group: "Pengadaan" },
      { label: "Penerimaan barang", href: "/app/gudang/penerimaan", icon: PackageCheck, permission: "inventory.view", group: "Pengadaan" },
      { label: "Riwayat penerimaan", href: "/app/gudang/penerimaan/riwayat", icon: ReceiptText, permission: "inventory.view", group: "Pengadaan" },
      { label: "Retur pembelian", href: "/app/gudang/retur-pembelian", icon: Undo2, permission: "inventory.view", group: "Pengadaan" },
      { label: "Uang muka pembelian", href: "/app/gudang/uang-muka", icon: HandCoins, permission: "inventory.view", group: "Pengadaan" },
      { label: "Pergerakan stok", href: "/app/gudang/pergerakan", icon: Boxes, permission: "inventory.view", group: "Persediaan" },
      { label: "Reservasi stok", href: "/app/gudang/reservasi", icon: Bookmark, permission: "inventory.view", group: "Persediaan" },
      { label: "Nilai persediaan", href: "/app/gudang/nilai", icon: Calculator, permission: "inventory.view", group: "Persediaan" },
      { label: "Mode Operasi", href: "/app/gudang/operasi", icon: ScanBarcode, permission: "inventory.view", group: "Operasi Stok" },
      { label: "Penyesuaian", href: "/app/gudang/penyesuaian", icon: ClipboardList, permission: "inventory.view", group: "Operasi Stok" },
      { label: "Transfer", href: "/app/gudang/transfer", icon: Truck, permission: "inventory.view", group: "Operasi Stok" },
      { label: "Stok opname", href: "/app/gudang/opname", icon: ClipboardCheck, permission: "inventory.view", group: "Operasi Stok" },
      { label: "Ringkasan data master", href: "/app/gudang/master-data", icon: Database, permission: "inventory.view", group: "Data Master" },
      { label: "Produk", href: "/app/gudang/produk", icon: Package, permission: "inventory.view", group: "Data Master" },
      { label: "Pemasok & pelanggan", href: "/app/gudang/pemasok", icon: Users, permission: "inventory.view", group: "Data Master" },
      { label: "Kategori & satuan", href: "/app/gudang/kategori-satuan", icon: Shapes, permission: "inventory.manage", group: "Data Master" },
      { label: "Impor data", href: "/app/gudang/impor", icon: FileSpreadsheet, permission: "import.manage", group: "Data Master" },
    ],
  },
  akuntansi: {
    key: "akuntansi",
    name: "Akuntansi",
    tagline: "Keuangan & laporan",
    description: "Jurnal otomatis, buku besar, laporan keuangan, bank, dan piutang.",
    href: "/app/akuntansi",
    icon: Calculator,
    accent: "#714b67",
    // A-22 Tahap K5 (UX-07): sidebar dikelompokkan per jenis pekerjaan
    // tanpa mengubah satu pun rute — Harian (kerja transaksi), Buku &
    // Laporan (pembukuan & pelaporan), Lainnya (master & pengaturan).
    // A-24 T2: grup "SDM & Payroll" yang dulu hidup di sini berpindah
    // apa adanya menjadi nav modul HR (lihat MODULES.hr di bawah).
    // Menu dikelompokkan menurut pekerjaan akuntansi. Transfer baru tetap
    // tersedia di Kas & bank; tautan khususnya tidak diduplikasi di sidebar.
    // Migrasi COA dipisahkan dari pembukuan rutin dan tetap dibatasi izin manage.
    // Rute Beban dan Piutang & Utang lama dipertahankan untuk kompatibilitas.
    nav: [
      { label: "Ringkasan", href: "/app/akuntansi", icon: LayoutDashboard, permission: "accounting.view", group: "Keuangan harian" },
      { label: "Kas & bank", href: "/app/akuntansi/bank", icon: Landmark, permission: "accounting.view", group: "Keuangan harian" },
      { label: "Piutang & utang", href: "/app/akuntansi/piutang-utang", icon: Wallet, permission: "accounting.view", group: "Keuangan harian" },
      { label: "Riwayat transfer", href: "/app/akuntansi/bank/transfer", icon: ArrowLeftRight, permission: "accounting.view", group: "Keuangan harian" },
      { label: "Jurnal baru", href: "/app/akuntansi/jurnal", icon: BookOpen, permission: "accounting.post", group: "Pembukuan" },
      { label: "Riwayat jurnal", href: "/app/akuntansi/jurnal/riwayat", icon: History, permission: "accounting.view", group: "Pembukuan" },
      { label: "Buku besar", href: "/app/akuntansi/buku-besar", icon: NotebookText, permission: "accounting.view", group: "Pembukuan" },
      { label: "Aset tetap", href: "/app/akuntansi/aset", icon: Building2, permission: "accounting.view", group: "Pembukuan" },
      { label: "Bagan akun", href: "/app/akuntansi/akun", icon: ListTree, permission: "accounting.view", group: "Bagan akun & pengaturan" },
      { label: "Migrasi bagan akun", href: "/app/akuntansi/migrasi-coa", icon: FileSpreadsheet, permission: "accounting.manage", group: "Bagan akun & pengaturan" },
      { label: "Laporan", href: "/app/akuntansi/laporan", icon: FileBarChart, permission: "accounting.view", group: "Laporan & pengendalian" },
      { label: "Pajak (PPN)", href: "/app/akuntansi/pajak", icon: ReceiptText, permission: "accounting.view", group: "Laporan & pengendalian" },
      { label: "Periode fiskal", href: "/app/akuntansi/periode", icon: CalendarCheck, permission: "accounting.view", group: "Laporan & pengendalian" },
      { label: "Rekonsiliasi bank", href: "/app/akuntansi/rekonsiliasi", icon: Scale, permission: "accounting.view", group: "Laporan & pengendalian" },
      { label: "Rekonsiliasi kontrol", href: "/app/akuntansi/rekonsiliasi-kontrol", icon: ClipboardCheck, permission: "accounting.view", group: "Laporan & pengendalian" },
      { label: "Audit trail", href: "/app/akuntansi/riwayat", icon: Activity, permission: "accounting.view", group: "Laporan & pengendalian" },
    ],
  },
  analisa: {
    key: "analisa",
    name: "Analisa",
    tagline: "Kinerja & risiko bisnis",
    description: "Indikator kesehatan bisnis, penggerak kinerja, dan pengendalian risiko minimarket.",
    href: "/app/analisa",
    icon: BarChart3,
    accent: "#0e7490",
    nav: [
      { label: "Ringkasan", href: "/app/analisa", icon: BarChart3, permission: "analytics.view", group: "Analisa" },
      { label: "Kesehatan bisnis", href: "/app/analisa#kesehatan", icon: Activity, permission: "analytics.view", group: "Analisa" },
      { label: "Penggerak kinerja", href: "/app/analisa#kinerja", icon: TrendingUp, permission: "analytics.view", group: "Analisa" },
      { label: "Pengendalian risiko", href: "/app/analisa#risiko", icon: ShieldAlert, permission: "analytics.view", group: "Analisa" },
    ],
  },
  hr: {
    key: "hr",
    name: "HR",
    tagline: "Karyawan & operasional tim",
    description: "Kelola karyawan, gaji, kasbon, dan presensi harian.",
    href: "/app/akuntansi/payroll",
    icon: Users,
    accent: "#3b6ea5",
    nav: [
      { label: "Karyawan & gaji", href: "/app/akuntansi/payroll", icon: Users, permission: "payroll.view", group: "Karyawan & gaji", activePaths: ["/app/akuntansi/karyawan"] },
      { label: "Kasbon", href: "/app/akuntansi/kasbon", icon: HandCoins, permission: "payroll.view", group: "Karyawan & gaji" },
      { label: "Presensi", href: "/app/akuntansi/hr/absensi", icon: CalendarCheck, permission: "payroll.view", group: "Operasi harian" },
    ],
  },
};

export const MODULE_LIST = [MODULES.pos, MODULES.gudang, MODULES.akuntansi, MODULES.hr, MODULES.analisa];

export const EXTRA_ICONS = {
  Banknote,
  Settings,
};

/* ------------------------------------------------------------------ */
/* Company module switch (T5-2, D-16)                                  */
/* ------------------------------------------------------------------ */

/**
 * Per-company module switch, stored as jsonb on
 * `company_settings.enabled_modules` (null = every module enabled).
 * This is a company-level on/off switch and is deliberately separate
 * from role modules (`ctx.modules` in permissions.ts): a role decides
 * who may enter a module, the switch decides whether the company uses
 * the module at all. Beranda and Pengaturan are never switchable —
 * Pengaturan is where an admin turns a module back on.
 */
export type ModuleEnabledMap = Partial<Record<ModuleKey, boolean>>;

export const ALL_MODULE_KEYS: readonly ModuleKey[] = ["pos", "gudang", "akuntansi", "hr", "analisa"];

/**
 * Reads the stored switch leniently: only an explicit `false` for a
 * known module key disables it. Anything else (null, garbage, missing
 * keys) keeps the module enabled, so a hand-edited jsonb value can
 * never lock a company out of its own modules.
 */
export function sanitizeEnabledModules(value: unknown): ModuleKey[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [...ALL_MODULE_KEYS];
  }
  const map = value as Record<string, unknown>;
  return ALL_MODULE_KEYS.filter((key) => map[key] !== false);
}

export function isModuleEnabled(
  settings: { enabledModules?: unknown } | null | undefined,
  key: ModuleKey,
): boolean {
  if (!settings) return true;
  return sanitizeEnabledModules(settings.enabledModules).includes(key);
}

/**
 * T5R-2: the company switch is also enforced at the server-action
 * layer, not only in page layouts. A layout redirect runs on
 * navigation/render — a cashier terminal that is already loaded would
 * otherwise keep checking out into a disabled module, because actions
 * are POST endpoints of their own. Write actions call this (via
 * `requirePermissionInModule`) before touching any data; domain
 * functions stay ungated so cross-module automatic journals (POS →
 * accounting) keep posting even when a module is switched off.
 */
export function assertModuleEnabled(
  enabledModules: readonly ModuleKey[],
  module: ModuleKey,
): void {
  if (!enabledModules.includes(module)) {
    throw new AppError(
      "FORBIDDEN",
      `Modul ${MODULES[module].name} sedang dinonaktifkan untuk perusahaan ini.`,
    );
  }
}

export type ModuleAccessDecision = "ok" | "denied" | "disabled";

/**
 * Single decision used by `requireModuleAccess`: the role check runs
 * first ("denied" — the account may not enter), then the company
 * switch ("disabled" — nobody in this company can, until an admin
 * re-enables it in Pengaturan).
 */
export function resolveModuleAccess(
  roleModules: readonly ModuleKey[],
  enabledModules: readonly ModuleKey[],
  key: ModuleKey,
): ModuleAccessDecision {
  if (!roleModules.includes(key)) return "denied";
  if (!enabledModules.includes(key)) return "disabled";
  return "ok";
}
