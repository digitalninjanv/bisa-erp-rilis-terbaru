import { MODULES, type ModuleKey } from "@/lib/modules";
import { SETTINGS_NAV } from "@/lib/settings-nav";
import type { Permission } from "@/lib/permissions";

/**
 * A-24 T1 (SIS-12) — indeks halaman palet perintah (Ctrl+K).
 *
 * Indeks dibangun di server dari NavItem modul yang SUDAH tersaring
 * peran ∩ saklar perusahaan — persis saringan yang dipakai sidebar.
 * Halaman dari modul yang tidak boleh dimasuki peran tidak pernah
 * masuk indeks, jadi pencarian tidak bisa membocorkan keberadaan
 * modul terlarang (prinsip riset A-23 S5: menu tersembunyi adalah
 * kerapian; penolakan server tetap keamanan — aksi palet entitas
 * menegakkan izin yang sama di server).
 */
export type PalettePage = {
  label: string;
  href: string;
  /** Nama dunia pemiliknya untuk label grup: POS/Gudang/Akuntansi/Pengaturan/Beranda. */
  module: string;
};

export function buildPalettePages(input: {
  permissions: readonly string[];
  modules: readonly string[];
  enabledModules: readonly string[];
}): PalettePage[] {
  const permissions = new Set(input.permissions);
  const accessible = new Set(
    input.modules.filter((key) => input.enabledModules.includes(key)),
  );

  const pages: PalettePage[] = [{ label: "Beranda modul", href: "/app", module: "Beranda" }];
  const seen = new Set<string>(["/app"]);

  for (const key of Object.keys(MODULES) as ModuleKey[]) {
    if (!accessible.has(key)) continue;
    const mod = MODULES[key];
    for (const item of mod.nav) {
      if (item.permission && !permissions.has(item.permission as Permission)) continue;
      // Item nav akuntansi yang menunjuk Pengaturan ikut dunia
      // Pengaturan di bawah (indeks pengaturan), bukan duplikat.
      if (item.href.startsWith("/app/pengaturan")) continue;
      if (seen.has(item.href)) continue;
      seen.add(item.href);
      pages.push({ label: item.label, href: item.href, module: mod.name });
    }
  }

  for (const item of SETTINGS_NAV) {
    if (item.permission && !permissions.has(item.permission as Permission)) continue;
    if (seen.has(item.href)) continue;
    seen.add(item.href);
    pages.push({ label: item.label, href: item.href, module: "Pengaturan" });
  }

  return pages;
}

/** Penyaringan sisi klien untuk daftar halaman (instan, tanpa server). */
export function filterPalettePages(pages: PalettePage[], query: string, limit = 8): PalettePage[] {
  const q = query.trim().toLowerCase();
  if (!q) return pages.slice(0, limit);
  return pages
    .filter(
      (page) =>
        page.label.toLowerCase().includes(q) || page.module.toLowerCase().includes(q),
    )
    .slice(0, limit);
}
