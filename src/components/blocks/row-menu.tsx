"use client";

import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type RowMenuItem = {
  key: string;
  label: string;
  /** Bila diisi, item dirender sebagai tautan; selain itu onAction. */
  href?: string;
  /** Aksi destruktif: dirender merah dan otomatis dipisah garis
   * dari aksi aman di atasnya (ARAH-DESAIN-A25 §2.6/§3). */
  danger?: boolean;
  disabled?: boolean;
  /** A-28 UI-5 (UX-A05): penjelasan singkat di bawah label — dipakai
   * untuk item yang sengaja nonaktif beralasan (mis. Hapus pada akun
   * terikat), agar affordance yang mati tetap menjelaskan dirinya. */
  note?: string;
};

/**
 * A-25 U2 — menu aksi baris ⋯, satu-satunya pola aksi per baris
 * (menutup AUDIT-UI-A25 POLA-07: tombol aksi permanen di setiap baris
 * dan aksi destruktif sejajar aksi aman). Pemanggil klien meneruskan
 * `items` + `onAction(key)`; pemanggil server cukup item ber-`href`.
 * Urutan dirender apa adanya, kecuali semua item `danger` ditarik ke
 * bawah di balik satu pemisah.
 */
export function RowMenu({
  items,
  onAction,
  label,
  align = "end",
}: {
  items: RowMenuItem[];
  onAction?: (key: string) => void;
  /** Label aksesibel yang menyebut objeknya, mis. "Aksi untuk Aqua 600ml". */
  label: string;
  align?: "start" | "end";
}) {
  const safe = items.filter((item) => !item.danger);
  const danger = items.filter((item) => item.danger);
  const renderItem = (item: RowMenuItem) => {
    const variant = item.danger ? ("destructive" as const) : undefined;
    const content = item.note ? (
      <span>
        {item.label}
        <span className="block max-w-56 text-[10px] font-normal leading-3.5 text-muted-foreground">{item.note}</span>
      </span>
    ) : (
      item.label
    );
    if (item.href) {
      return (
        <DropdownMenuItem key={item.key} disabled={item.disabled} variant={variant} render={<Link href={item.href} />}>
          {content}
        </DropdownMenuItem>
      );
    }
    return (
      <DropdownMenuItem
        key={item.key}
        disabled={item.disabled}
        variant={variant}
        onClick={() => onAction?.(item.key)}
      >
        {content}
      </DropdownMenuItem>
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={label}
        title={label}
        className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[popup-open]:bg-muted lg:size-8"
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="min-w-44">
        {safe.map(renderItem)}
        {danger.length > 0 && safe.length > 0 ? <DropdownMenuSeparator /> : null}
        {danger.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
