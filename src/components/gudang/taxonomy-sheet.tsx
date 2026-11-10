"use client";

import { useState } from "react";
import { Shapes } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TaxonomyManager, type CategoryRow, type UnitRow } from "@/components/gudang/taxonomy-manager";

/**
 * A-25 U2 — Kategori & satuan keluar dari badan halaman Produk
 * (AUDIT-UI-A25 POLA-01: tiga form bertumpuk satu halaman) menjadi
 * pengelolaan terpisah lewat drawer kanan (pola MasterSheet arah
 * desain §2.6/§3.7): daftar produk tetap bersih, master data yang
 * jarang disentuh tinggal satu klik dari tombol di kepala halaman.
 */
export function TaxonomySheet({
  categories,
  units,
}: {
  categories: CategoryRow[];
  units: UnitRow[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
      >
        <Shapes className="size-3.5" /> Kategori & satuan
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border px-5 py-4">
          <SheetTitle>Kategori & satuan</SheetTitle>
          <SheetDescription>
            Master data pendukung produk. Perubahan langsung berlaku pada pilihan produk.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TaxonomyManager categories={categories} units={units} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
