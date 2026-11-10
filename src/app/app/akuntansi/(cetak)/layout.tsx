import { requireModuleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A-25 U4 (AUDIT-UI-A25 POLA-15): halaman cetak Akuntansi keluar dari
 * cangkang aplikasi. Rute cetak di bawah grup ini (buku besar,
 * laporan, piutang-utang/aging, jurnal) tampil lebar penuh TANPA
 * sidebar/topbar ModuleShell — halaman cetak adalah dokumen, bukan
 * halaman aplikasi: bingkai layarnya cukup kepala pratinjau kecil
 * bawaan halamannya sendiri (ReportPrintPageShell / strip no-print),
 * dan @media print di globals.css tetap membersihkan sisanya.
 *
 * URL tidak berubah satu pun — grup rute tidak tampil di alamat.
 * Penjaga modul tetap sama persis (requireModuleAccess "akuntansi");
 * yang hilang hanya cangkangnya dan host Catat Transaksi, yang memang
 * tidak punya tempat di atas dokumen cetak.
 */
export default async function AkuntansiPrintLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireModuleAccess("akuntansi");
  return <div className="print-canvas min-h-screen bg-background px-4 py-5 sm:px-6">{children}</div>;
}
