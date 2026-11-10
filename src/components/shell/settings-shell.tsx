import { cookies } from "next/headers";
import { CompanySwitcher } from "@/components/shell/company-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { CommandPalette } from "@/components/shell/command-palette";
import { SidebarFrame } from "@/components/shell/sidebar-frame";
import { SettingsMobileNav, SettingsSidebarNav } from "@/components/shell/settings-nav";
import { buildPalettePages } from "@/lib/palette";
import { SidebarUserCard, ThemedSidebarHead } from "@/components/shell/module-shell";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  parseSidebarCollapsedCookie,
} from "@/lib/sidebar-pref";
import type { CompanyContext } from "@/lib/session";

/**
 * A-24 T1 (SIS-11) — cangkang netral Pengaturan. Sebelumnya halaman
 * pengaturan tinggal di dalam cangkang modul Akuntansi (breadcrumb
 * "Akuntansi", nav akuntansi) walaupun isinya lintas modul. Bentuk
 * rangka meniru ModuleShell persis; bedanya: pengalih modul tanpa
 * item aktif, nav dari SETTINGS_NAV (tersaring izin), breadcrumb
 * "Pengaturan", dan tagline "Pengaturan sistem". Pengaturan tetap
 * TIDAK tergerbang saklar modul (T5R-1) — layout hanya requireAuth;
 * tiap halaman menegakkan izinnya sendiri.
 *
 * A-25 U1: cangkang ini selalu bertema — kepala sidebar memakai
 * blok perusahaan + pengalih aplikasi yang sama dengan ModuleShell
 * bertema (item aktif = Pengaturan), kaki memakai kartu pengguna,
 * dan breadcrumb topbar diringkas menjadi konteks "Pengaturan".
 */
export async function SettingsShell({
  ctx,
  children,
}: {
  ctx: CompanyContext;
  children: React.ReactNode;
}) {
  // Validasi 2 (V-01): preferensi ciut sidebar sama dengan ModuleShell.
  const sidebarCookie = (await cookies()).get(SIDEBAR_COLLAPSED_COOKIE);

  return (
    <div className="module-shell theme-erp min-h-dvh bg-background lg:flex">
      <SidebarFrame
        defaultCollapsed={parseSidebarCollapsedCookie(sidebarCookie?.value)}
        hasPreference={sidebarCookie !== undefined}
        footer={<SidebarUserCard ctx={ctx} />}
      >
        <ThemedSidebarHead ctx={ctx} activeKey={null} settingsActive />

        <SettingsSidebarNav permissions={ctx.permissions} />
      </SidebarFrame>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="module-topbar no-print sticky top-0 z-30 flex h-[52px] items-center justify-between gap-3 border-b border-border bg-card/95 px-3 backdrop-blur sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <SettingsMobileNav permissions={ctx.permissions} />
            <div className="hidden h-4 w-px bg-border lg:block" />
            <span className="truncate text-xs font-medium">Pengaturan</span>
          </div>

          <div className="flex items-center gap-2">
            <CommandPalette
              pages={buildPalettePages({
                permissions: ctx.permissions,
                modules: ctx.modules,
                enabledModules: ctx.enabledModules,
              })}
            />
            <CompanySwitcher companies={ctx.companies} activeId={ctx.company.id} />
            <UserMenu
              name={ctx.user.name}
              email={ctx.user.email}
              role={ctx.roleName}
              showSettings={ctx.permissions.includes("settings.manage")}
            />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5 lg:px-7 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
