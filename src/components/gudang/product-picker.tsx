"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Search } from "lucide-react";
import { formatIDR } from "@/lib/money";
import {
  burstExpired,
  burstScanCode,
  createBurstState,
  feedBurstChar,
  resetBurst,
  type BurstState,
} from "@/lib/barcode-burst";
import {
  resolveBarcodeAction,
  searchInventoryProductsAction,
} from "@/server/actions/inventory/produk";

/** Kemasan aktif satu produk (Satuan Kemasan S2) untuk pemilih satuan baris. */
export type PickedPackaging = {
  id: string;
  name: string;
  isi: string;
  buyPrice: string | null;
  salePrice: string | null;
  barcode: string | null;
  isDefaultPurchase: boolean;
  isDefaultSale: boolean;
};

type Picked = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  /** null = harga pokok tidak terlihat bagi pemakai (tanpa
   * inventory.cost, R3 K-3) — pemilih tidak menampilkannya. */
  costPrice: string | null;
  salePrice: string;
  trackBatch: boolean;
  trackSerial: boolean;
  /** S3: nama satuan dasar produk (label komponen lepas opname). */
  unitName?: string | null;
  packagings?: PickedPackaging[];
  /** Terisi bila produk dipilih lewat PINDAI barcode kemasan: kemasan
   * yang terpindai, agar baris langsung memakai kemasan itu. */
  scannedPackagingId?: string | null;
};

/**
 * Pemilih produk gudang. FIX-GDG Tahap 4 (GDG2-03) menambah MODE PINDAI:
 * scanner wedge mengetik kode + Enter dalam hitungan milidetik — jauh
 * sebelum debounce pencarian 200 ms sempat menjawab — sehingga Enter
 * lama mengambil hasil basi atau tidak melakukan apa-apa. Dengan
 * `scanMode`, aliran ketik dinilai pelacak ledakan bersama POS
 * (lib/barcode-burst): ledakan yang memenuhi syarat dinilai PINDAIAN,
 * dicarikan barcode/SKU persisnya lewat pencarian SEGAR (bukan hasil
 * debounce), lalu produk langsung dipilih dan fokus tetap di kotak —
 * petugas dapat memindai barang berikutnya tanpa menyentuh mouse.
 * Kode tanpa pasangan persis jatuh kembali menjadi pencarian biasa
 * (tidak ada yang hilang). Tanpa scanMode, Enter kini juga tidak lagi
 * mengambil baris pertama saat hasil masih dimuat (hasil basi).
 */
