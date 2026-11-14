"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { SidebarNav } from "@/components/shell/sidebar-nav";
import { MobileNav } from "@/components/shell/mobile-nav";
import type { ModuleKey } from "@/lib/modules";
import { SETTINGS_NAV, settingsActiveHref } from "@/lib/settings-nav";

/**
 * A-24 T1 (SIS-11) — nav sidebar Pengaturan. Item tab (?tab=) tidak
 * bisa dinilai aktif dari pathname saja, jadi keaktifan dihitung
 * `settingsActiveHref` dari pathname + parameter tab. Dibungkus
 * Suspense karena useSearchParams menangguhkan subpohon ini saat
 * prarender; fallback menampilkan nav yang sama tanpa sorotan.
 */
function SettingsNavInner({ permissions, rail }: { permissions: string[]; rail: boolean }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <SidebarNav
      items={SETTINGS_NAV}
      permissions={permissions}
      activeHref={settingsActiveHref(pathname, params.get("tab"))}
      rail={rail}
    />
  );
}

export function SettingsSidebarNav({ permissions, rail = false }: { permissions: string[]; rail?: boolean }) {
  return (
    <Suspense
      fallback={<SidebarNav items={SETTINGS_NAV} permissions={permissions} activeHref={null} rail={rail} />}
    >
      <SettingsNavInner permissions={permissions} rail={rail} />
    </Suspense>
  );
}

/**
 * Drawer mobile Pengaturan. SETTINGS_NAV (berisi komponen ikon)
 * diimpor di sisi klien di sini — meneruskannya dari cangkang server
 * sebagai prop melintasi batas RSC tidak bisa diserialisasi.
 */
function SettingsMobileNavInner({ permissions, allowedKeys }: { permissions: string[]; allowedKeys: ModuleKey[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <MobileNav
      items={SETTINGS_NAV}
      permissions={permissions}
      title="Pengaturan"
      activeHref={settingsActiveHref(pathname, params.get("tab"))}
      allowedKeys={allowedKeys}
      settingsMode
    />
  );
}

export function SettingsMobileNav({ permissions, allowedKeys }: { permissions: string[]; allowedKeys: ModuleKey[] }) {
  return (
    <Suspense fallback={<MobileNav items={SETTINGS_NAV} permissions={permissions} title="Pengaturan" allowedKeys={allowedKeys} settingsMode />}>
      <SettingsMobileNavInner permissions={permissions} allowedKeys={allowedKeys} />
    </Suspense>
  );
}
