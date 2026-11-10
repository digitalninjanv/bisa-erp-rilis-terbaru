"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  Boxes,
  CalendarCheck,
  ChevronDown,
  FileBarChart,
  Landmark,
  LayoutDashboard,
  Settings,
  ShoppingCart,
  X,
  type LucideIcon,
} from "lucide-react";
import { MODULES, groupNavItems, type ModuleKey, type NavItem } from "@/lib/modules";
import { useSidebarCollapsed } from "@/components/shell/sidebar-frame";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * A-25 U1: lencana antrean di item menu — jumlah pekerjaan menunggu
 * per href, dihitung cangkang dari fungsi baca modul pemilik yang
 * sudah ada (lihat `computeNavBadges` di module-shell). Nada mengikuti
 * ARAH-DESAIN-A25 §2.5: amber = jatuh tempo, red = menunggu keputusan.
 */
export type NavBadge = { count: number; tone?: "amber" | "red" };
export type NavBadges = Record<string, NavBadge>;

/** Ikon rail per kelompok — pola icon rail Accurate. */
const GROUP_ICONS: Record<string, LucideIcon> = {
  Dashboard: LayoutDashboard,
  "Kas & Bank": Landmark,
  "Buku Besar": BookOpen,
  Laporan: FileBarChart,
  Setting: Settings,
  Analisa: BarChart3,
  Harian: CalendarCheck,
  "Master & Stok": Boxes,
  Pembelian: ShoppingCart,
};

type RailFlyout = { group: string; top: number };

/**
 * Nav sidebar bersama. Pemakaian modul (bawaan): `moduleKey` +
 * `permissions` — perilaku persis seperti semula. Pemakaian
 * non-modul (A-24 T1, SIS-11 — cangkang Pengaturan): teruskan
 * `items` yang sudah tersaring + `activeHref` eksplisit bila
 * keaktifan tidak bisa diturunkan dari pathname (item berbasis
 * ?tab=).
 *
 * Warna item memakai token --shell-* (A-25 U1): di dalam lingkup
 * .theme-erp (semua cangkang modul sejak A-25 U8, termasuk POS)
 * token menjadi gaya terang; nilai :root lama hanya menjadi bawaan
 * permukaan tanpa kelas tema.
 */
