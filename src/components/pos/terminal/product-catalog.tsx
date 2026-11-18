/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — panel katalog produk (cari/
 * pindai, pemilih gudang & reservasi, status offline, kisi
 * produk berpaginasi). JSX dipindah apa adanya dari terminal;
 * ref burst pindai kini milik panel ini (hanya dipakai di sini).
 */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, CloudOff, Search, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR, formatQty } from "@/lib/money";
import { POS_COLUMN_CLASS, PosDisplayControls, type PosDisplayPrefs } from "@/components/pos/pos-display";
import { burstScanCode, createBurstState, feedBurstChar, resetBurst, type BurstState } from "@/lib/barcode-burst";
import { cartLineBaseQty, type CartItem, type ProductOption, type TerminalReservation } from "@/components/pos/terminal-types";
import { ShortcutHelp } from "@/components/pos/terminal/shortcut-help";
import { PosActionMenu } from "@/components/pos/pos-action-menu";
import { PrinterStatusButton } from "@/components/pos/printer-modal";

const CATEGORY_TONES = [
  { border: "border-l-4 border-l-tone-teal", surface: "bg-tone-teal-soft", edge: "border-tone-teal/40" },
  { border: "border-l-4 border-l-tone-plum", surface: "bg-tone-plum-soft", edge: "border-tone-plum/40" },
  { border: "border-l-4 border-l-tone-amber", surface: "bg-tone-amber-soft", edge: "border-tone-amber/40" },
  { border: "border-l-4 border-l-tone-green", surface: "bg-tone-green-soft", edge: "border-tone-green/40" },
  { border: "border-l-4 border-l-tone-blue", surface: "bg-tone-blue-soft", edge: "border-tone-blue/40" },
  { border: "border-l-4 border-l-tone-red", surface: "bg-tone-red-soft", edge: "border-tone-red/40" },
] as const;

/** Warna kartu deterministik dari nama kategori (Odoo category colors). */
function categoryTone(
  name: string | null | undefined,
): (typeof CATEGORY_TONES)[number] | null {
  const value = name?.trim();
  if (!value) return null;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return CATEGORY_TONES[hash % CATEGORY_TONES.length];
}

