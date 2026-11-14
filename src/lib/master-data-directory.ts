import type { ModuleKey } from "@/lib/modules";
import type { Permission } from "@/lib/permissions";

export type MasterDataEntry = {
  id: string;
  section: MasterDataSection;
  title: string;
  description: string;
  owner: string;
  usedBy: string;
  viewPermission: Permission;
  managePermission: Permission;
  viewHref: string;
  manageHref: string;
  module?: ModuleKey;
};

/** Canonical section order shared by the directory data and its page. */
export const MASTER_DATA_SECTIONS = [
  "Gudang & katalog",
  "Impor & saldo awal",
  "POS",
  "Akuntansi",
  "HR",
  "Perusahaan & akses",
  "Transaksi & dokumen",
  "Kebijakan & sistem",
] as const;

export type MasterDataSection = (typeof MASTER_DATA_SECTIONS)[number];

/**
 * Read-only directory of canonical master-data owners. It points to the
 * existing CRUD screens; it does not own or duplicate any records.
 */
const MASTER_DATA_ENTRY_DEFINITIONS = [
  {
    id: "products",
    section: "Gudang & katalog",
    title: "Produk",
    description: "SKU, barcode, harga, satuan dasar, kemasan, dan batas stok minimum.",
    owner: "Gudang",
    usedBy: "POS, pembelian, persediaan",
    viewPermission: "inventory.view",
    managePermission: "inventory.manage",
    viewHref: "/app/gudang/produk",
    manageHref: "/app/gudang/produk",
    module: "gudang",
  },
  {
    id: "suppliers",
    section: "Gudang & katalog",
    title: "Pemasok",
    description: "Kontak, termin pembayaran, dan data pemasok untuk pembelian dan retur.",
    owner: "Gudang",
    usedBy: "pembelian, penerimaan, retur pembelian",
    viewPermission: "inventory.view",
    managePermission: "inventory.manage",
    viewHref: "/app/gudang/pemasok?tab=pemasok",
    manageHref: "/app/gudang/pemasok?tab=pemasok",
    module: "gudang",
  },
  {
    id: "customers",
    section: "Gudang & katalog",
    title: "Pelanggan",
    description: "Kontak, kelompok harga, termin, dan batas kredit pelanggan.",
    owner: "Gudang · dipakai POS",
    usedBy: "POS, piutang, harga pelanggan",
    viewPermission: "inventory.view",
    managePermission: "inventory.manage",
    viewHref: "/app/gudang/pemasok?tab=pelanggan",
    manageHref: "/app/gudang/pemasok?tab=pelanggan",
    module: "gudang",
  },
  {
    id: "taxonomy",
    section: "Gudang & katalog",
    title: "Kategori & satuan",
    description: "Kategori bertingkat dan satuan dasar produk.",
    owner: "Gudang",
    usedBy: "produk, stok, laporan",
    viewPermission: "inventory.manage",
    managePermission: "inventory.manage",
    viewHref: "/app/gudang/kategori-satuan",
    manageHref: "/app/gudang/kategori-satuan",
    module: "gudang",
  },
  {
    id: "imports",
    section: "Impor & saldo awal",
    title: "Impor data",
    description: "Pratinjau, validasi, dan impor katalog serta saldo awal yang didukung.",
    owner: "Gudang · lintas modul",
    usedBy: "katalog, persediaan, saldo awal",
    viewPermission: "import.manage",
    managePermission: "import.manage",
    viewHref: "/app/gudang/impor",
    manageHref: "/app/gudang/impor",
    module: "gudang",
  },
  {
    id: "customer-groups",
    section: "POS",
    title: "Kelompok & harga pelanggan",
    description: "Kelompok harga dan harga khusus per produk.",
    owner: "POS · Pengaturan",
    usedBy: "kasir dan harga transaksi",
    viewPermission: "pos.sell",
    managePermission: "settings.manage",
    viewHref: "/app/pos/grup",
    manageHref: "/app/pengaturan?tab=grup",
  },
  {
    id: "chart-of-accounts",
    section: "Akuntansi",
    title: "Bagan akun",
    description: "Akun, kelompok laporan, dan saldo buku besar.",
    owner: "Akuntansi",
    usedBy: "jurnal dan laporan keuangan",
    viewPermission: "accounting.view",
    managePermission: "accounting.manage",
    viewHref: "/app/akuntansi/akun",
    manageHref: "/app/akuntansi/akun",
    module: "akuntansi",
  },
  {
    id: "account-mappings",
    section: "Akuntansi",
    title: "Pemetaan akun otomatis",
    description: "Akun tujuan untuk transaksi POS, persediaan, dan pembayaran.",
    owner: "Pengaturan akuntansi",
    usedBy: "posting otomatis lintas modul",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=akun",
    manageHref: "/app/pengaturan?tab=akun",
  },
  {
    id: "fixed-asset-categories",
    section: "Akuntansi",
    title: "Kategori aset tetap",
    description: "Kelompok aset, akun, umur manfaat, dan nilai residu bawaan.",
    owner: "Akuntansi",
    usedBy: "register dan penyusutan aset tetap",
    viewPermission: "accounting.view",
    managePermission: "accounting.manage",
    viewHref: "/app/akuntansi/aset",
    manageHref: "/app/akuntansi/aset",
    module: "akuntansi",
  },
  {
    id: "fiscal-periods",
    section: "Akuntansi",
    title: "Periode pembukuan",
    description: "Status periode bulanan, jurnal yang tercatat, dan kontrol buka/tutup buku.",
    owner: "Akuntansi",
    usedBy: "posting jurnal dan laporan keuangan",
    viewPermission: "accounting.view",
    managePermission: "accounting.manage",
    viewHref: "/app/akuntansi/periode",
    manageHref: "/app/akuntansi/periode",
    module: "akuntansi",
  },
  {
    id: "employees",
    section: "HR",
    title: "Karyawan & gaji",
    description: "Data karyawan, gaji, presensi, dan kasbon sesuai izin peran.",
    owner: "HR",
    usedBy: "presensi, kasbon, payroll",
    viewPermission: "payroll.view",
    managePermission: "payroll.manage",
    viewHref: "/app/akuntansi/payroll",
    manageHref: "/app/akuntansi/payroll",
    module: "hr",
  },
  {
    id: "hr-organization",
    section: "HR",
    title: "Departemen & jabatan",
    description: "Struktur organisasi dan parameter operasional HR perusahaan.",
    owner: "HR",
    usedBy: "karyawan, presensi, payroll",
    viewPermission: "payroll.view",
    managePermission: "payroll.manage",
    viewHref: "/app/akuntansi/hr/pengaturan",
    manageHref: "/app/akuntansi/hr/pengaturan",
    module: "hr",
  },
  {
    id: "work-shifts",
    section: "HR",
    title: "Shift kerja",
    description: "Jam kerja dan penugasan shift untuk pencatatan kehadiran.",
    owner: "HR",
    usedBy: "presensi dan rekap kehadiran",
    viewPermission: "payroll.view",
    managePermission: "payroll.manage",
    viewHref: "/app/akuntansi/hr/absensi",
    manageHref: "/app/akuntansi/hr/absensi",
    module: "hr",
  },
  {
    id: "leave-types",
    section: "HR",
    title: "Jenis cuti",
    description: "Jenis, hak hari, status berbayar, dan masa berlaku cuti.",
    owner: "HR",
    usedBy: "permohonan dan saldo cuti karyawan",
    viewPermission: "payroll.view",
    managePermission: "payroll.manage",
    viewHref: "/app/akuntansi/hr/cuti",
    manageHref: "/app/akuntansi/hr/cuti",
    module: "hr",
  },
  {
    id: "locations",
    section: "Perusahaan & akses",
    title: "Cabang, gudang & aturan stok",
    description: "Lokasi transaksi, daftar alasan penyesuaian, dan jadwal pengingat opname.",
    owner: "Pengaturan",
    usedBy: "POS, pembelian, persediaan",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=lokasi",
    manageHref: "/app/pengaturan?tab=lokasi",
  },
  {
    id: "company-policies",
    section: "Kebijakan & sistem",
    title: "Profil & kebijakan perusahaan",
    description: "Identitas perusahaan, pajak, termin bawaan, dan aturan operasional POS serta persediaan.",
    owner: "Pengaturan",
    usedBy: "POS, pembelian, gudang, dan laporan",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=umum",
    manageHref: "/app/pengaturan?tab=umum",
  },
  {
    id: "module-availability",
    section: "Kebijakan & sistem",
    title: "Modul aktif",
    description: "Menentukan modul perusahaan yang tersedia pada navigasi dan pekerjaan pengguna.",
    owner: "Pengaturan",
    usedBy: "navigasi dan akses seluruh modul",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=modul",
    manageHref: "/app/pengaturan?tab=modul",
  },
  {
    id: "print-settings",
    section: "Transaksi & dokumen",
    title: "Format cetak & nota",
    description: "Logo, ukuran kertas, header/footer, dan elemen yang dicetak pada dokumen.",
    owner: "Pengaturan",
    usedBy: "struk POS, faktur, dan laporan",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=cetak",
    manageHref: "/app/pengaturan?tab=cetak",
  },
  {
    id: "payment-methods",
    section: "Transaksi & dokumen",
    title: "Metode pembayaran",
    description: "Kas, bank, QRIS, dan metode kredit yang tersedia.",
    owner: "Pengaturan",
    usedBy: "POS, penerimaan, pembayaran",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=pembayaran",
    manageHref: "/app/pengaturan?tab=pembayaran",
  },
  {
    id: "document-numbering",
    section: "Transaksi & dokumen",
    title: "Penomoran dokumen",
    description: "Format nomor otomatis untuk transaksi dan dokumen.",
    owner: "Pengaturan",
    usedBy: "penjualan, pembelian, jurnal, dokumen gudang",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=nomor",
    manageHref: "/app/pengaturan?tab=nomor",
  },
  {
    id: "custom-fields",
    section: "Perusahaan & akses",
    title: "Kolom kustom",
    description: "Kolom tambahan untuk data master yang dipakai perusahaan.",
    owner: "Pengaturan",
    usedBy: "produk, pemasok, pelanggan, dan dokumen",
    viewPermission: "settings.manage",
    managePermission: "settings.manage",
    viewHref: "/app/pengaturan?tab=kolom",
    manageHref: "/app/pengaturan?tab=kolom",
  },
  {
    id: "users-and-roles",
    section: "Perusahaan & akses",
    title: "Pengguna & peran",
    description: "Akun masuk, modul yang tersedia, dan izin tindakan.",
    owner: "Pengaturan",
    usedBy: "semua modul",
    viewPermission: "users.manage",
    managePermission: "users.manage",
    viewHref: "/app/pengaturan/pengguna",
    manageHref: "/app/pengaturan/pengguna",
  },
] as const satisfies readonly MasterDataEntry[];

export const MASTER_DATA_ENTRIES: readonly MasterDataEntry[] = MASTER_DATA_ENTRY_DEFINITIONS;

export type MasterDataId = (typeof MASTER_DATA_ENTRY_DEFINITIONS)[number]["id"];

export type MasterDataAccess = {
  permissions: readonly string[];
  modules: readonly ModuleKey[];
  enabledModules: readonly ModuleKey[];
};

export function visibleMasterDataEntries(access: MasterDataAccess) {
  return MASTER_DATA_ENTRIES.flatMap((entry) => {
    if (entry.module && (!access.modules.includes(entry.module) || !access.enabledModules.includes(entry.module))) {
      return [];
    }
    const canManage = access.permissions.includes(entry.managePermission);
    if (!canManage && !access.permissions.includes(entry.viewPermission)) return [];
    return [{ ...entry, canManage, href: canManage ? entry.manageHref : entry.viewHref }];
  });
}

export function hasMasterDataDirectoryAccess(access: MasterDataAccess): boolean {
  return visibleMasterDataEntries(access).length > 0;
}
