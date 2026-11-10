import { requireAuth } from "@/lib/session";
import { SettingsShell } from "@/components/shell/settings-shell";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  // T5R-1 (dipertahankan A-24 T1/SIS-11): Pengaturan TIDAK PERNAH
  // tergerbang saklar modul — di sinilah admin menyalakan modul
  // kembali (janji UI "Beranda dan Pengaturan selalu aktif"), jadi
  // menggerbang segmen ini pada modul mana pun mengunci seluruh area
  // pengaturan, termasuk saklar modul itu sendiri dan manajemen
  // pengguna. Halaman-halaman di bawahnya menegakkan izinnya sendiri
  // (settings.manage / users.manage). Yang berubah di T1 hanya
  // cangkangnya: dulu meminjam chrome modul Akuntansi, kini
  // SettingsShell netral dengan nav pengaturan tersaring izin.
  const ctx = await requireAuth();
  return <SettingsShell ctx={ctx}>{children}</SettingsShell>;
}
