"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import { SETTINGS_NAV, settingsActiveHref } from "@/lib/settings-nav";

/**
 * A-24 T1 (SIS-11) — nav sidebar Pengaturan. Item tab (?tab=) tidak
 * bisa dinilai aktif dari pathname saja, jadi keaktifan dihitung
 * `settingsActiveHref` dari pathname + parameter tab. Dibungkus
 * Suspense karena useSearchParams menangguhkan subpohon ini saat
 * prarender; fallback menampilkan nav yang sama tanpa sorotan.
 */
function SettingsNavInner({ permissions }: { permissions: string[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <SidebarNav
      items={SETTINGS_NAV}
      permissions={permissions}
      activeHref={settingsActiveHref(pathname, params.get("tab"))}
    />
  );
}

export function SettingsSidebarNav({ permissions }: { permissions: string[] }) {
  return (
    <Suspense
      fallback={<SidebarNav items={SETTINGS_NAV} permissions={permissions} activeHref={null} />}
    >
      <SettingsNavInner permissions={permissions} />
    </Suspense>
  );
}

/**
 * Drawer mobile Pengaturan. SETTINGS_NAV (berisi komponen ikon)
 * diimpor di sisi klien di sini — meneruskannya dari cangkang server
 * sebagai prop melintasi batas RSC tidak bisa diserialisasi.
 */
export function SettingsMobileNav({ permissions }: { permissions: string[] }) {
  return <MobileNav items={SETTINGS_NAV} permissions={permissions} title="Pengaturan" />;
}
