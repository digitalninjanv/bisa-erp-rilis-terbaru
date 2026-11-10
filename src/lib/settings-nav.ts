import {
  Activity,
  Calculator,
  FileText,
  Layers,
  Percent,
  Printer,
  Settings2,
  SlidersHorizontal,
  Tags,
  Users,
  Wallet,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { NavItem } from "@/lib/modules";

/**
 * A-24 T1 (SIS-11) — navigasi cangkang netral Pengaturan.
 *
 * Pengaturan keluar dari cangkang Akuntansi: sidebar-nya adalah daftar
 * seksi pengaturan itu sendiri. Item bertanda `?tab=` menunjuk tab yang
 * benar-benar ada di halaman /app/pengaturan; dua item lain menunjuk
 * halaman anak yang sudah ada (pengguna, payroll-indonesia). URL tidak
 * berubah satu pun — yang berubah hanya cangkang di sekelilingnya.
 * Item berpagar izin yang sama dengan halaman tujuannya, dan komponen
 * nav bersama menyaringnya seperti nav modul.
 */
export const SETTINGS_NAV: (NavItem & { icon: LucideIcon })[] = [
  { label: "Umum", href: "/app/pengaturan?tab=umum", icon: Settings2, permission: "settings.manage", group: "Perusahaan" },
  { label: "Pengguna & peran", href: "/app/pengaturan/pengguna", icon: Users, permission: "users.manage", group: "Perusahaan" },
  { label: "Payroll Indonesia", href: "/app/pengaturan/payroll-indonesia", icon: Percent, permission: "settings.manage", group: "Perusahaan" },
  // A-28 UI-2 (UX-D01): "Nota & printer" dilebur ke "Cetak" — satu
  // pintu pengaturan cetak. ?tab=nota lama diarahkan halaman ke cetak.
  { label: "Cetak", href: "/app/pengaturan?tab=cetak", icon: Printer, permission: "settings.manage", group: "Transaksi & Dokumen" },
  { label: "Penomoran", href: "/app/pengaturan?tab=nomor", icon: FileText, permission: "settings.manage", group: "Transaksi & Dokumen" },
  { label: "Metode pembayaran", href: "/app/pengaturan?tab=pembayaran", icon: Wallet, permission: "settings.manage", group: "Transaksi & Dokumen" },
  { label: "Kelompok harga", href: "/app/pengaturan?tab=grup", icon: Tags, permission: "settings.manage", group: "Transaksi & Dokumen" },
  { label: "Gudang & cabang", href: "/app/pengaturan?tab=lokasi", icon: Warehouse, permission: "settings.manage", group: "Sistem" },
  { label: "Pemetaan akun", href: "/app/pengaturan?tab=akun", icon: Calculator, permission: "settings.manage", group: "Sistem" },
  { label: "Modul", href: "/app/pengaturan?tab=modul", icon: Layers, permission: "settings.manage", group: "Sistem" },
  { label: "Kolom kustom", href: "/app/pengaturan?tab=kolom", icon: SlidersHorizontal, permission: "settings.manage", group: "Sistem" },
  { label: "Status sistem", href: "/app/pengaturan/status", icon: Activity, permission: "settings.manage", group: "Sistem" },
];

const TAB_HREF_PREFIX = "/app/pengaturan?tab=";

/**
 * Href item nav pengaturan yang aktif untuk lokasi saat ini, atau null
 * bila di luar wilayah pengaturan. Halaman pengaturan sendiri memakai
 * tab "umum" sebagai bawaan (dan jatuh ke umum untuk tab tak dikenal)
 * — penentuan aktif meniru persis aturan halaman itu.
 */
export function settingsActiveHref(pathname: string, tab: string | null | undefined): string | null {
  if (pathname === "/app/pengaturan") {
    // A-28 UI-2: tab warisan "nota" menunjuk pintu gabungannya.
    const effectiveTab = tab === "nota" ? "cetak" : tab;
    const wanted = effectiveTab ? `${TAB_HREF_PREFIX}${effectiveTab}` : `${TAB_HREF_PREFIX}umum`;
    return SETTINGS_NAV.some((item) => item.href === wanted)
      ? wanted
      : `${TAB_HREF_PREFIX}umum`;
  }
  const pageItem = SETTINGS_NAV.find(
    (item) =>
      !item.href.startsWith(TAB_HREF_PREFIX) &&
      (pathname === item.href || pathname.startsWith(`${item.href}/`)),
  );
  return pageItem?.href ?? null;
}
