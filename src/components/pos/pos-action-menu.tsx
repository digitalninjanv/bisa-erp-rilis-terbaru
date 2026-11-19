"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useHydrated } from "@/components/pos/pos-display";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type MenuItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  tone?: "green" | "amber" | "red";
};

// Rute yang paling sering dibuka dari terminal. Prefetch saat idle agar
// tap pertama sudah memakai RSC yang siap, bukan menunggu server.
const IDLE_PREFETCH = [
  "/app/pos/riwayat",
  "/app/pos/ditahan",
  "/app/pos/sesi",
  "/app/pos/piutang",
];

const ALL_POS_ROUTES = [
  "/app/pos/sesi",
  "/app/pos/sesi/riwayat",
  "/app/pos/piutang",
  "/app/pos/riwayat",
  "/app/pos/ditahan",
  "/app/pos/offline",
  "/app",
];

/**
 * Prefetch hanya setelah hydration. Komponen ini tidak dirender pada
 * server/test tanpa App Router, tetapi tetap memanaskan RSC di browser.
 */
function PosRoutePrefetcher({ open }: { open: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const id = window.setTimeout(() => {
      for (const href of IDLE_PREFETCH) router.prefetch(href);
    }, 800);
    return () => window.clearTimeout(id);
  }, [router]);

  useEffect(() => {
    if (!open) return;
    for (const href of ALL_POS_ROUTES) router.prefetch(href);
  }, [open, router]);

  return null;
}

/**
 * Menu aksi terminal POS — drawer padat, tanpa submenu dan tanpa
 * deskripsi panjang. Navigasi diprefetch saat idle + saat drawer
 * dibuka supaya perpindahan terasa native.
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
  const hydrated = useHydrated();

  const groups: { title: string; items: MenuItem[] }[] = [
    {
      title: "Sesi kas",
      items: [
        {
          href: "/app/pos/sesi",
          label: "Sesi kas",
          icon: Wallet,
          badge: sessionOpen ? "Terbuka" : "Tertutup",
          tone: sessionOpen ? "green" : "amber",
        },
        { href: "/app/pos/sesi/riwayat", label: "Riwayat sesi", icon: History },
      ],
    },
    {
      title: "Pelanggan",
      items: [{ href: "/app/pos/piutang", label: "Piutang pelanggan", icon: Users }],
    },
    {
      title: "Transaksi",
      items: [
        { href: "/app/pos/riwayat", label: "Riwayat transaksi", icon: ReceiptText },
        {
          href: "/app/pos/ditahan",
          label: "Pesanan ditahan",
          icon: PauseCircle,
          badge: heldCount > 0 ? heldCount : undefined,
          tone: "amber",
        },
        {
          href: "/app/pos/offline",
          label: "Peninjauan offline",
          icon: CloudOff,
          badge: queuedCount > 0 ? queuedCount : undefined,
          tone: "red",
        },
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {hydrated ? <PosRoutePrefetcher open={open} /> : null}
      <SheetTrigger
        aria-label="Menu POS lainnya"
        aria-expanded={open}
        className={cn(
          "flex h-11 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          open
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        <Menu className="size-4" />
        <span className="hidden sm:inline">Menu</span>
      </SheetTrigger>

      <SheetContent
        side="right"
        overlayClassName="z-[70]"
        aria-label="Menu terminal POS"
        className="z-[71] w-[min(92vw,400px)] gap-0 overflow-y-auto p-0 sm:w-[400px] sm:max-w-[400px]"
      >
        <SheetHeader className="border-b border-border px-4 py-4 pr-12">
          <SheetTitle className="text-base">Menu kasir</SheetTitle>
        </SheetHeader>

        <nav aria-label="Menu terminal POS" className="space-y-1 p-2">
          {groups.map((group) => (
            <section
              key={group.title}
              className="space-y-0.5 border-b border-border py-2 last:border-b-0"
            >
              <h3 className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-3 rounded-md px-2.5 py-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                      {item.label}
                    </span>
                    {item.badge !== undefined ? (
                      <span
                        className={cn(
                          "num shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
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
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>

        {children ? <div className="border-t border-border p-2">{children}</div> : null}

        <div className="mt-auto border-t border-border p-2">
          <Link
            href="/app"
            prefetch
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LayoutDashboard className="size-4" />
            Dashboard
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
