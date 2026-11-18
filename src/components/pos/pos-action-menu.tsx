"use client";

import Link from "next/link";
import { useState } from "react";
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

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
    <Sheet open={open} onOpenChange={setOpen}>
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
        <span className="hidden sm:inline">Lainnya</span>
      </SheetTrigger>

      <SheetContent
        side="right"
        overlayClassName="z-[70]"
        aria-label="Menu terminal POS"
        className="z-[71] w-[min(92vw,420px)] gap-0 overflow-y-auto p-0 sm:w-[420px] sm:max-w-[420px]"
      >
        <SheetHeader className="border-b border-border px-5 py-5 pr-14">
          <SheetTitle className="text-lg">Menu kasir</SheetTitle>
          <SheetDescription>Akses sesi, pelanggan, dan transaksi tambahan.</SheetDescription>
        </SheetHeader>

        <nav aria-label="Menu terminal POS" className="space-y-1 p-3">
          {groups.map((group) => (
            <section key={group.title} className="space-y-1.5 border-b border-border py-3 last:border-b-0">
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.title}
              </h3>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-14 items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{item.label}</span>
                        {item.badge !== undefined ? (
                          <span
                            className={cn(
                              "num shrink-0 rounded-full px-2 py-1 text-xs font-semibold",
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
                      <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                );
              })}
            </section>
          ))}
        </nav>

        {children ? <div className="border-t border-border p-3">{children}</div> : null}

        <div className="mt-auto border-t border-border p-3">
          <Link
            href="/app"
            onClick={() => setOpen(false)}
            className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <LayoutDashboard className="size-5" />
            Kembali ke dashboard
          </Link>
        </div>
      </SheetContent>
    </Sheet>
  );
}