export function ProductPicker({
  onPick,
  placeholder = "Cari produk…",
  scanMode = false,
  autoFocus = false,
}: {
  onPick: (product: Picked) => void;
  placeholder?: string;
  scanMode?: boolean;
  /**
   * A-28 UI-5 (UX-B05): fokus awal HANYA untuk permukaan kerja yang
   * digerakkan pindai (opname — pola yang sama seperti Mode Operasi &
   * terminal POS). Pemakai lain (formulir dokumen biasa) tidak
   * mengaktifkannya: mencuri fokus pada formulir umum adalah gesekan,
   * bukan bantuan.
   */
  autoFocus?: boolean;
}) {
  const [term, setTerm] = useState("");
  const [rows, setRows] = useState<Picked[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [flash, setFlash] = useState(false);
  const seq = useRef(0);
  const burstRef = useRef<BurstState>(createBurstState());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const flashTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!term.trim()) return;
    const current = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      void (async () => {
        const result = await searchInventoryProductsAction(term);
        if (current !== seq.current) return;
        setLoading(false);
        if (!result.ok) {
          setRows([]);
          return;
        }
        setRows(result.data);
        setActiveIndex(0);
        setOpen(true);
      })();
    }, 200);
    return () => clearTimeout(timer);
  }, [term]);

  useEffect(
    () => () => {
      if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    },
    [],
  );

  // UX-B05: fokus awal saat komponen terpasang (dan terpasang ulang —
  // mis. petugas opname kembali dari langkah Tinjau ke Hitung).
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  function pick(product: Picked) {
    onPick(product);
    setTerm("");
    setRows([]);
    setOpen(false);
    resetBurst(burstRef.current);
  }

  function flashScanned() {
    setFlash(true);
    if (flashTimer.current !== null) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(false), 700);
  }

  /** Resolusi pindaian: cari kode secara segar dan pilih pasangan persis. */
  async function resolveScan(code: string) {
    const current = ++seq.current;
    setLoading(true);
    const result = await searchInventoryProductsAction(code);
    if (current !== seq.current) return;
    setLoading(false);
    if (!result.ok) {
      setRows([]);
      return;
    }
    const exact =
      result.data.find((row) => row.barcode === code) ??
      result.data.find((row) => row.sku === code);
    if (exact) {
      pick(exact);
      flashScanned();
      inputRef.current?.focus();
      return;
    }
    // S2: bukan barcode dasar/SKU produk — coba barcode KEMASAN lewat
    // resolusi barcode satu-satunya di server (findProductByAnyBarcode).
    // Memindai dus memilih produknya DAN kemasan dus itu sekaligus.
    const resolved = await resolveBarcodeAction({ barcode: code });
    if (current !== seq.current) return;
    if (resolved.ok && resolved.data) {
      pick({
        ...resolved.data.product,
        scannedPackagingId: resolved.data.packaging?.id ?? null,
      });
      flashScanned();
      inputRef.current?.focus();
      return;
    }
    // Bukan barcode/SKU yang dikenal: perlakukan sebagai pencarian biasa.
    setRows(result.data);
    setActiveIndex(0);
    setOpen(true);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const state = burstRef.current;
    const now = performance.now();

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (rows.length === 0) return;
      event.preventDefault();
      setActiveIndex((index) => {
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        return Math.max(0, Math.min(rows.length - 1, next));
      });
      return;
    }

    if (event.key === "Enter") {
      // Ledakan scanner yang memenuhi syarat kecepatan & panjang dan
      // isinya sama persis dengan isi kotak → pindaian, bukan ketikan.
      const code = scanMode ? burstScanCode(state, now) : null;
      resetBurst(state);
      if (code && code === term) {
        event.preventDefault();
        void resolveScan(code);
        return;
      }
      // Enter manual: jangan ambil hasil basi saat pencarian berjalan.
      if (loading) return;
      const target = rows[activeIndex] ?? rows[0];
      if (target) {
        event.preventDefault();
        pick(target);
      }
      return;
    }

    if (!scanMode) return;
    if (event.key.length !== 1) return;
    if (burstExpired(state, now)) resetBurst(state);
    feedBurstChar(state, event.key, now);
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        className={`h-9 w-full rounded-md border bg-background pl-8 pr-8 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 ${
          flash ? "border-tone-green ring-2 ring-tone-green/30" : "border-input"
        }`}
      />
      {flash ? (
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-tone-green">
          <Check className="size-3.5" />
        </span>
      ) : null}
      {open && term.trim() ? (
        <div className="absolute left-0 right-0 top-9 z-30 max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {loading ? (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">Mencari…</p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-muted-foreground">Tidak ada produk.</p>
          ) : (
            rows.map((row, index) => (
              <button
                key={row.id}
                type="button"
                onClick={() => pick(row)}
                onMouseEnter={() => setActiveIndex(index)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left ${
                  index === activeIndex ? "bg-muted" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-medium">{row.name}</span>
                  <span className="num block text-[10px] text-muted-foreground">{row.sku}{row.barcode ? ` · ${row.barcode}` : ""}</span>
                </span>
                {row.costPrice !== null ? (
                  <span className="num shrink-0 text-[11px] text-muted-foreground">{formatIDR(row.costPrice)}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
