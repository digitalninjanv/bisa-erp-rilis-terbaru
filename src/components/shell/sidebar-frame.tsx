"use client";

import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/lib/sidebar-pref";
import { cn } from "@/lib/utils";

/**
 * Validasi UI/UX Putaran 2 (V-01) — rangka sidebar yang bisa diciutkan
 * ke mode ikon. Dipakai ModuleShell & SettingsShell (markup aside
 * dipindah apa adanya dari kedua cangkang itu; yang baru: lebar
 * berubah, tombol ciut di kaki, dan konteks keadaan ciut untuk
 * SidebarNav & AppSwitcher).
 *
 * Sumber keadaan, berurutan:
 * 1. Pilihan eksplisit pengguna (cookie `bisa_sidebar_collapsed`,
 *    dibaca server & diteruskan sebagai `defaultCollapsed`) — menang
 *    selalu dan dirender sejak HTML pertama, tanpa kedip.
 * 2. Tanpa cookie: jendela di bawah 1280px berangkat ringkas
 *    (sidebar hanya tampil ≥ lg; rentang 1024–1279 sempit untuk
 *    konten ERP), jendela lebar berangkat kembang. Ini turunan
 *    viewport, bukan keadaan tersimpan — menekan tombol ciut
 *    menulis cookie dan sejak itu pilihan pengguna yang berlaku.
 *
 * Mode ringkas: lebar 64px (w-16), item nav ikon-saja setinggi 44px
 * (V-05: target sentuh tidak boleh menyusut), label hidup sebagai
 * tooltip + aria-label. Teks kepala/kartu pengguna disembunyikan
 * aturan CSS `[data-collapsed]` di globals.css karena kedua blok itu
 * komponen server.
 */
const SidebarCollapsedContext = createContext(false);

export function useSidebarCollapsed(): boolean {
  return useContext(SidebarCollapsedContext);
}

export { SidebarCollapsedContext };

const AUTO_COMPACT_BELOW = 1280;

function subscribeViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function viewportIsNarrow() {
  return window.innerWidth < AUTO_COMPACT_BELOW;
}

export function SidebarFrame({
  defaultCollapsed,
  hasPreference,
  footer,
  children,
  rail = false,
}: {
  /** Keadaan dari cookie (dirender server). */
  defaultCollapsed: boolean;
  /** True bila cookie memang ada — pilihan pengguna, bukan bawaan. */
  hasPreference: boolean;
  footer: ReactNode;
  children: ReactNode;
  /**
   * Modul dengan nav berkelompok (Gudang, Akuntansi). Lebar terbuka
   * memakai sidebar penuh; saat diciutkan (pilihan pengguna atau
   * viewport sempit) menjadi rail ikon 72px dengan flyout kelompok.
   */
  rail?: boolean;
}) {
  const [choice, setChoice] = useState<boolean | null>(
    hasPreference ? defaultCollapsed : null,
  );
  const narrow = useSyncExternalStore(
    subscribeViewport,
    viewportIsNarrow,
    () => false,
  );
  const collapsed = choice ?? narrow;

  const toggle = () => {
    const next = !collapsed;
    setChoice(next);
    document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <SidebarCollapsedContext.Provider value={collapsed}>
      <aside
        data-collapsed={collapsed || undefined}
        className={cn(
          "module-sidebar no-print sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex",
          collapsed
            ? rail
              ? "w-[72px]"
              : "w-16"
            : "w-[var(--shell-sidebar-width,232px)]",
        )}
      >
        {children}
        <div className={cn("pb-1", collapsed ? "px-2" : "px-3")}>
            <button
              type="button"
              onClick={toggle}
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar"}
              title={collapsed ? "Lebarkan sidebar" : "Ciutkan sidebar"}
              className={cn(
                "flex items-center rounded-md text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-hover-foreground",
                collapsed
                  ? "mx-auto size-11 justify-center"
                  : "w-full gap-2.5 px-2.5 py-2 text-[12px]",
              )}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4 shrink-0" />
              ) : (
                <>
                  <PanelLeftClose className="size-4 shrink-0" />
                  <span>Ciutkan sidebar</span>
                </>
              )}
            </button>
          </div>
        {footer}
      </aside>
    </SidebarCollapsedContext.Provider>
  );
}
