import { requirePermissionPage } from "@/lib/session";
import { PageHeader } from "@/components/blocks/page-header";
import { CoaMigrationPanel } from "@/components/akuntansi/coa-migration-panel";

export const metadata = { title: "Migrasi bagan akun" };
export const dynamic = "force-dynamic";

/**
 * A-27 B7 — Alat migrasi bagan akun perusahaan berjalan ke templat
 * 5 digit (docs/bagan-akun/RENCANA.md §6/B7). OPT-IN pemilik:
 * halaman ini tidak menjalankan apa pun dengan sendirinya — pemilik
 * menjalankan dry-run, membaca laporannya, lalu mengeksekusi dengan
 * konfirmasi eksplisit. Migrasi hanya mengubah kode/induk/penanda
 * baris akun; jurnal mereferensikan id akun sehingga tidak ada
 * saldo yang berpindah dan tidak ada jurnal migrasi.
 */
export default async function CoaMigrationPage() {
  const ctx = await requirePermissionPage("accounting.manage");
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Akuntansi"
        title="Migrasi bagan akun"
        description={`Renumber bagan akun ${ctx.company.name} dari kode 4 digit lama ke templat 5 digit. Alat ini hanya berjalan atas perintah Anda di halaman ini — tidak pernah otomatis. Jalankan dry-run terlebih dahulu untuk melihat persis apa yang akan berubah.`}
      />
      <CoaMigrationPanel companyName={ctx.company.name} />
    </div>
  );
}
