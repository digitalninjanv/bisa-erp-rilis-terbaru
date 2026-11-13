import {
  Activity,
  ArrowLeftRight,
  BadgeDollarSign,
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
  /**
   * A-22 Tahap K5 (UX-07): kepala kelompok sidebar. Dipakai modul
   * akuntansi dan — sejak A-24 T3 (SIS-09) — gudang; modul tanpa
   * grup dirender persis seperti sebelumnya (satu daftar datar).
   */
  group?: string;
};

export type NavGroup = { group: string | null; items: NavItem[] };

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
      { label: "Kasir", href: "/app/pos", icon: ShoppingCart, description: "Mulai transaksi baru", permission: "pos.sell", group: "Harian" },
      { label: "Riwayat transaksi", href: "/app/pos/riwayat", icon: ReceiptText, permission: "pos.sell", group: "Harian" },
      { label: "Retur penjualan", href: "/app/pos/retur", icon: RotateCcw, permission: "pos.return", group: "Harian" },
      { label: "Pesanan ditahan", href: "/app/pos/ditahan", icon: PauseCircle, permission: "pos.sell", group: "Harian" },
      { label: "Piutang pelanggan", href: "/app/pos/piutang", icon: ReceiptText, permission: "pos.sell", group: "Harian" },
      { label: "Sesi kas", href: "/app/pos/sesi", icon: Wallet, permission: "pos.session", group: "Kas & Perangkat" },
      { label: "Riwayat sesi", href: "/app/pos/sesi/riwayat", icon: History, permission: "pos.session", group: "Kas & Perangkat" },
      { label: "Terminal desktop", href: "/app/pos/terminal", icon: MonitorSmartphone, permission: "pos.session", group: "Kas & Perangkat" },
      { label: "Peninjauan offline", href: "/app/pos/offline", icon: CloudOff, permission: "pos.sell", group: "Lainnya" },
      { label: "Kelompok harga", href: "/app/pos/grup", icon: Users, permission: "pos.sell", group: "Lainnya" },
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
    // A-24 T3 (SIS-09): sidebar gudang dikelompokkan per jenis kerja
    // dengan komponen kelompok yang sama seperti akuntansi — Harian
    // (kerja operasi), Master & Stok, Pembelian — nol href lama
    // berubah; "Purchase Request" menjadi "Permintaan Pembelian"
    // (label Indonesia penuh) dan Mode Operasi (pola G1) masuk
    // kelompok Harian. Impor data tetap berdiri sendiri tanpa grup.
    nav: [
      { label: "Ringkasan", href: "/app/gudang", icon: LayoutDashboard, permission: "inventory.view", group: "Harian" },
      { label: "Mode Operasi", href: "/app/gudang/operasi", icon: ScanBarcode, permission: "inventory.view", group: "Harian" },
      { label: "Penerimaan", href: "/app/gudang/penerimaan", icon: PackageCheck, permission: "inventory.view", group: "Harian" },
      { label: "Penyesuaian", href: "/app/gudang/penyesuaian", icon: ClipboardList, permission: "inventory.view", group: "Harian" },
      { label: "Transfer", href: "/app/gudang/transfer", icon: Truck, permission: "inventory.view", group: "Harian" },
      { label: "Stok opname", href: "/app/gudang/opname", icon: ClipboardCheck, permission: "inventory.view", group: "Harian" },
      { label: "Produk", href: "/app/gudang/produk", icon: Package, permission: "inventory.view", group: "Master & Stok" },
      { label: "Pergerakan stok", href: "/app/gudang/pergerakan", icon: Boxes, permission: "inventory.view", group: "Master & Stok" },
      { label: "Reservasi stok", href: "/app/gudang/reservasi", icon: Bookmark, permission: "inventory.view", group: "Master & Stok" },
      { label: "Nilai persediaan", href: "/app/gudang/nilai", icon: Calculator, permission: "inventory.view", group: "Master & Stok" },
      { label: "Permintaan Pembelian", href: "/app/gudang/purchase-request", icon: ClipboardList, permission: "inventory.view", group: "Pembelian" },
      { label: "Pesanan pembelian", href: "/app/gudang/pembelian", icon: ClipboardList, permission: "inventory.view", group: "Pembelian" },
      { label: "Uang muka pembelian", href: "/app/gudang/uang-muka", icon: HandCoins, permission: "inventory.view", group: "Pembelian" },
      { label: "Retur Pembelian", href: "/app/gudang/retur-pembelian", icon: Undo2, permission: "inventory.view", group: "Pembelian" },
      { label: "Rekomendasi beli", href: "/app/gudang/rekomendasi", icon: Lightbulb, permission: "inventory.view", group: "Pembelian" },
      { label: "Pemasok & pelanggan", href: "/app/gudang/pemasok", icon: Users, permission: "inventory.view", group: "Pembelian" },
      { label: "Impor data", href: "/app/gudang/impor", icon: FileSpreadsheet, permission: "import.manage" },
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
    // Overhaul UX (Accurate-like): menu dikelompokkan menurut cara
    // kerja akuntan minimarket — Dashboard, Kas & Bank, Buku Besar,
    // Laporan, Setting. Form Beban dan Piutang & Utang yang berdiri
    // sendiri TIDAK lagi dipromosikan di menu: pencatatan manual lewat
    // Jurnal Umum, sementara piutang/utang tetap lahir otomatis dari
    // penjualan/pembelian dan tampil di laporan. Rutenya dipertahankan
    // untuk kompatibilitas tautan lama.
    nav: [
      { label: "Ringkasan", href: "/app/akuntansi", icon: LayoutDashboard, permission: "accounting.view", group: "Dashboard" },
      { label: "Audit trail", href: "/app/akuntansi/riwayat", icon: History, permission: "accounting.view", group: "Dashboard" },
      { label: "Kas & bank", href: "/app/akuntansi/bank", icon: Landmark, permission: "accounting.view", group: "Kas & Bank" },
      { label: "Piutang & utang", href: "/app/akuntansi/piutang-utang", icon: Scale, permission: "accounting.view", group: "Kas & Bank" },
      { label: "Transfer bank", href: "/app/akuntansi/bank#transfer-bank", icon: ArrowLeftRight, permission: "accounting.view", group: "Kas & Bank" },
      { label: "Riwayat transfer", href: "/app/akuntansi/bank/transfer", icon: History, permission: "accounting.view", group: "Kas & Bank" },
      { label: "Rekonsiliasi bank", href: "/app/akuntansi/rekonsiliasi", icon: Scale, permission: "accounting.view", group: "Kas & Bank" },
      { label: "Jurnal umum", href: "/app/akuntansi/jurnal", icon: BookOpen, permission: "accounting.view", group: "Buku Besar" },
      { label: "Riwayat jurnal", href: "/app/akuntansi/jurnal/riwayat", icon: History, permission: "accounting.view", group: "Buku Besar" },
      { label: "Buku besar", href: "/app/akuntansi/buku-besar", icon: NotebookText, permission: "accounting.view", group: "Buku Besar" },
      { label: "Bagan akun", href: "/app/akuntansi/akun", icon: ListTree, permission: "accounting.view", group: "Buku Besar" },
      { label: "Aset tetap", href: "/app/akuntansi/aset", icon: Building2, permission: "accounting.view", group: "Buku Besar" },
      { label: "Laporan", href: "/app/akuntansi/laporan", icon: FileBarChart, permission: "accounting.view", group: "Laporan" },
      { label: "Pajak (PPN)", href: "/app/akuntansi/pajak", icon: ReceiptText, permission: "accounting.view", group: "Laporan" },
      { label: "Periode fiskal", href: "/app/akuntansi/periode", icon: CalendarCheck, permission: "accounting.view", group: "Laporan" },
      { label: "Rekonsiliasi kontrol", href: "/app/akuntansi/rekonsiliasi-kontrol", icon: ClipboardCheck, permission: "accounting.view", group: "Laporan" },
      { label: "Migrasi bagan akun", href: "/app/akuntansi/migrasi-coa", icon: ArrowLeftRight, permission: "accounting.manage", group: "Pengaturan" },
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
    tagline: "Karyawan & payroll",
    description: "Karyawan, absensi, cuti, lembur, kasbon, pinjaman, reimbursement, dan payroll bulanan.",
    // Modul HR punya beranda sendiri: ringkasan angka tim, kehadiran,
    // kasbon, dan payroll. Rute lama tetap hidup — karyawan & gaji di
    // /app/akuntansi/payroll, absensi/cuti/lembur di /app/akuntansi/hr,
    // dan organisasi kini pindah ke /app/akuntansi/hr/pengaturan.
    href: "/app/akuntansi/hr",
    icon: Users,
    accent: "#3b6ea5",
    nav: [
      { label: "Ringkasan", href: "/app/akuntansi/hr", icon: LayoutDashboard, permission: "payroll.view", group: "Dashboard" },
      { label: "Karyawan & Payroll", href: "/app/akuntansi/payroll", icon: BadgeDollarSign, permission: "payroll.view", group: "Karyawan" },
      { label: "Absensi", href: "/app/akuntansi/hr/absensi", icon: CalendarCheck, permission: "payroll.view", group: "Karyawan" },
      { label: "Cuti", href: "/app/akuntansi/hr/cuti", icon: ClipboardList, permission: "payroll.view", group: "Karyawan" },
      { label: "Lembur & THR", href: "/app/akuntansi/hr/lembur", icon: History, permission: "payroll.view", group: "Karyawan" },
      // Antrean persetujuan gabungan (cuti, lembur, klaim) — lencana
      // sidebar menunjuk ke sini.
      { label: "Persetujuan", href: "/app/akuntansi/hr/persetujuan", icon: ListChecks, permission: "payroll.view", group: "Karyawan" },
      { label: "Kasbon", href: "/app/akuntansi/kasbon", icon: HandCoins, permission: "payroll.view", group: "Kesejahteraan" },
      { label: "Pinjaman", href: "/app/akuntansi/pinjaman", icon: Wallet, permission: "payroll.view", group: "Kesejahteraan" },
      { label: "Klaim reimbursement", href: "/app/akuntansi/klaim", icon: ClipboardCheck, permission: "payroll.view", group: "Kesejahteraan" },
      { label: "Pengaturan HR", href: "/app/akuntansi/hr/pengaturan", icon: Building2, permission: "payroll.view", group: "Pengaturan" },
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