export function SidebarNav({
  moduleKey,
  permissions,
  items: itemsProp,
  activeHref,
  badges,
  rail = false,
}: {
  moduleKey?: ModuleKey;
  permissions?: string[];
  items?: NavItem[];
  activeHref?: string | null;
  badges?: NavBadges;
  /** Modul berkelompok: daftar penuh saat terbuka, rail ikon + flyout saat diciutkan. */
  rail?: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useSidebarCollapsed();
  const activeModule = moduleKey ? MODULES[moduleKey] : null;
  const source = itemsProp ?? activeModule?.nav ?? [];
  const items = permissions
    ? source.filter((item) => !item.permission || permissions.includes(item.permission))
    : source;
  // A-22 Tahap K5 (UX-07): modul berkelompok (akuntansi) dirender per
  // kepala kelompok; modul tanpa grup mempertahankan tampilan lama
  // persis — satu judul "Menu" + daftar datar.
  const groups = groupNavItems(items);
  const grouped = groups.some((entry) => entry.group !== null);
  // Kelompok yang dilipat pengguna — semua terbuka saat pertama dibuka.
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = (name: string) =>
    setClosedGroups((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  // Rail: panel flyout untuk kelompok yang diklik. Posisi dihitung
  // dari tombol agar panel tidak menutupi rail; ditutup oleh klik
  // luar (overlay), Escape, atau perpindahan halaman.
  const [flyout, setFlyout] = useState<RailFlyout | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flyout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFlyout(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flyout]);

  function openRailGroup(group: string, event: React.MouseEvent<HTMLButtonElement>) {
    if (flyout?.group === group) {
      setFlyout(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - 420));
    setFlyout({ group, top });
  }

  const isItemActive = (item: NavItem) =>
    activeHref !== undefined
      ? item.href === activeHref
      : activeModule && item.href === activeModule.href
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isItemActive(item);
    const badge = badges?.[item.href];
    const badgeLabel = badge && badge.count > 99 ? "99+" : badge?.count;

    // Validasi 2 (V-01): mode ringkas — ikon-saja setinggi 44px
    // (V-05), label menjadi tooltip sisi kanan + aria-label, lencana
    // antrean menyusut menjadi angka kecil menempel sudut ikon agar
    // hitungan menunggu tetap terlihat tanpa label.
    if (collapsed) {
      return (
        <Tooltip key={item.href}>
          <TooltipTrigger
            render={
              <Link
                href={item.href}
                aria-label={item.label}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 items-center justify-center rounded-md text-shell-item transition-colors hover:bg-shell-hover hover:text-shell-hover-foreground",
                  active &&
                    "bg-shell-active font-medium text-shell-active-foreground shadow-[inset_2px_0_0_var(--shell-active-bar)]",
                )}
              />
            }
          >
            <Icon className="size-5 shrink-0 opacity-80" />
            {badge && badge.count > 0 ? (
              <span
                className={cn(
                  "num absolute right-0.5 top-0.5 shrink-0 rounded-full px-1 text-[11px] font-semibold leading-[16px]",
                  badge.tone === "amber"
                    ? "bg-tone-amber-soft text-tone-amber"
                    : "bg-tone-red-soft text-tone-red",
                )}
              >
                {badgeLabel}
              </span>
            ) : null}
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {item.label}
            {badge && badge.count > 0 ? (
              <span className="opacity-80">· {badge.count} menunggu</span>
            ) : null}
          </TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] text-shell-item transition-colors hover:bg-shell-hover hover:text-shell-hover-foreground",
          active &&
            "bg-shell-active font-medium text-shell-active-foreground shadow-[inset_2px_0_0_var(--shell-active-bar)]",
        )}
      >
        <Icon className="size-4 shrink-0 opacity-80" />
        <span className="truncate">{item.label}</span>
        {badge && badge.count > 0 ? (
          <span
            className={cn(
              "num ml-auto shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold leading-4",
              badge.tone === "amber"
                ? "bg-tone-amber-soft text-tone-amber"
                : "bg-tone-red-soft text-tone-red",
            )}
          >
            {badgeLabel}
          </span>
        ) : null}
      </Link>
    );
  };

  const flyoutGroup = flyout
    ? groups.find((entry) => entry.group === flyout.group)
    : undefined;

  const railBody = (
    <div className="flex flex-col items-center gap-1 px-3 py-2">
      {groups.map((entry) => {
        if (!entry.group) {
          // Item tanpa kelompok (mis. Impor data di Gudang) tetap
          // menjadi tombol ikon langsung di rail.
          return (
            <div key={`rail-${entry.items[0]?.href}`} className="flex flex-col items-center gap-1">
              {entry.items.map(renderItem)}
            </div>
          );
        }
        const group = entry.group;
        const Icon = GROUP_ICONS[group] ?? entry.items[0]?.icon;
        if (!Icon) return null;
        const active = entry.items.some(isItemActive);
        const open = flyout?.group === group;
        const badgeTotal = entry.items.reduce(
          (acc, item) => acc + (badges?.[item.href]?.count ?? 0),
          0,
        );
        return (
          <Tooltip key={group}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  onClick={(event) => openRailGroup(group, event)}
                  aria-label={group}
                  aria-haspopup="menu"
                  aria-expanded={open}
                  className={cn(
                    "relative grid size-10 place-items-center rounded-md text-shell-muted transition-colors hover:bg-shell-hover hover:text-shell-hover-foreground",
                    active &&
                      "bg-shell-active text-shell-active-foreground shadow-[inset_2px_0_0_var(--shell-active-bar)]",
                    open && "bg-shell-hover text-shell-hover-foreground",
                  )}
                />
              }
            >
              <Icon className="size-5" strokeWidth={1.7} />
              {badgeTotal > 0 ? (
                <span className="num absolute -right-1 -top-1 min-w-4 rounded-full bg-tone-red px-1 text-[9px] font-bold leading-4 text-white">
                  {badgeTotal > 9 ? "9+" : badgeTotal}
                </span>
              ) : null}
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {group}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );

  const navBody = !grouped ? (
    <>
      {collapsed ? null : (
        <p className="px-2 pb-1.5 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-shell-label">
          Menu
        </p>
      )}
      {items.map(renderItem)}
    </>
  ) : (
    <div className="space-y-3">
      {groups.map((entry, index) => {
        if (!entry.group) {
          return (
            <div key={`grup-${index}`} className="space-y-0.5">
              {entry.items.map(renderItem)}
            </div>
          );
        }
        const closed = closedGroups.has(entry.group);
        const hasActive = entry.items.some(isItemActive);
        return (
          <section key={entry.group}>
            <button
              type="button"
              onClick={() => toggleGroup(entry.group!)}
              aria-expanded={!closed}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left transition-colors hover:text-shell-hover-foreground"
            >
              <span
                className={cn(
                  "flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.14em]",
                  hasActive ? "text-shell-active-foreground" : "text-shell-label",
                )}
              >
                {entry.group}
              </span>
              {hasActive && closed ? (
                <span aria-hidden className="size-1.5 rounded-full bg-shell-active-bar" />
              ) : null}
              <ChevronDown
                className={cn(
                  "size-3 shrink-0 text-shell-muted transition-transform",
                  closed && "-rotate-90",
                )}
              />
            </button>
            {closed ? null : (
              <div className="mt-0.5 space-y-0.5">
                {entry.items.map(renderItem)}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );

  const railActive = rail && grouped;
  const showRail = collapsed && railActive;

  return (
    <>
      <nav
        className={cn(
          "flex-1",
          showRail
            ? "overflow-visible"
            : cn("overflow-y-auto px-2 py-2", !grouped && "space-y-0.5"),
        )}
      >
        {collapsed ? (
          <TooltipProvider delay={250}>
            {showRail ? railBody : navBody}
          </TooltipProvider>
        ) : (
          navBody
        )}
      </nav>

      {showRail && flyout && flyoutGroup && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Tutup menu"
                onClick={() => setFlyout(null)}
                style={{ left: 72 }}
                className="fixed inset-y-0 right-0 z-[65] cursor-default bg-transparent"
              />
              <div
                ref={flyoutRef}
                role="menu"
                aria-label={flyoutGroup.group ?? "Menu"}
                style={{ top: flyout.top, left: 80 }}
                className="fixed z-[70] max-h-[calc(100vh-16px)] w-[320px] overflow-y-auto rounded-lg border border-border bg-card p-1.5 shadow-[var(--shadow-pop)]"
              >
                <div className="mb-1 flex items-center gap-2 px-2 py-1.5">
                  <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    {(() => {
                      const Icon =
                        GROUP_ICONS[flyoutGroup.group ?? ""] ?? flyoutGroup.items[0]?.icon;
                      return Icon ? <Icon className="size-4" strokeWidth={1.7} /> : null;
                    })()}
                  </span>
                  <p className="flex-1 truncate text-[12px] font-semibold text-foreground">
                    {flyoutGroup.group}
                  </p>
                  <button
                    type="button"
                    onClick={() => setFlyout(null)}
                    aria-label="Tutup menu"
                    className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {flyoutGroup.items.map((item) => {
                    const Icon = item.icon;
                    const active = isItemActive(item);
                    const badge = badges?.[item.href];
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        onClick={() => setFlyout(null)}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] transition-colors",
                          active
                            ? "bg-primary-soft font-medium text-primary shadow-[inset_2px_0_0_var(--primary)]"
                            : "text-foreground/80 hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            active ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {badge && badge.count > 0 ? (
                          <span
                            className={cn(
                              "num shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold leading-4",
                              badge.tone === "amber"
                                ? "bg-tone-amber-soft text-tone-amber"
                                : "bg-tone-red-soft text-tone-red",
                            )}
                          >
                            {badge.count > 99 ? "99+" : badge.count}
                          </span>
                        ) : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
