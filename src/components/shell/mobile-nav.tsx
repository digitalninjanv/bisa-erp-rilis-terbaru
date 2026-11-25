"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, ChevronDown, Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { MODULES, groupNavItems, navGroupId, resolveActiveNavItem, type ModuleKey, type NavItem } from "@/lib/modules";
import type { NavBadges } from "@/components/shell/sidebar-nav";
import { cn } from "@/lib/utils";
import { useCurrentHash } from "@/components/shell/use-current-hash";

export function MobileNav({
  moduleKey,
  permissions,
  items: itemsProp,
  title,
  badges,
  activeHref,
  allowedKeys = [],
  settingsMode = false,
}: {
  moduleKey?: ModuleKey;
  permissions?: string[];
  items?: NavItem[];
  title?: string;
  badges?: NavBadges;
  activeHref?: string | null;
  allowedKeys?: ModuleKey[];
  settingsMode?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [moduleListOpen, setModuleListOpen] = useState(false);
  const [manualOpenGroups, setManualOpenGroups] = useState<{ route: string; ids: string[] }>({ route: "", ids: [] });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const [hash, setHash] = useCurrentHash(pathname);
  const routeKey = `${pathname}${activeHref ?? ""}`;
  const activeModule = moduleKey ? MODULES[moduleKey] : null;
  const source = itemsProp ?? activeModule?.nav ?? [];
  const items = permissions
    ? source.filter((item) => !item.permission || permissions.includes(item.permission))
    : source;
  // A-22 Tahap K5 (UX-07): pengelompokan yang sama dengan sidebar
  // desktop (sumber bersama groupNavItems); modul tanpa grup tetap
  // datar seperti sebelumnya.
  const groups = groupNavItems(items);
  const activeItem = resolveActiveNavItem(items, pathname, hash, activeHref);
  const activeGroup = activeItem?.group ?? null;
  const activeGroupEntry = groups.find((entry) => entry.group === activeGroup);
  const activeGroupKey = activeGroupEntry ? navGroupId(activeGroupEntry) : null;
  const isGroupExpanded = (id: string) =>
    id === activeGroupKey || (manualOpenGroups.route === routeKey && manualOpenGroups.ids.includes(id));
  const toggleGroup = (id: string) => {
    if (id === activeGroupKey) return;
    setManualOpenGroups((current) => {
      const ids = current.route === routeKey ? current.ids : [];
      return {
        route: routeKey,
        ids: ids.includes(id) ? ids.filter((entry) => entry !== id) : [...ids, id],
      };
    });
  };

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const trigger = triggerRef.current;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [open]);

  function trapDialogFocus(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = item.href === activeItem?.href;
    const badge = badges?.[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => {
          setHash(item.href.split("#")[1] ? `#${item.href.split("#")[1]}` : "");
          setOpen(false);
        }}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-11 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-shell-item hover:bg-shell-active hover:text-shell-active-foreground",
          active && "bg-shell-active font-medium text-shell-active-foreground",
        )}
      >
        <Icon className="size-4 shrink-0" />
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
            {badge.count > 99 ? "99+" : badge.count}
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <>
      {/* A-26 Q9 (K-11): pemicu menu & baris drawer adalah target
          sentuh primer mobile — pemicu visual 44px, baris drawer min-h-11. */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="no-print relative grid size-11 place-items-center rounded-md border border-border bg-card text-foreground lg:hidden"
        aria-label="Buka menu"
      >
        <Menu className="size-4" />
      </button>

      {/* A-22 Tahap K5: overlay WAJIB diportal ke body. Komponen ini
          dirender di dalam <header class="module-topbar backdrop-blur">;
          backdrop-filter menjadikan header containing block bagi
          keturunan position:fixed, sehingga tanpa portal drawer
          menyusut setinggi header (52px) dan menu tak terjangkau —
          cacat lama yang baru terlihat saat bukti visual tahap ini. */}
      {open ? createPortal(
        <div
          className="no-print fixed inset-0 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={title ?? activeModule?.name ?? "Navigasi"}
          onKeyDown={trapDialogFocus}
        >
          <button
            type="button"
            tabIndex={-1}
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div ref={panelRef} className="absolute inset-y-0 left-0 flex w-[min(340px,88vw)] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex items-center justify-between border-b border-shell-divider px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded bg-shell-logo text-sm font-bold text-shell-logo-foreground">
                  b
                </span>
                <span className="text-sm font-semibold">{title ?? activeModule?.name ?? ""}</span>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-7 place-items-center rounded hover:bg-shell-active"
                aria-label="Tutup"
              >
                <X className="size-4" />
              </button>
            </div>
            {allowedKeys.length ? (
              <div className="border-b border-shell-divider p-3">
                <button
                  type="button"
                  onClick={() => setModuleListOpen((value) => !value)}
                  aria-expanded={moduleListOpen}
                  className="flex min-h-11 w-full items-center gap-2 rounded-md border border-sidebar-border bg-card px-2.5 text-left"
                >
                  {(() => {
                    const Icon = activeModule?.icon ?? MODULES[allowedKeys[0]].icon;
                    return <Icon className="size-4 shrink-0 text-primary" />;
                  })()}
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {settingsMode ? "Pengaturan" : activeModule?.name ?? "Pilih modul"}
                  </span>
                  <ChevronDown className={cn("size-4 transition-transform", moduleListOpen && "rotate-180")} />
                </button>
                {moduleListOpen ? (
                  <nav aria-label="Pindah modul" className="mt-1 space-y-0.5">
                    {allowedKeys.map((key) => {
                      const moduleConfig = MODULES[key];
                      const Icon = moduleConfig.icon;
                      const active = !settingsMode && key === moduleKey;
                      return (
                        <Link
                          key={key}
                          href={moduleConfig.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? "page" : undefined}
                          className={cn("flex min-h-10 items-center gap-2 rounded-md px-2.5 text-xs", active ? "bg-shell-active font-medium text-shell-active-foreground" : "text-shell-item hover:bg-shell-active")}
                        >
                          <Icon className="size-4" />
                          <span className="flex-1">{moduleConfig.name}</span>
                          {active ? <Check className="size-3.5" /> : null}
                        </Link>
                      );
                    })}
                  </nav>
                ) : null}
              </div>
            ) : null}
            <nav className="flex-1 overflow-y-auto p-2">
              {groups.map((entry, index) => {
                if (!entry.group) {
                  return <div key={`grup-${index}`} className="space-y-0.5">{entry.items.map(renderItem)}</div>;
                }
                const groupId = navGroupId(entry);
                const expanded = isGroupExpanded(groupId);
                return (
                  <section key={groupId}>
                    <button
                      type="button"
                      disabled={groupId === activeGroupKey}
                      onClick={() => toggleGroup(groupId)}
                      aria-expanded={expanded}
                      className={cn(
                        "flex min-h-10 w-full items-center gap-2 rounded-md px-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-shell-label enabled:hover:bg-shell-active disabled:cursor-default",
                        index === 0 && "mt-1",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{entry.group}</span>
                      <ChevronDown className={cn("size-3 shrink-0 transition-transform", !expanded && "-rotate-90")} />
                    </button>
                    {expanded ? <div className="space-y-0.5 pb-1">{entry.items.map(renderItem)}</div> : null}
                  </section>
                );
              })}
            </nav>
            <Link
              href="/app"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 border-t border-shell-divider px-4 py-3 text-xs text-shell-footer"
            >
              <ArrowLeft className="size-3.5" /> Kembali ke beranda
            </Link>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
