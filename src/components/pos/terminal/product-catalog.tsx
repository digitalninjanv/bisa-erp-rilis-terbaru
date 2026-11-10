/**
 * A-26 Q7 (K-07): pecahan `pos-terminal.tsx` — panel katalog produk (cari/
 * pindai, pemilih gudang & reservasi, status offline, kisi
 * produk berpaginasi). JSX dipindah apa adanya dari terminal;
 * ref burst pindai kini milik panel ini (hanya dipakai di sini).
 */
"use client";

import { useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { toast } from "sonner";
import { Barcode, ChevronLeft, ChevronRight, CloudOff, RefreshCw, Search, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR, formatQty } from "@/lib/money";
import { POS_COLUMN_CLASS, PosDisplayControls, type PosDisplayPrefs } from "@/components/pos/pos-display";
import { burstScanCode, createBurstState, feedBurstChar, resetBurst, type BurstState } from "@/lib/barcode-burst";
import type { ProductOption, TerminalReservation } from "@/components/pos/terminal-types";
import { ShortcutHelp } from "@/components/pos/terminal/shortcut-help";

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
  selectedWarehouse: string;
  setSelectedWarehouse: Dispatch<SetStateAction<string>>;
  setReservationId: Dispatch<SetStateAction<string | null>>;
  reservations: TerminalReservation[];
  reservationId: string | null;
  applyReservation: (reservation: TerminalReservation) => Promise<void>;
  sessionOpen: boolean;
  posOfflineEnabled: boolean;
  online: boolean;
  queuedCount: number;
  syncing: boolean;
  syncOfflineQueue: () => Promise<void>;
  display: PosDisplayPrefs;
  updateDisplay: (patch: Partial<PosDisplayPrefs>) => void;
  resetDisplay: () => void;
  fullscreen: boolean;
  setFullscreenOverride: Dispatch<SetStateAction<boolean | null>>;
}) {
  const { searchRef, search, setSearch, products, searching, page, pageFull, goToPage, scanBarcode, addProduct, warehouses, selectedWarehouse, setSelectedWarehouse, setReservationId, reservations, reservationId, applyReservation, sessionOpen, posOfflineEnabled, online, queuedCount, syncing, syncOfflineQueue, display, updateDisplay, resetDisplay, fullscreen, setFullscreenOverride } = props;
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

  const isSoldOut = (product: ProductOption) => product.trackStock && product.stock <= 0;

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
            <div className="relative min-w-[180px] flex-1">
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
                        else toast.error(`Barcode ${term} tidak ditemukan.`);
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
                placeholder="Scan barcode / cari produk… (F2)"
                aria-label="Cari produk atau scan barcode"
                className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <select
              value={selectedWarehouse}
              onChange={(event) => {
                setSelectedWarehouse(event.target.value);
                // Reservasi terikat gudang — ganti gudang melepaskan pilihan.
                setReservationId(null);
              }}
              className="h-10 rounded-md border border-input bg-background px-2.5 text-[13px]"
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
                className="h-10 max-w-[240px] rounded-md border border-input bg-background px-2.5 text-[13px]"
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
            {/* POS2-24: warna titik mengikuti status sesi — hijau
                hanya bila sesi benar-benar terbuka. */}
            <div className="flex h-10 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 text-[11px] text-muted-foreground">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  sessionOpen ? "bg-tone-green" : "bg-tone-amber",
                )}
              />
              {sessionOpen ? "Sesi kas terbuka" : "Sesi kas belum dibuka"}
            </div>
            {/* POS2-03: status penangkap scanner global selalu terlihat. */}
            <div
              className="flex h-10 items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2.5 text-[11px] text-muted-foreground"
              title="Scanner barcode aktif — hasil pindai ditangkap di mana pun fokus berada di terminal"
            >
              <Barcode className="size-3.5" /> Scanner siap
            </div>
            {posOfflineEnabled ? (
              <div
                className={`flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[11px] ${
                  online
                    ? "border-border bg-muted/60 text-muted-foreground"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }`}
                title="Status mode offline POS"
              >
                {online ? <Wifi className="size-3.5" /> : <CloudOff className="size-3.5" />}
                {online ? "Online" : "Offline — penjualan diantrekan"}
                {queuedCount > 0 ? (
                  <>
                    <span className="font-semibold">{queuedCount} antre</span>
                    <button
                      type="button"
                      onClick={() => void syncOfflineQueue()}
                      disabled={!online || syncing}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent disabled:opacity-40"
                    >
                      <RefreshCw className={`size-3 ${syncing ? "animate-spin" : ""}`} />
                      {syncing ? "Menyinkronkan…" : "Sinkronkan"}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
            <PosDisplayControls
              prefs={display}
              onChange={updateDisplay}
              onReset={resetDisplay}
              fullscreen={fullscreen}
              onToggleFullscreen={() => setFullscreenOverride(!fullscreen)}
            />
            <ShortcutHelp />
          </div>

          <div
            ref={gridRef}
            className={cn(
              "grid",
              POS_COLUMN_CLASS[display.columns],
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
                // A-28 UI-1 (UX-B02): kartu tersorot navigasi panah
                // tampil berbingkai primer + cincin, setara sorotan
                // fokus keyboard pada combobox/palet perintah.
                const highlighted = index === highlight;
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
                      // Validasi 2 (V-03): kartu mengikuti isi — tanpa
                      // justify-between/min-h yang meregangkan kartu
                      // dan menjauhkan harga dari nama. Harga kini
                      // tepat di bawah nama, chip stok sejajar di
                      // baris yang sama; lebih banyak baris produk
                      // muat per layar di kedua mode kepadatan.
                      "group flex flex-col rounded-lg border border-border bg-background text-left transition-colors hover:border-primary/50 hover:bg-accent/40",
                      display.density === "compact" ? "p-2" : "p-2.5",
                      soldOut && "cursor-not-allowed opacity-60 hover:border-border hover:bg-background",
                      highlighted &&
                        "border-primary bg-accent/40 ring-2 ring-ring/40 hover:border-primary",
                    )}
                  >
                    <span className="line-clamp-2 text-[12px] font-medium leading-snug">{product.name}</span>
                    {/* S4: penanda kemasan pada kartu katalog — kasir
                        tahu produk ini juga dijual per kemasan. */}
                    {(product.packagings?.length ?? 0) > 0 ? (
                      <span className="mt-0.5 flex flex-wrap gap-1">
                        {product.packagings!.map((pack) => (
                          <span
                            key={pack.id}
                            className="num rounded bg-tone-teal-soft px-1.5 py-0.5 text-[10px] font-medium text-tone-teal"
                          >
                            {pack.name} isi {formatQty(pack.isi)}
                            {pack.salePrice != null ? ` · ${formatIDR(pack.salePrice)}` : ""}
                          </span>
                        ))}
                      </span>
                    ) : null}
                    <span className="mt-1 flex items-end justify-between gap-1">
                      <span className="num text-[13px] font-semibold">{formatIDR(product.salePrice)}</span>
                      {display.showStock ? (
                        soldOut ? (
                          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                            Stok habis
                          </span>
                        ) : (
                          <span
                            className={cn(
                              "num rounded px-1.5 py-0.5 text-[10px]",
                              product.stock > 0 ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
                            )}
                          >
                            {formatQty(product.stock)} {product.unitCode}
                          </span>
                        )
                      ) : soldOut ? (
                        // POS2-28: alasan kartu nonaktif tidak boleh
                        // hilang hanya karena badge stok disembunyikan.
                        <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold text-destructive">
                          Stok habis
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* POS-1: pagination kisi produk — halaman diganti lewat
              offset server; kata cari/gudang baru selalu mulai dari 1. */}
          <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              Halaman {page} · {products.length} produk
              {!pageFull && page > 1 ? " · halaman terakhir" : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || searching}
                onClick={() => goToPage(page - 1)}
                className="flex h-8 items-center gap-0.5 rounded-md border border-border px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="size-3.5" /> Sebelumnya
              </button>
              <button
                type="button"
                disabled={!pageFull || searching}
                onClick={() => goToPage(page + 1)}
                className="flex h-8 items-center gap-0.5 rounded-md border border-border px-2 text-[11px] font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
              >
                Berikutnya <ChevronRight className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>
  );
}