export function ProductCatalog(props: {
  searchRef: RefObject<HTMLInputElement | null>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  products: ProductOption[];
  searching: boolean;
  page: number;
  pageFull: boolean;
  goToPage: (next: number) => void;
  scanBarcode: (code: string) => Promise<ProductOption | null>;
  addProduct: (product: ProductOption, packagingId?: string | null) => void;
  warehouses: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  selectedWarehouse: string;
  setSelectedWarehouse: Dispatch<SetStateAction<string>>;
  selectedCategory: string;
  setSelectedCategory: Dispatch<SetStateAction<string>>;
  setReservationId: Dispatch<SetStateAction<string | null>>;
  reservations: TerminalReservation[];
  reservationId: string | null;
  applyReservation: (reservation: TerminalReservation) => Promise<void>;
  sessionOpen: boolean;
  heldCount?: number;
  posOfflineEnabled: boolean;
  online: boolean;
  queuedCount: number;
  oldestQueuedAt: string | null;
  syncing: boolean;
  syncOfflineQueue: () => Promise<void>;
  cart?: CartItem[];
  display: PosDisplayPrefs;
  updateDisplay: (patch: Partial<PosDisplayPrefs>) => void;
  resetDisplay: () => void;
  fullscreen: boolean;
  setFullscreenOverride: Dispatch<SetStateAction<boolean | null>>;
  allowNegativeStock?: boolean;
}) {
  const { searchRef, search, setSearch, products, searching, page, pageFull, goToPage, scanBarcode, addProduct, warehouses, categories, selectedWarehouse, setSelectedWarehouse, selectedCategory, setSelectedCategory, setReservationId, reservations, reservationId, applyReservation, sessionOpen, heldCount = 0, posOfflineEnabled, online, queuedCount, oldestQueuedAt, cart = [], display, updateDisplay, resetDisplay, fullscreen, setFullscreenOverride, allowNegativeStock = false } = props;
  const searchBurstRef = useRef<BurstState>(createBurstState());
  // A-28 UI-1 (UX-B02): sorotan hasil pencarian untuk navigasi panah.
  // -1 = belum ada sorotan (Enter berperilaku seperti dulu: hasil
  // pertama). Sorotan diikat pada identitas daftar yang melahirkannya:
  // hasil baru (kata cari/halaman/gudang berganti) membuat sorotan
  // lama gugur secara derivasi saat render — tanpa efek reset.
  const [highlightState, setHighlightState] = useState<{
    forProducts: ProductOption[];
    index: number;
  }>({ forProducts: products, index: -1 });
  const highlight = highlightState.forProducts === products ? highlightState.index : -1;
  const setHighlight = (index: number) =>
    setHighlightState({ forProducts: products, index });
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight < 0) return;
    gridRef.current
      ?.querySelector(`[data-catalog-index="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const isSoldOut = (product: ProductOption) =>
    !allowNegativeStock && product.trackStock && product.stock <= 0;

  // Qty keranjang per produk (satuan dasar) untuk badge "sudah dipilih".
  const cartQty = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    const totals = new Map<string, number>();
    for (const line of cart) {
      const product = byId.get(line.productId);
      if (!product) continue;
      totals.set(
        product.id,
        (totals.get(product.id) ?? 0) + cartLineBaseQty(line, product),
      );
    }
    return totals;
  }, [cart, products]);

  const font =
    display.fontScale === "xl"
      ? { name: "text-base", price: "text-xl", meta: "text-xs", badge: "text-xs" }
      : display.fontScale === "large"
        ? { name: "text-base", price: "text-lg", meta: "text-xs", badge: "text-xs" }
        : { name: "text-[15px]", price: "text-[17px]", meta: "text-xs", badge: "text-xs" };

  const oldestQueuedDate = oldestQueuedAt ? new Date(oldestQueuedAt) : null;
  const oldestQueuedLabel = oldestQueuedDate && !Number.isNaN(oldestQueuedDate.getTime())
    ? new Intl.DateTimeFormat("id-ID", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Jakarta",
      }).format(oldestQueuedDate)
    : null;
  const oldestQueuedDescription = oldestQueuedLabel
    ? `Tertua · Waktu transaksi tertua yang masih menunggu sinkronisasi (WIB): ${oldestQueuedLabel}`
    : null;

  /** Pindah sorotan satu langkah, melompati kartu stok habis. */
  function moveHighlight(from: number, direction: 1 | -1): number {
    let index = from + direction;
    while (index >= 0 && index < products.length) {
      if (!isSoldOut(products[index])) return index;
      index += direction;
    }
    return from;
  }
  return (
      <section
        className={cn("min-w-0 space-y-3", fullscreen && "lg:flex lg:min-h-0 lg:flex-col")}
      >
        <div
          className={cn(
            "rounded-lg border border-border bg-card",
            fullscreen && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col",
          )}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
            <div className="relative min-w-[180px] flex-[1_1_280px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  // A-28 UI-1 (UX-B02): panah atas/bawah memindahkan
                  // sorotan hasil; Enter memilih yang tersorot.
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    setHighlight(
                      moveHighlight(highlight, event.key === "ArrowDown" ? 1 : -1),
                    );
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const term = search.trim();
                    if (!term) return;
                    // FIX-POS Tahap 4 (POS2-03): ketikan secepat
                    // scanner (ledakan terukur pada kotak cari) selalu
                    // diperlakukan sebagai pindaian — format apa pun,
                    // bukan hanya angka panjang; kecocokan tetap harus
                    // persis (POS-SCAN-01). Jalur lama angka panjang
                    // dipertahankan untuk ketikan manual yang lambat;
                    // pencarian teks biasa tidak berubah (Enter
                    // menambahkan hasil pertama).
                    const burstCode = burstScanCode(searchBurstRef.current, performance.now());
                    resetBurst(searchBurstRef.current);
                    if (burstCode || /^\d{6,}$/.test(term)) {
                      void (async () => {
                        const found = await scanBarcode(term);
                        // S4: barcode kemasan menambahkan baris
                        // kemasan itu (matchedPackagingId), bukan 1 Pcs.
                        if (found) addProduct(found, found.matchedPackagingId ?? null);
                        else {
                          toast.error(`Barcode ${term} tidak ditemukan.`);
                          // Jangan biarkan kode yang gagal menempel ke scan
                          // berikutnya. Pertahankan input baru jika kasir
                          // sudah mulai mengetik saat pencarian berlangsung.
                          if (searchRef.current?.value === term) setSearch("");
                          searchRef.current?.focus();
                        }
                      })();
                      return;
                    }
                    // A-28 UI-1 (UX-B02): Enter memilih produk yang
                    // tersorot bila ada; tanpa sorotan, perilaku lama
                    // (hasil pertama) dipertahankan persis.
                    const highlighted =
                      highlight >= 0 && products[highlight] && !isSoldOut(products[highlight])
                        ? products[highlight]
                        : null;
                    if (highlighted) {
                      setHighlight(-1);
                      addProduct(highlighted);
                    } else if (products.length > 0) {
                      addProduct(products[0]);
                    }
                    return;
                  }
                  if (event.key === "Escape") {
                    setSearch("");
                    return;
                  }
                  if (event.key.length === 1) {
                    feedBurstChar(searchBurstRef.current, event.key, performance.now());
                  }
                }}
                placeholder="Pindai barcode / cari produk (F2)"
                aria-label="Cari produk atau scan barcode"
                className="h-12 w-full rounded-md border border-input bg-background pl-10 pr-3 text-[15px] outline-none transition-shadow placeholder:text-muted-foreground/80 focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <select
              value={selectedWarehouse}
              onChange={(event) => {
                setSelectedWarehouse(event.target.value);
                // Reservasi terikat gudang — ganti gudang melepaskan pilihan.
                setReservationId(null);
              }}
              className="h-12 min-w-[148px] max-w-full rounded-md border border-input bg-background px-3 text-[14px]"
              aria-label="Gudang"
            >
              {warehouses.map((warehouse) => (
                <option key={warehouse.id} value={warehouse.id}>
                  {warehouse.name}
                </option>
              ))}
            </select>
            {/* FIX-GDG Tahap 4 (butir b): pemilih reservasi aktif gudang
                ini — hanya tampil bila ada reservasi aktif; memilihnya
                menautkan penjualan (stok tereservasi dipakai lebih dulu)
                dan memasukkan produknya ke keranjang sejumlah qty
                reservasi. Tanpa pilihan, alur kasir tidak berubah. */}
            {reservations.some((row) => row.warehouseId === selectedWarehouse) ? (
              <select
                value={reservationId ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) {
                    setReservationId(null);
                    return;
                  }
                  const reservation = reservations.find((row) => row.id === value);
                  if (reservation) void applyReservation(reservation);
                }}
                className="h-12 max-w-[240px] rounded-md border border-input bg-background px-3 text-[14px]"
                aria-label="Reservasi stok"
                title="Tautkan penjualan ke reservasi stok aktif di gudang ini"
              >
                <option value="">Reservasi: tanpa reservasi</option>
                {reservations
                  .filter((row) => row.warehouseId === selectedWarehouse)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.number} · {row.productName} · {formatQty(row.qty)}
                      {row.reason ? ` · ${row.reason}` : ""}
                    </option>
                  ))}
              </select>
            ) : null}
            {/* Status sehat disembunyikan agar area scan tetap lapang.
                Masalah koneksi dan antrean tetap terlihat dengan satu
                indikator yang membuka halaman peninjauan. */}
            {posOfflineEnabled && (!online || queuedCount > 0) ? (
              <Link
                href="/app/pos/offline"
                aria-label={
                  online
                    ? `${queuedCount} transaksi menunggu sinkronisasi${oldestQueuedDescription ? `. ${oldestQueuedDescription}` : ""}`
                    : `POS offline${queuedCount > 0 ? `, ${queuedCount} transaksi diantrekan` : ""}${oldestQueuedDescription ? `. ${oldestQueuedDescription}` : ""}`
                }
                title={oldestQueuedDescription
                  ? `${oldestQueuedDescription}. Klik untuk melihat antrean.`
                  : "Lihat status koneksi dan antrean transaksi"}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-md border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  online
                    ? "border-tone-amber/30 bg-tone-amber-soft text-tone-amber hover:bg-tone-amber-soft/80"
                    : "border-tone-red/30 bg-tone-red-soft text-tone-red hover:bg-tone-red-soft/80",
                )}
              >
                {online ? <Wifi className="size-4" /> : <CloudOff className="size-4" />}
                <span>{online ? `${queuedCount} antrean` : "Offline"}</span>
                {online && queuedCount > 0 ? <span className="num rounded-full bg-background/80 px-2 py-0.5 text-xs">{queuedCount}</span> : null}
                {oldestQueuedDescription ? <span className="sr-only">{oldestQueuedDescription}</span> : null}
              </Link>
            ) : null}
            <PosDisplayControls
              prefs={display}
              onChange={updateDisplay}
              onReset={resetDisplay}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreenOverride(!fullscreen)}
            />
            <PrinterStatusButton compact />
            <PosActionMenu
              sessionOpen={sessionOpen}
              heldCount={heldCount}
              queuedCount={queuedCount}
            >
              <ShortcutHelp />
            </PosActionMenu>
          </div>

          {categories.length > 0 ? (
            <div className="flex snap-x gap-1.5 overflow-x-auto overscroll-x-contain border-t border-border px-2.5 py-2 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-28px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button
                type="button"
                aria-pressed={selectedCategory === ""}
                onClick={() => {
                  setSelectedCategory("");
                  setSearch("");
                }}
                className={cn(
                  "inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                  selectedCategory === ""
                    ? "bg-[var(--pos-action)] text-[var(--pos-action-fg)]"
                    : "border border-border bg-card text-muted-foreground hover:bg-muted",
                )}
              >
                Semua
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  aria-pressed={selectedCategory === category.id}
                  onClick={() => {
                    setSelectedCategory(category.id);
                    setSearch("");
                  }}
                  className={cn(
                    "inline-flex h-11 shrink-0 items-center rounded-full px-4 text-sm font-semibold transition-colors",
                    selectedCategory === category.id
                      ? "bg-[var(--pos-action)] text-[var(--pos-action-fg)]"
                      : "border border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {category.name}
                </button>
              ))}
            </div>
          ) : null}

          <div
            ref={gridRef}
            className={cn(
              display.view === "list" ? "flex flex-col" : "grid",
              display.view === "grid" && POS_COLUMN_CLASS[display.columns],
              display.density === "compact" ? "gap-1.5 p-1.5" : "gap-2 p-2.5",
              fullscreen && "lg:min-h-0 lg:flex-1 lg:overflow-y-auto",
            )}
          >
            {searching ? (
              <p className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">Mencari produk…</p>
            ) : products.length === 0 ? (
              <p className="col-span-full px-2 py-6 text-center text-xs text-muted-foreground">
                Produk tidak ditemukan.
              </p>
            ) : (
              products.map((product, index) => {
                // POS-1: produk terlacak stok yang habis tampil berlabel
                // "Stok habis" dan tidak dapat diklik; jasa tidak pernah
                // dianggap habis.
                const soldOut = isSoldOut(product);
                const highlighted = index === highlight;
                const quantity = cartQty.get(product.id) ?? 0;
                const packs = product.packagings ?? [];
                const visiblePacks = packs.slice(0, display.view === "list" ? 3 : 1);
                const tone = display.cardTint ? categoryTone(product.categoryName) : null;
              const shape = display.cardShape === "square" ? "rounded-sm" : "rounded-lg";

                if (display.view === "list") {
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={soldOut}
                      data-catalog-index={index}
                      data-highlighted={highlighted || undefined}
                      aria-current={highlighted || undefined}
                      onClick={() => addProduct(product)}
                      className={cn(
                        "group flex min-h-12 w-full touch-manipulation items-center gap-3 border text-left transition-colors active:scale-[0.995] hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        shape,
                        "border-border bg-card shadow-sm",
                        tone?.border,
                        tone?.surface,
                        tone?.edge,
                        display.density === "compact" ? "px-2.5 py-1.5" : "px-3 py-2",
                        soldOut && "cursor-not-allowed opacity-60 hover:border-border hover:bg-background",
                        highlighted && "border-primary bg-accent/40 ring-2 ring-ring/40 hover:border-primary",
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate font-medium", font.name)}>{product.name}</span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {display.showSku ? (
                            <span className={cn("num text-muted-foreground", font.meta)}>{product.sku}</span>
                          ) : null}
                          {display.showCategory && product.categoryName ? (
                            <span className={cn("font-medium text-muted-foreground", font.meta)}>
                              {product.categoryName}
                            </span>
                          ) : null}
                          {display.showPackaging && visiblePacks.length > 0 ? (
                            <>
                              {visiblePacks.map((pack) => (
                                <span
                                  key={pack.id}
                                  className={cn("num rounded bg-tone-teal-soft px-1.5 py-0.5 font-medium text-tone-teal", font.badge)}
                                >
                                  {pack.name} isi {formatQty(pack.isi)}
                                </span>
                              ))}
                              {packs.length > visiblePacks.length ? (
                                <span className={cn("num text-muted-foreground", font.meta)}>
                                  +{packs.length - visiblePacks.length}
                                </span>
                              ) : null}
                            </>
                          ) : null}
                        </span>
                      </span>
                      {quantity > 0 ? (
                        <span className={cn("num shrink-0 rounded bg-[var(--pos-action-soft)] px-1.5 py-0.5 font-semibold text-[var(--pos-action)]", font.badge)}>
                          ×{formatQty(quantity)}
                        </span>
                      ) : null}
                      {display.showPrice ? (
                        <span className={cn("num shrink-0 font-semibold", font.price)}>{formatIDR(product.salePrice)}</span>
                      ) : null}
                      {display.showStock ? (
                        <span
                          className={cn(
                            "num shrink-0 rounded px-1.5 py-0.5",
                            soldOut
                              ? "bg-destructive/10 font-semibold text-destructive"
                              : product.stock <= 0
                                ? "font-semibold text-tone-amber"
                                : "bg-muted text-muted-foreground",
                            font.badge,
                          )}
                        >
                          {soldOut ? "Stok habis" : `Stok ${formatQty(product.stock)} ${product.unitCode}`}
                        </span>
                      ) : soldOut ? (
                        <span className={cn("shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive", font.badge)}>
                          Stok habis
                        </span>
                      ) : null}
                    </button>
                  );
                }

                return (
                  <button
                    key={product.id}
                    type="button"
                    disabled={soldOut}
                    data-catalog-index={index}
                    data-highlighted={highlighted || undefined}
                    aria-current={highlighted || undefined}
                    onClick={() => addProduct(product)}
                    className={cn(
                      "group flex touch-manipulation flex-col justify-between border text-left transition-colors active:scale-[0.99] hover:border-primary/50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      shape,
                      "border-border bg-card shadow-sm",
                      tone?.border,
                      tone?.surface,
                      tone?.edge,
                      display.density === "compact" ? "p-2" : "p-2.5",
                      display.density === "compact" ? "min-h-[96px]" : "min-h-[120px]",
                      quantity > 0 && "border-[var(--pos-action)] bg-[var(--pos-action-soft)]",
                      soldOut && "cursor-not-allowed opacity-60 hover:border-border hover:bg-background",
                      highlighted &&
                        "border-primary bg-accent/40 ring-2 ring-ring/40 hover:border-primary",
                    )}
                  >
                    <span className={cn("line-clamp-2 font-medium leading-snug", font.name)}>{product.name}</span>
                    {display.showSku ? (
                      <span className={cn("num mt-0.5 truncate text-muted-foreground", font.meta)}>{product.sku}</span>
                    ) : null}
                    {display.showCategory && product.categoryName ? (
                      <span className={cn("mt-0.5 truncate font-medium text-muted-foreground", font.meta)}>
                        {product.categoryName}
                      </span>
                    ) : null}
                    {display.showPackaging && visiblePacks.length > 0 ? (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {visiblePacks.map((pack) => (
                          <span
                            key={pack.id}
                            className={cn("num rounded bg-tone-teal-soft px-1.5 py-0.5 font-medium text-tone-teal", font.badge)}
                          >
                            {pack.name} isi {formatQty(pack.isi)}
                          </span>
                        ))}
                        {packs.length > visiblePacks.length ? (
                          <span className={cn("num text-muted-foreground", font.meta)}>
                            +{packs.length - visiblePacks.length}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    <span className="mt-1 flex flex-wrap items-end justify-between gap-1">
                      {display.showPrice ? (
                        <span className={cn("num font-semibold", font.price)}>{formatIDR(product.salePrice)}</span>
                      ) : (
                        <span />
                      )}
                      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                        {quantity > 0 ? (
                          <span className={cn("num rounded bg-[var(--pos-action-soft)] px-1.5 py-0.5 font-semibold text-[var(--pos-action)]", font.badge)}>
                            ×{formatQty(quantity)}
                          </span>
                        ) : null}
                        {display.showStock ? (
                          soldOut ? (
                            <span className={cn("rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive", font.badge)}>
                              Stok habis
                            </span>
                          ) : (
                            <span
                              className={cn(
                                "num rounded px-1.5 py-0.5",
                                product.stock > 0
                                  ? "bg-muted text-muted-foreground"
                                  : "font-semibold text-tone-amber",
                                font.badge,
                              )}
                            >
                              Stok {formatQty(product.stock)} {product.unitCode}
                            </span>
                          )
                        ) : soldOut ? (
                          <span className={cn("rounded bg-destructive/10 px-1.5 py-0.5 font-semibold text-destructive", font.badge)}>
                            Stok habis
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* POS-1: pagination kisi produk — halaman diganti lewat
              offset server; kata cari/gudang baru selalu mulai dari 1. */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Halaman {page} · {products.length} produk
              {!pageFull && page > 1 ? " · halaman terakhir" : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || searching}
                onClick={() => goToPage(page - 1)}
                className="flex h-11 items-center gap-1 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" /> Sebelumnya
              </button>
              <button
                type="button"
                disabled={!pageFull || searching}
                onClick={() => goToPage(page + 1)}
                className="flex h-11 items-center gap-1 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Berikutnya <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>
  );
}
