"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { Maximize2, Minimize2, RotateCcw, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type PosDensity = "comfortable" | "compact";
export type PosColumns = "auto" | "4" | "5" | "6";
export type PosView = "grid" | "list";
export type PosFontScale = "normal" | "large" | "xl";
export type PosCardShape = "rounded" | "square";
export type PosActionTheme = "odoo" | "teal" | "accurate" | "graphite";

export const POS_ACTION_THEMES: Record<
  PosActionTheme,
  { label: string; primary: string; deep: string; soft: string; softText: string; foreground: string }
> = {
  accurate: { label: "Hijau Retail", primary: "#047857", deep: "#065f46", soft: "#ecfdf5", softText: "#065f46", foreground: "#ffffff" },
  teal: { label: "Teal Modern", primary: "#0f766e", deep: "#115e59", soft: "#f0fdfa", softText: "#115e59", foreground: "#ffffff" },
  graphite: { label: "Biru POS", primary: "#2563eb", deep: "#1d4ed8", soft: "#eff6ff", softText: "#1e40af", foreground: "#ffffff" },
  odoo: { label: "Odoo Indigo", primary: "#4f46e5", deep: "#4338ca", soft: "#eef2ff", softText: "#3730a3", foreground: "#ffffff" },
};

export type PosDisplayPrefs = {
  density: PosDensity;
  columns: PosColumns;
  cartWidth: number;
  showStock: boolean;
  showSku: boolean;
  showPackaging: boolean;
  showPrice: boolean;
  view: PosView;
  fontScale: PosFontScale;
  cardShape: PosCardShape;
  cardTint: boolean;
  showCategory: boolean;
  colorByCategory: boolean;
  autoFullscreen: boolean;
  actionTheme: PosActionTheme;
};

