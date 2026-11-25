"use client";

import { useRouter } from "next/navigation";
import { Check, ChevronDown, Database, Settings } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MODULE_LIST, MODULES, type ModuleKey } from "@/lib/modules";
import { useSidebarCollapsed } from "@/components/shell/sidebar-frame";
import { cn } from "@/lib/utils";

/**
 * A-25 U1 — pengalih aplikasi ala Odoo (ARAH-DESAIN-A25 §2.5),
 * menggantikan segmented control 4 tombol di kepala sidebar modul
 * bertema. Daftar modul disaring persis seperti pengalih lama:
 * hanya modul yang boleh dimasuki peran DAN dinyalakan perusahaan
 * (dihitung server, diteruskan sebagai `allowedKeys` karena komponen
 * ikon tidak bisa melintasi batas RSC sebagai prop). Tujuan tautan
 * adalah `MODULES[key].href` yang sama — perilaku berpindah modul
 * dan pendaratan sadar peran (`src/lib/landing.ts`) tidak berubah.
 * Beranda tetap dicapai lewat logo/home, sedangkan Pengaturan berada
 * di menu pengguna. Direktori Data Master ditampilkan terpisah dari
 * daftar modul dan hanya bila pengguna memiliki akses ke isinya.
 */
export function AppSwitcher({
  activeKey,
  allowedKeys,
  showMasterData = false,
  settingsActive = false,
}: {
  activeKey: ModuleKey | null;
  allowedKeys: ModuleKey[];
  showMasterData?: boolean;
  settingsActive?: boolean;
}) {
  const router = useRouter();
  const collapsed = useSidebarCollapsed();
  const modules = MODULE_LIST.filter((item) => allowedKeys.includes(item.key));
  const active = settingsActive
    ? { name: "Pengaturan", tagline: "Pengaturan sistem", Icon: Settings }
    : activeKey
      ? {
          name: MODULES[activeKey].name,
          tagline: MODULES[activeKey].tagline,
          Icon: MODULES[activeKey].icon,
        }
      : { name: "Bisa ERP", tagline: "Pilih modul", Icon: MODULES.gudang.icon };
  const ActiveIcon = active.Icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Navigasi aplikasi — ${active.name} ${active.tagline}`}
        title={collapsed ? `Area: ${active.name} — klik untuk berpindah` : undefined}
        className={cn(
          "flex cursor-pointer items-center gap-2.5 rounded-lg border border-sidebar-border bg-card text-left shadow-[var(--shadow-card)] outline-none transition-colors hover:bg-shell-hover",
          // Validasi 2 (V-01): mode ringkas — pemicu menyusut menjadi
          // ubin ikon modul aktif saja; menu isinya tidak berubah.
          collapsed ? "mx-auto size-11 justify-center px-0 py-0" : "w-full px-2.5 py-2",
        )}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary-soft text-primary">
          <ActiveIcon className="size-5" />
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold text-shell-title">
                {active.name}{" "}
              </span>
              <span className="block truncate text-[11px] text-shell-muted">{active.tagline}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-shell-muted" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={6}>
        {modules.map((item) => {
          const Icon = item.icon;
          const isActive = !settingsActive && item.key === activeKey;
          return (
            <DropdownMenuItem
              key={item.key}
              onClick={() => router.push(item.href)}
              className="cursor-pointer gap-2.5 px-2 py-2"
            >
              <Icon className={cn("size-5", isActive ? "text-primary" : "text-muted-foreground")} />
              <span className="flex-1 text-[13px]">{item.name}</span>
              {item.description ? <span className="sr-only">{item.description}</span> : null}
              {isActive ? <Check className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
        {showMasterData ? (
          <>
            {modules.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              onClick={() => router.push("/app/data-master")}
              className="cursor-pointer gap-2.5 px-2 py-2"
            >
              <Database className="size-5 text-muted-foreground" />
              <span className="flex-1 text-[13px]">Data Master</span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
