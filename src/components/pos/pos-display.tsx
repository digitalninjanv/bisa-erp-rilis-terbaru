"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Maximize2, Minimize2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export type PosDensity = "comfortable" | "compact";
export type PosColumns = "auto" | "4" | "5" | "6";

export type PosDisplayPrefs = {
  density: PosDensity;
  columns: PosColumns;
  cartWidth: number;
  showStock: boolean;
  autoFullscreen: boolean;
};

export const POS_DISPLAY_DEFAULTS: PosDisplayPrefs = {
  density: "comfortable",
  columns: "auto",
  cartWidth: 396,
  showStock: true,
  autoFullscreen: false,
};

export const POS_CART_WIDTHS = [360, 396, 440, 480] as const;

// FIX-POS Tahap 4 (POS2-04): tangga kolom mengikuti lebar STRIP
// produk pada tata letak dua panel (terminal dua panel mulai lg):
// strip lg ≈330–470px menampung 3 kolom, xl ≈580px 4 kolom, dan
// preferensi 5–6 kolom baru masuk akal pada strip 2xl yang lebar.
export const POS_COLUMN_CLASS: Record<PosColumns, string> = {
  auto: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  "4": "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4",
  "5": "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5",
  "6": "grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6",
};

const STORAGE_KEY = "bisa.pos.display";

function readPrefs(): PosDisplayPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return POS_DISPLAY_DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<PosDisplayPrefs>;
    return {
      density: parsed.density === "compact" ? "compact" : "comfortable",
      columns:
        parsed.columns === "4" || parsed.columns === "5" || parsed.columns === "6"
          ? parsed.columns
          : "auto",
      cartWidth: POS_CART_WIDTHS.includes(parsed.cartWidth as (typeof POS_CART_WIDTHS)[number])
        ? (parsed.cartWidth as number)
        : POS_DISPLAY_DEFAULTS.cartWidth,
      showStock: typeof parsed.showStock === "boolean" ? parsed.showStock : true,
      autoFullscreen:
        typeof parsed.autoFullscreen === "boolean" ? parsed.autoFullscreen : false,
    };
  } catch {
    return POS_DISPLAY_DEFAULTS;
  }
}

const listeners = new Set<() => void>();
let cached: PosDisplayPrefs | null = null;

function getSnapshot(): PosDisplayPrefs {
  if (typeof window === "undefined") return POS_DISPLAY_DEFAULTS;
  if (!cached) cached = readPrefs();
  return cached;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  function onStorage(event: StorageEvent) {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    cached = null;
    listener();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function writePrefs(next: PosDisplayPrefs) {
  cached = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage can be unavailable (private mode); keep the in-memory prefs.
  }
  for (const listener of listeners) listener();
}

const noopSubscribe = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function usePosDisplayPrefs() {
  const prefs = useSyncExternalStore(subscribe, getSnapshot, () => POS_DISPLAY_DEFAULTS);

  const update = useCallback((patch: Partial<PosDisplayPrefs>) => {
    writePrefs({ ...getSnapshot(), ...patch });
  }, []);

  const reset = useCallback(() => writePrefs(POS_DISPLAY_DEFAULTS), []);

  return { prefs, update, reset };
}

export function PosDisplayControls({
  prefs,
  onChange,
  onReset,
  fullscreen,
  onToggleFullscreen,
}: {
  prefs: PosDisplayPrefs;
  onChange: (patch: Partial<PosDisplayPrefs>) => void;
  onReset: () => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
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

  return (
    <div ref={rootRef} className="relative flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? "Keluar layar penuh (Esc)" : "Layar penuh"}
        aria-label={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
        aria-pressed={fullscreen}
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors",
          fullscreen
            ? "border-primary bg-primary/5 text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        <span className="hidden sm:inline">{fullscreen ? "Keluar" : "Layar penuh"}</span>
      </button>

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        title="Atur tampilan POS"
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cn(
          "flex h-10 items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium transition-colors",
          open ? "bg-muted text-foreground" : "bg-background text-muted-foreground hover:bg-muted",
        )}
      >
        <SlidersHorizontal className="size-3.5" />
        <span className="hidden sm:inline">Tampilan</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Pengaturan tampilan POS"
          className="absolute right-0 top-full z-20 mt-1 w-64 space-y-3 rounded-lg border border-border bg-card p-3 text-[11px] shadow-lg"
        >
          <Field label="Kerapatan">
            <Segment
              active={prefs.density === "comfortable"}
              onClick={() => onChange({ density: "comfortable" })}
            >
              Nyaman
            </Segment>
            <Segment
              active={prefs.density === "compact"}
              onClick={() => onChange({ density: "compact" })}
            >
              Padat
            </Segment>
          </Field>

          <Field label="Kolom produk">
            {(["auto", "4", "5", "6"] as const).map((value) => (
              <Segment
                key={value}
                active={prefs.columns === value}
                onClick={() => onChange({ columns: value })}
              >
                {value === "auto" ? "Auto" : value}
              </Segment>
            ))}
          </Field>

          <Field label="Lebar keranjang">
            {POS_CART_WIDTHS.map((width) => (
              <Segment
                key={width}
                active={prefs.cartWidth === width}
                onClick={() => onChange({ cartWidth: width })}
              >
                {width === 360 ? "S" : width === 396 ? "M" : width === 440 ? "L" : "XL"}
              </Segment>
            ))}
          </Field>

          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Badge stok produk</span>
            <input
              type="checkbox"
              checked={prefs.showStock}
              onChange={(event) => onChange({ showStock: event.target.checked })}
              className="size-3.5 accent-primary"
            />
          </label>

          <label className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Layar penuh otomatis</span>
            <input
              type="checkbox"
              checked={prefs.autoFullscreen}
              onChange={(event) => onChange({ autoFullscreen: event.target.checked })}
              className="size-3.5 accent-primary"
            />
          </label>

          <button
            type="button"
            onClick={onReset}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-muted"
          >
            <RotateCcw className="size-3" /> Kembalikan bawaan
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * G1 (FRM-04): komponen lokal ini SENGAJA bukan salinan Field bersama
 * blocks/field — ia membungkus kelompok tombol segmen (grup berlabel
 * dengan anak mengalir `flex flex-wrap`), bukan satu kontrol form di
 * dalam <label>. Memaksakannya ke Field bersama akan mengubah
 * semantik & tata letaknya; pola grup-berlabel popover tampilan POS
 * tetap lokal di sini.
 */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Segment({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded px-2 py-1 text-[10px] font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
