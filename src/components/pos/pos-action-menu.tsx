"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  CloudOff,
  History,
  LayoutDashboard,
  Menu,
  PauseCircle,
  ReceiptText,
  Users,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

type MenuItem = {
  href: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  tone?: "green" | "amber" | "red";
};

/**
 * Menu aksi terminal POS — satu pintu untuk pekerjaan yang tidak
 * termasuk alur scan → keranjang → bayar. Pola native: tombol app-bar,
 * panel datar, tanpa submenu bertingkat.
 */
export function PosActionMenu({
  sessionOpen,
  heldCount,
  queuedCount,
  children,
}: {
  sessionOpen: boolean;
  heldCount: number;
  queuedCount: number;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups: { title: string; items: MenuItem[] }[] = [
    {
      title: "Sesi kas",
      items: [
        {
          href: "/app/pos/sesi",
          label: "Sesi kas",
          description: "Buka / tutup, setor, tarik bank",
          icon: Wallet,
          badge: sessionOpen ? "Terbuka" : "Tertutup",
          tone: sessionOpen ? "green" : "amber",
        },
        {
          href: "/app/pos/sesi/riwayat",
          label: "Riwayat sesi",
          description: "Rekonsiliasi kas per shift",
          icon: History,
        },
      ],
    },
    {
      title: "Pelanggan",
      items: [
        {
          href: "/app/pos/piutang",
          label: "Piutang pelanggan",
          description: "Tagihan tempo & pembayaran",
          icon: Users,
        },
      ],
    },
    {
      title: "Transaksi",
      items: [
        {
          href: "/app/pos/riwayat",
          label: "Riwayat transaksi",
          description: "Cari nota dan pembayaran",
          icon: ReceiptText,
        },
        {
          href: "/app/pos/ditahan",
          label: "Pesanan ditahan",
          description: "Lanjutkan pesanan tersimpan",
          icon: PauseCircle,
          badge: heldCount > 0 ? heldCount : undefined,
          tone: "amber",
        },
        {
          href: "/app/pos/offline",
          label: "Peninjauan offline",
          description: "Selesaikan antrean yang tertahan",
          icon: CloudOff,
          badge: queuedCount > 0 ? queuedCount : undefined,
          tone: "red",
        },
      ],
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Menu lainnya kasir"
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
          open
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        <Menu className="size-3.5" />
        <span className="hidden sm:inline">Lainnya</span>
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Menu terminal POS"
          className="absolute right-0 top-full z-40 mt-1 w-[320px] rounded-xl border border-border bg-card shadow-lg"
        >
          {groups.map((group) => (
            <div key={group.title} className="border-b border-border last:border-b-0">
              <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
                  >
                    <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[12px] font-medium">{item.label}</span>
                        {item.badge !== undefined ? (
                          <span
                            className={cn(
                              "num shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                              item.tone === "green"
                                ? "bg-tone-green-soft text-tone-green"
                                : item.tone === "amber"
                                  ? "bg-tone-amber-soft text-tone-amber"
                                  : item.tone === "red"
                                    ? "bg-tone-red-soft text-tone-red"
                                    : "bg-muted text-muted-foreground",
                            )}
                          >
                            {item.badge}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}

          {children}

          <Link
            href="/app"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:bg-muted/70 focus-visible:outline-none"
          >
            <LayoutDashboard className="size-3.5" />
            Kembali ke dashboard
          </Link>
        </div>
      ) : null}
    </div>
  );
}
