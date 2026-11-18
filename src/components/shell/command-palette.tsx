"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Package, ReceiptText, Search, LayoutGrid } from "lucide-react";
import { filterPalettePages, type PalettePage } from "@/lib/palette";
import { searchPaletteAction } from "@/server/actions/palette";
import type { PaletteEntity } from "@/server/palette";

type FlatItem = {
  key: string;
  group: string;
  label: string;
  sub: string;
  href: string;
  icon: "page" | "product" | "sale" | "document";
};

const GROUP_ORDER = ["Halaman", "Produk", "Nota penjualan", "Dokumen stok"] as const;

/**
 * A-24 T1 (SIS-12) — palet perintah Ctrl+K (pola Odoo command
 * palette): satu pintu pencarian ke HALAMAN yang terjangkau peran
 * (dihitung server dari nav modul tersaring) dan ENTITAS (produk,
 * nota, dokumen stok) yang cakupannya ditegakkan aksi server per
 * grup. Kasir hanya pernah melihat dunia POS — di halaman maupun
 * entitas.
 */
const EMPTY_ENTITIES: { products: PaletteEntity[]; sales: PaletteEntity[]; documents: PaletteEntity[] } = {
  products: [],
  sales: [],
  documents: [],
};

export function CommandPalette({ pages }: { pages: PalettePage[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Hasil entitas disimpan bersama istilahnya: hasil untuk istilah
  // lama tidak pernah tampil untuk kueri baru.
  const [entityState, setEntityState] = useState<{ term: string; results: typeof EMPTY_ENTITIES }>({
    term: "",
    results: EMPTY_ENTITIES,
  });
  const [active, setActive] = useState(0);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = () => {
    setOpen(false);
    setQuery("");
    setEntityState({ term: "", results: EMPTY_ENTITIES });
    setActive(0);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const term = query.trim();
    if (!open || term.length < 2) return;
    timerRef.current = setTimeout(async () => {
      const requestId = ++requestRef.current;
      const result = await searchPaletteAction(term);
      if (requestId !== requestRef.current) return;
      if (result.ok) setEntityState({ term, results: result.data });
    }, 250);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, open]);

  const entities = entityState.term === query.trim() ? entityState.results : EMPTY_ENTITIES;

  const items = useMemo<FlatItem[]>(() => {
    const pageItems: FlatItem[] = filterPalettePages(pages, query).map((page) => ({
      key: `page:${page.href}`,
      group: "Halaman",
      label: page.label,
      sub: page.module,
      href: page.href,
      icon: "page",
    }));
    const toItems = (rows: PaletteEntity[], group: string, icon: FlatItem["icon"]): FlatItem[] =>
      rows.map((row) => ({ key: `${group}:${row.id}`, group, label: row.label, sub: row.sub, href: row.href, icon }));
    return [
      ...pageItems,
      ...toItems(entities.products, "Produk", "product"),
      ...toItems(entities.sales, "Nota penjualan", "sale"),
      ...toItems(entities.documents, "Dokumen stok", "document"),
    ];
  }, [pages, query, entities]);

  const choose = (item: FlatItem) => {
    close();
    router.push(item.href);
  };

  const iconFor = (icon: FlatItem["icon"]) => {
    if (icon === "product") return <Package className="size-4 shrink-0 text-muted-foreground" />;
    if (icon === "sale") return <ReceiptText className="size-4 shrink-0 text-muted-foreground" />;
    if (icon === "document") return <FileText className="size-4 shrink-0 text-muted-foreground" />;
    return <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />;
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-8 w-44 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted sm:w-56"
        aria-label="Buka pencarian cepat (Ctrl K)"
      >
        <Search className="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-left">Cari apa saja…</span>
        <kbd className="rounded border border-border bg-muted px-1 text-[10px]">Ctrl K</kbd>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[10vh]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="size-4 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setActive((value) => Math.min(value + 1, Math.max(items.length - 1, 0)));
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setActive((value) => Math.max(value - 1, 0));
                  } else if (event.key === "Enter") {
                    const item = items[active];
                    if (item) choose(item);
                  } else if (event.key === "Escape") {
                    close();
                  }
                }}
                placeholder="Cari produk, nota, dokumen, halaman…"
                className="h-11 w-full bg-transparent text-[13px] outline-none"
                aria-label="Kueri pencarian cepat"
              />
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {items.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-muted-foreground">
                  {query.trim().length < 2
                    ? "Ketik minimal 2 huruf — halaman tampil langsung, produk/nota/dokumen dicari di server."
                    : "Tidak ada hasil untuk pencarian ini."}
                </p>
              ) : (
                GROUP_ORDER.map((group) => {
                  const groupItems = items.filter((item) => item.group === group);
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group} className="mb-1">
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{group}</p>
                      {groupItems.map((item) => {
                        const index = items.indexOf(item);
                        return (
                          <button
                            key={item.key}
                            type="button"
                            onMouseEnter={() => setActive(index)}
                            onClick={() => choose(item)}
                            className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left ${index === active ? "bg-muted" : ""}`}
                          >
                            {iconFor(item.icon)}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[12.5px] font-medium">{item.label}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">{item.sub}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
