import {
  ArrowDownUp,
  ArrowRightLeft,
  BadgeDollarSign,
  Banknote,
  CircleDollarSign,
  HandCoins,
  Landmark,
  NotebookPen,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import type { QuickEntryKind } from "@/lib/quick-entry";

export type QuickInputVisibility = {
  /** accounting.post — formulir beban, jurnal, transfer, modal. */
  canPost: boolean;
  /** accounting.post atau pos.sell — pembayaran piutang/utang per baris. */
  canPay: boolean;
  /** payroll.manage — proses payroll. */
  canPayroll: boolean;
  /** Modul POS dapat diakses pengguna & aktif di perusahaan. */
  showPosSession: boolean;
};

export type QuickInputItem = {
  label: string;
  hint: string;
  href?: string;
  /** A-12 (D-23): lima jenis modal Catat Transaksi membuka modal, bukan tautan. */
  quickKind?: QuickEntryKind;
  /**
   * A-22 K4 (UX-06): nama halaman tujuan untuk kartu yang
   * MENAVIGASI. Panel wajib jujur — kartu tautan digambar dengan
   * penanda "membuka halaman {pageName}"; kartu modal tanpa penanda.
   * Wajib terisi untuk setiap item ber-href.
   */
  pageName?: string;
  icon: LucideIcon;
  visible: (v: QuickInputVisibility) => boolean;
};

/**
 * A-8.4 + A-12 + A-22 K4: definisi sembilan kartu Input Cepat.
 * Lima jenis transaksi harian membuka modal Catat Transaksi (D-23)
 * untuk pemegang accounting.post. Empat sisanya adalah TUGAS HALAMAN
 * dan memang menavigasi — keputusannya sadar, bukan kebocoran
 * paradigma:
 * - Jurnal Manual: aturan proyek menetapkan jurnal manual memakai
 *   formulir halaman penuh jurnal/baru (modal jurnal lama dihapus).
 * - Setoran Modal: formulirnya hidup di halaman Kas & bank bersama
 *   konteks mutasi kas — bukan jenis Catat Transaksi.
 * - Proses Payroll: menjalankan run gaji adalah alur halaman penuh
 *   (daftar run, persetujuan, pembayaran), bukan satu entri cepat.
 * - Setor / Tarik Kas: aksi atas sesi kasir POS yang terbuka, di
 *   modul POS.
 * Untuk pengguna tanpa accounting.post, kartu ber-quickKind jatuh ke
 * tautan halamannya (perilaku lama) dan ikut berpenanda halaman.
 */
export const QUICK_INPUT_ITEMS: QuickInputItem[] = [
  {
    label: "Penjualan Tunai",
    hint: "Pendapatan non-stok masuk kas/bank — jurnal otomatis",
    quickKind: "cash_sale",
    icon: CircleDollarSign,
    visible: (v) => v.canPost,
  },
  {
    label: "Catat Beban",
    hint: "Listrik, sewa, operasional — langsung dari modal",
    quickKind: "expense",
    href: "/app/akuntansi/jurnal/baru",
    pageName: "Jurnal baru",
    icon: ReceiptText,
    visible: (v) => v.canPost,
  },
  {
    label: "Jurnal Manual",
    hint: "Jurnal umum dengan pola cepat & tombol samakan",
    href: "/app/akuntansi/jurnal/baru",
    pageName: "Jurnal baru",
    icon: NotebookPen,
    visible: (v) => v.canPost,
  },
  {
    label: "Transfer Kas & Bank",
    hint: "Pindah dana antar kas, bank, dan QRIS",
    quickKind: "transfer",
    href: "/app/akuntansi/bank",
    pageName: "Kas & bank",
    icon: ArrowRightLeft,
    visible: (v) => v.canPost,
  },
  {
    label: "Setoran Modal",
    hint: "Modal pemilik masuk kas/bank — formulir di Kas & bank",
    href: "/app/akuntansi/bank",
    pageName: "Kas & bank",
    icon: Landmark,
    visible: (v) => v.canPost,
  },
  {
    label: "Bayar Utang",
    hint: "Bayar tagihan pemasok — dialokasikan FIFO ke dokumen tertua",
    quickKind: "pay",
    href: "/app/akuntansi/piutang-utang?tab=utang",
    pageName: "Piutang & utang",
    icon: Banknote,
    visible: (v) => v.canPay,
  },
  {
    label: "Terima Piutang",
    hint: "Terima pembayaran pelanggan — dialokasikan FIFO ke nota tertua",
    quickKind: "receive",
    href: "/app/akuntansi/piutang-utang",
    pageName: "Piutang & utang",
    icon: HandCoins,
    visible: (v) => v.canPay,
  },
  {
    label: "Proses Payroll",
    hint: "Jalankan gaji bulanan karyawan",
    href: "/app/akuntansi/payroll",
    pageName: "Payroll",
    icon: BadgeDollarSign,
    visible: (v) => v.canPayroll,
  },
  {
    label: "Setor / Tarik Kas",
    hint: "Mutasi laci pada sesi kasir POS yang terbuka",
    href: "/app/pos/sesi",
    pageName: "Sesi kasir POS",
    icon: ArrowDownUp,
    visible: (v) => v.showPosSession,
  },
];

export type QuickInputResolution =
  | { mode: "modal"; quickKind: QuickEntryKind }
  | { mode: "link"; href: string };

/**
 * Cara sebuah kartu dirender untuk pengguna ini — null bila kartu
 * tidak terlihat. Modal hanya untuk pemegang accounting.post pada
 * item ber-quickKind; selain itu tautan halaman seperti sebelumnya.
 */
export function resolveQuickInputItem(
  item: QuickInputItem,
  visibility: QuickInputVisibility,
): QuickInputResolution | null {
  if (!item.visible(visibility)) return null;
  if (item.quickKind && visibility.canPost) {
    return { mode: "modal", quickKind: item.quickKind };
  }
  if (item.href) return { mode: "link", href: item.href };
  return null;
}