export const POS_DISPLAY_DEFAULTS: PosDisplayPrefs = {
  density: "comfortable",
  columns: "auto",
  cartWidth: 396,
  showStock: true,
  showSku: false,
  showPackaging: true,
  showPrice: true,
  view: "grid",
  fontScale: "large",
  cardShape: "rounded",
  cardTint: true,
  showCategory: false,
  colorByCategory: false,
  autoFullscreen: false,
  actionTheme: "accurate",
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
      showSku: typeof parsed.showSku === "boolean" ? parsed.showSku : false,
      showPackaging: typeof parsed.showPackaging === "boolean" ? parsed.showPackaging : true,
      showPrice: typeof parsed.showPrice === "boolean" ? parsed.showPrice : true,
      view: parsed.view === "list" ? "list" : "grid",
      fontScale:
        parsed.fontScale === "large" || parsed.fontScale === "xl"
          ? parsed.fontScale
          : parsed.fontScale === "normal"
            ? parsed.fontScale
            : POS_DISPLAY_DEFAULTS.fontScale,
      cardShape: parsed.cardShape === "square" ? "square" : "rounded",
      cardTint: typeof parsed.cardTint === "boolean" ? parsed.cardTint : true,
      showCategory: typeof parsed.showCategory === "boolean" ? parsed.showCategory : false,
      colorByCategory: typeof parsed.colorByCategory === "boolean" ? parsed.colorByCategory : false,
      autoFullscreen:
        typeof parsed.autoFullscreen === "boolean" ? parsed.autoFullscreen : false,
      actionTheme:
        parsed.actionTheme && parsed.actionTheme in POS_ACTION_THEMES
          ? parsed.actionTheme
          : POS_DISPLAY_DEFAULTS.actionTheme,
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

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onToggleFullscreen}
        title={fullscreen ? "Keluar layar penuh (Esc)" : "Layar penuh"}
        aria-label={fullscreen ? "Keluar layar penuh" : "Layar penuh"}
        aria-pressed={fullscreen}
        className={cn(
          "hidden h-11 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium transition-colors lg:flex",
          fullscreen
            ? "border-primary bg-primary/5 text-foreground"
            : "border-[var(--pos-border-strong)] bg-background text-slate-700 hover:bg-muted",
        )}
      >
        {fullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        <span className="hidden sm:inline">{fullscreen ? "Keluar" : "Layar penuh"}</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Atur tampilan POS"
          aria-label="Atur tampilan POS"
          aria-expanded={open}
          aria-haspopup="dialog"
          className={cn(
            "flex h-11 min-w-11 items-center justify-center gap-2 rounded-md border border-[var(--pos-border-strong)] bg-background px-3 text-[13px] font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:justify-start",
            open && "bg-muted",
          )}
        >
          <SlidersHorizontal className="size-4" />
          <span className="hidden sm:inline">Tampilan</span>
        </button>

        <SheetContent
          side="right"
          overlayClassName="z-[70]"
          aria-label="Pengaturan tampilan POS"
          className="z-[71] w-full gap-0 overflow-y-auto p-0 sm:w-[420px] sm:max-w-[420px]"
        >
          <SheetHeader className="border-b border-border px-5 py-5 pr-14">
            <SheetTitle className="text-lg">Tampilan kasir</SheetTitle>
            <SheetDescription>
              Sesuaikan katalog untuk ukuran layar, jarak pandang, dan cara kerja kasir.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-6 p-5">
            <section className="space-y-2.5" aria-labelledby="pos-display-presets">
              <h3 id="pos-display-presets" className="text-sm font-semibold">Preset kasir</h3>
              <div className="grid grid-cols-3 gap-2">
                <Preset
                  label="Seimbang"
                  description="Katalog umum"
                  active={prefs.view === "grid" && prefs.fontScale === "large" && prefs.density === "comfortable"}
                  onClick={() => onChange({ view: "grid", density: "comfortable", columns: "auto", fontScale: "large" })}
                />
                <Preset
                  label="Sentuh besar"
                  description="Jarak jauh"
                  active={prefs.view === "grid" && prefs.fontScale === "xl" && prefs.columns === "4"}
                  onClick={() => onChange({ view: "grid", density: "comfortable", columns: "4", fontScale: "xl" })}
                />
                <Preset
                  label="Daftar"
                  description="Nama panjang"
                  active={prefs.view === "list"}
                  onClick={() => onChange({ view: "list", density: "comfortable", fontScale: "large" })}
                />
              </div>
            </section>

            <section className="space-y-2.5" aria-labelledby="pos-display-theme">
              <h3 id="pos-display-theme" className="text-sm font-semibold">Warna aksi</h3>
              <div className="grid grid-cols-3 gap-2">
                {(Object.entries(POS_ACTION_THEMES) as [PosActionTheme, (typeof POS_ACTION_THEMES)[PosActionTheme]][]).map(
                  ([key, theme]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onChange({ actionTheme: key })}
                      aria-pressed={prefs.actionTheme === key}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-md border px-2.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        prefs.actionTheme === key
                          ? "border-foreground/50 bg-muted text-foreground"
                          : "border-border bg-background text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: theme.primary }}
                      />
                      <span className="truncate">{theme.label}</span>
                    </button>
                  ),
                )}
              </div>
              <p className="text-[11px] leading-4 text-muted-foreground">
                Mewarnai header keranjang, panel pembayaran, kategori aktif, dan tombol Bayar.
              </p>
            </section>

            <section className="space-y-4" aria-labelledby="pos-display-catalog">
              <h3 id="pos-display-catalog" className="text-sm font-semibold">Katalog produk</h3>
              <Field label="Susunan">
                <Segment active={prefs.view === "grid"} onClick={() => onChange({ view: "grid" })}>Kotak</Segment>
                <Segment active={prefs.view === "list"} onClick={() => onChange({ view: "list" })}>Daftar</Segment>
              </Field>
              <Field label="Jumlah kolom">
                {(["auto", "4", "5", "6"] as const).map((value) => (
                  <Segment key={value} active={prefs.columns === value} onClick={() => onChange({ columns: value })}>
                    {value === "auto" ? "Otomatis" : value}
                  </Segment>
                ))}
              </Field>
              <Field label="Kerapatan kartu">
                <Segment active={prefs.density === "comfortable"} onClick={() => onChange({ density: "comfortable" })}>Nyaman</Segment>
                <Segment active={prefs.density === "compact"} onClick={() => onChange({ density: "compact" })}>Padat</Segment>
              </Field>
              <Field label="Ukuran teks">
                {(["normal", "large", "xl"] as const).map((value) => (
                  <Segment key={value} active={prefs.fontScale === value} onClick={() => onChange({ fontScale: value })}>
                    {value === "normal" ? "Standar" : value === "large" ? "Besar" : "Sangat besar"}
                  </Segment>
                ))}
              </Field>
            </section>

            <section className="space-y-4" aria-labelledby="pos-display-cards">
              <h3 id="pos-display-cards" className="text-sm font-semibold">Informasi kartu</h3>
              <Field label="Bentuk kartu">
                <Segment active={prefs.cardShape === "rounded"} onClick={() => onChange({ cardShape: "rounded" })}>Sudut lembut</Segment>
                <Segment active={prefs.cardShape === "square"} onClick={() => onChange({ cardShape: "square" })}>Kotak</Segment>
              </Field>
              <Toggle label="Harga jual" checked={prefs.showPrice} onChange={(showPrice) => onChange({ showPrice })} />
              <Toggle label="Informasi stok" checked={prefs.showStock} onChange={(showStock) => onChange({ showStock })} />
              <Toggle label="SKU produk" checked={prefs.showSku} onChange={(showSku) => onChange({ showSku })} />
              <Toggle label="Pilihan kemasan" checked={prefs.showPackaging} onChange={(showPackaging) => onChange({ showPackaging })} />
              <Toggle label="Nama kategori" checked={prefs.showCategory} onChange={(showCategory) => onChange({ showCategory })} />
              <Toggle label="Warna kategori pada kartu" checked={prefs.cardTint} onChange={(cardTint) => onChange({ cardTint })} />
            </section>

            <section className="space-y-4" aria-labelledby="pos-display-terminal">
              <h3 id="pos-display-terminal" className="text-sm font-semibold">Layar terminal</h3>
              <Field label="Lebar keranjang (desktop)">
                {POS_CART_WIDTHS.map((width) => (
                  <Segment key={width} active={prefs.cartWidth === width} onClick={() => onChange({ cartWidth: width })}>
                    {width === 360 ? "S" : width === 396 ? "M" : width === 440 ? "L" : "XL"}
                  </Segment>
                ))}
              </Field>
              <Toggle label="Masuk layar penuh otomatis" checked={prefs.autoFullscreen} onChange={(autoFullscreen) => onChange({ autoFullscreen })} />
            </section>

            <button
              type="button"
              onClick={onReset}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw className="size-4" /> Kembalikan bawaan
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <span className="block text-xs font-semibold text-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
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
        "min-h-11 min-w-12 rounded-md border px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Preset({
  label,
  description,
  active,
  onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex min-h-[72px] flex-col items-start justify-center rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-primary/5 text-foreground" : "border-border bg-background hover:bg-muted",
      )}
    >
      <span className="text-[13px] font-semibold">{label}</span>
      <span className="text-[11px] leading-4 text-muted-foreground">{description}</span>
    </button>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 rounded-md border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/60">
      <span className="text-foreground">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5 shrink-0 accent-primary"
      />
    </label>
  );
}
