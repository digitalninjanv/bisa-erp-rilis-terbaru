"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Menu, X } from "lucide-react";
import { MODULES, groupNavItems, type ModuleKey, type NavItem } from "@/lib/modules";
import type { NavBadges } from "@/components/shell/sidebar-nav";
import { cn } from "@/lib/utils";

export function MobileNav({
  moduleKey,
  permissions,
  items: itemsProp,
  title,
  badges,
}: {
  moduleKey?: ModuleKey;
  permissions?: string[];
  items?: NavItem[];
  title?: string;
  badges?: NavBadges;
}) {
  const [open, setOpen] = useState(false);
  const activeModule = moduleKey ? MODULES[moduleKey] : null;
  const source = itemsProp ?? activeModule?.nav ?? [];
  const items = permissions
    ? source.filter((item) => !item.permission || permissions.includes(item.permission))
    : source;
  // A-22 Tahap K5 (UX-07): pengelompokan yang sama dengan sidebar
  // desktop (sumber bersama groupNavItems); modul tanpa grup tetap
  // datar seperti sebelumnya.
  const groups = groupNavItems(items);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const badge = badges?.[item.href];
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        className="flex min-h-11 items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-shell-item hover:bg-shell-active hover:text-shell-active-foreground"
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
          sentuh primer mobile — pemicu visual 32px diperluas area
          sentuhnya ke 44px (after:-inset-1.5), baris drawer min-h-11. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="no-print relative grid size-8 place-items-center rounded-md border border-border bg-card text-foreground after:absolute after:-inset-1.5 lg:hidden"
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
        <div className="no-print fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-label="Tutup menu"
          />
          <div className="absolute inset-y-0 left-0 flex w-[280px] flex-col bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex items-center justify-between border-b border-shell-divider px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded bg-shell-logo text-sm font-bold text-shell-logo-foreground">
                  b
                </span>
                <span className="text-sm font-semibold">{title ?? activeModule?.name ?? ""}</span>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid size-7 place-items-center rounded hover:bg-shell-active"
                aria-label="Tutup"
              >
                <X className="size-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-2">
              {groups.map((entry, index) => (
                <div key={entry.group ?? `grup-${index}`} className="space-y-0.5">
                  {entry.group ? (
                    <p
                      className={`px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-shell-label ${
                        index === 0 ? "pt-2" : "pt-4"
                      }`}
                    >
                      {entry.group}
                    </p>
                  ) : null}
                  {entry.items.map(renderItem)}
                </div>
              ))}
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
