import { ModuleShell } from "@/components/shell/module-shell";
import { requireModuleAccess } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A-24 T2: cangkang modul HR untuk keluarga rute HR yang URL-nya
 * tetap di bawah /app/akuntansi/... (Opsi A — rute tidak berpindah).
 * Penjaga modulnya requireModuleAccess("hr"): peran tanpa modul HR
 * terpantul ke Beranda dengan banner (pola SIS-04), dan saklar
 * perusahaan untuk "hr" berlaku di sini seperti modul lain.
 * QuickEntryHost (Catat Transaksi akuntansi) sengaja TIDAK ikut —
 * itu perkakas modul Akuntansi, bukan HR.
 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireModuleAccess("hr");
  return <ModuleShell moduleKey="hr" ctx={ctx}>{children}</ModuleShell>;
}
