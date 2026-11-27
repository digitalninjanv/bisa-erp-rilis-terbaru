import { useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  AlertTriangle,
  Minus,
  PauseCircle,
  Plus,
  ReceiptText,
  ShoppingCart,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatIDR, formatQty } from "@/lib/money";
import type { QuoteResultPublic } from "@/server/pos";
import type { PromotionRule } from "@/lib/pos/promotions";
import { QtyInput } from "@/components/qty-input";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import {
  cartLineBaseQty,
  cartLineIsi,
  cartLineKey,
  type CartItem,
  type ProductOption,
} from "@/components/pos/terminal-types";

type QuoteLine = QuoteResultPublic["lines"][number];
type PriceGroup = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: string;
  roundCashTotal: boolean;
};

// FIX-ARS Tahap 5 (ARS2-01): panel keranjang — kartu keranjang beserta
// pemilih kelompok harga, daftar baris (qty/seri), dan total.
export function CartPanel(props: {
  cart: CartItem[];
  cache: Record<string, ProductOption>;
  quote: QuoteResultPublic | null;
  quoteLine: (productId: string, packagingId?: string | null) => QuoteLine | null;
  total: number;
  heldTotal: number | null;
  groupId: string;
  setGroupId: Dispatch<SetStateAction<string>>;
  groups: PriceGroup[];
  selectedGroup: PriceGroup | undefined;
  heldCount: number;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  /** Reset konteks transaksi (keranjang, pelanggan, tahanan, reservasi). */
  onClearCart?: () => void;
  /** S4: penyunting berkunci baris (produk, kemasan) — lihat cartLineKey. */
  setQty: (key: string, qty: number) => void;
  setSerial: (key: string, index: number, value: string) => void;
  setLinePackaging: (key: string, packagingId: string | null) => void;
  setLineDiscount?: (key: string, type: "percent" | "nominal" | null, value: number) => void;
  quoteBusy: boolean;
  allowNegativeStock?: boolean;
  availablePromotions?: PromotionRule[];
  onApplyPromotion?: (promo: PromotionRule) => void;
  scrollMode?: "contained" | "page";
  /** Sheet mobile: judul sudah ada di header sheet, cukup aksi baris. */
  compactHeader?: boolean;
  /** Footer aksi (total + Bayar) yang menempel di dasar kartu keranjang. */
  footer?: ReactNode;
  className?: string;
}) {
  const {
    cart,
    cache,
    quote,
    quoteLine,
    total,
    heldTotal,
    groupId,
    setGroupId,
    groups,
    selectedGroup,
    heldCount,
    setCart,
    onClearCart,
    setQty,
    setSerial,
    setLinePackaging,
    setLineDiscount,
    quoteBusy,
    allowNegativeStock = false,
    availablePromotions = [],
    onApplyPromotion,
    scrollMode = "contained",
    compactHeader = false,
    footer,
    className,
  } = props;
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [discountTargetKey, setDiscountTargetKey] = useState<string | null>(null);
  const [lineDiscType, setLineDiscType] = useState<"percent" | "nominal">("percent");
  const [lineDiscVal, setLineDiscVal] = useState("");
  const [bulkSerialKey, setBulkSerialKey] = useState<string | null>(null);
  const [bulkSerialText, setBulkSerialText] = useState("");
  const [linesScrolled, setLinesScrolled] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const hasBreakdown =
    (quote?.discountTotal ?? 0) > 0 ||
    (quote?.taxTotal ?? 0) > 0 ||
    (quote?.roundingAdjustment ?? 0) !== 0;
  const linesRef = useRef<HTMLDivElement>(null);
  // Setelah scan, baris terbaru harus terlihat — sebelumnya daftar tetap
  // di scrollTop 0 sehingga item ke-5..8 tidak pernah tampak.
  useEffect(() => {
    const element = linesRef.current;
    if (!element || scrollMode !== "contained") return;
    element.scrollTop = element.scrollHeight;
  }, [cart.length, scrollMode]);
  return (
        <div
          className={cn(
            "flex min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] shadow-[var(--shadow-card)]",
            className,
          )}
        >
          {(!compactHeader || cart.length > 0 || heldCount > 0) ? (
          <div className="flex min-h-14 items-center justify-between gap-2 border-b border-[var(--pos-command)] bg-[var(--pos-command)] px-3 py-2.5 text-[var(--pos-command-fg)] lg:sticky lg:top-0 lg:z-20 lg:rounded-t-[11px]">
            <div className="flex min-w-0 items-center gap-2">
              <ShoppingCart className={cn("size-5 text-[var(--pos-gold-soft)]", compactHeader && "hidden")} />
              <h2 className={cn("text-base font-bold", compactHeader && "hidden")}>Keranjang</h2>
              <button
                type="button"
                onClick={() => setSummaryOpen(true)}
                aria-label={`Rincian transaksi, ${cart.length} baris`}
                title="Rincian transaksi"
                className="num inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-full bg-white/15 px-2 text-xs font-bold text-[var(--pos-command-fg)] transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
              >
                <ReceiptText className="size-3.5" aria-hidden="true" />
                {cart.length}
              </button>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* Di laptop pendek baris Harga penuh disembunyikan agar
                  kolom Uang diterima tetap terlihat; selector ringkas
                  ini memakai state yang sama. */}
              <div className="flex items-center">
                <label className="sr-only" htmlFor="pos-price-group-compact">Kelompok harga</label>
                <select
                  id="pos-price-group-compact"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                  aria-label="Kelompok harga"
                  title={
                    selectedGroup
                      ? `Harga kelompok aktif · pembulatan ${selectedGroup.roundingStep.toLocaleString("id-ID")} ${selectedGroup.roundingDirection === "down" ? "ke bawah" : selectedGroup.roundingDirection === "up" ? "ke atas" : "terdekat"}`
                      : "Harga normal (tanpa kelompok)"
                  }
                  className="h-11 max-w-[132px] rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-panel)] px-2 text-xs font-semibold text-[var(--pos-ink)]"
                >
                  <option value="">Harga normal</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
              </div>
              {heldCount > 0 ? (
                <a
                  href="/app/pos/ditahan"
                  aria-label={`Lihat ${heldCount} pesanan ditahan`}
                  title={`${heldCount} pesanan ditahan`}
                  className="flex min-h-11 items-center gap-1 rounded-md px-2 text-sm font-medium text-[var(--pos-command-fg)] hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
                >
                  <PauseCircle className="size-4" />
                  <span className="num rounded-full bg-[var(--pos-gold)] px-1.5 py-0.5 text-xs font-bold text-[var(--pos-gold-ink)]">
                    {heldCount}
                  </span>
                </a>
              ) : null}
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearCart(true)}
                  aria-label="Kosongkan keranjang"
                  title="Kosongkan keranjang"
                  className="grid size-11 place-items-center rounded-md text-[var(--pos-command-muted)] hover:bg-red-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          </div>
          ) : null}

          {availablePromotions.length > 0 && onApplyPromotion ? (
            <div className="border-b border-[var(--pos-border-strong)] bg-tone-teal-soft px-4 py-2.5">
              <p className="text-[11px] font-semibold text-tone-teal">Promo tersedia untuk keranjang ini</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {availablePromotions.map((promo) => (
                  <button
                    key={promo.id}
                    type="button"
                    onClick={() => onApplyPromotion(promo)}
                    className="inline-flex min-h-8 items-center gap-1 rounded-md border border-tone-teal/30 bg-card px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-tone-teal-soft"
                  >
                    <Tag className="size-3 text-tone-teal" />
                    <span>{promo.name}</span>
                    <span className="num text-[10px] font-semibold text-tone-teal">
                      ({promo.type === "percent" ? `-${promo.value}%` : `-${formatIDR(promo.value)}/unit`})
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div
            ref={linesRef}
            role="region"
            aria-label="Daftar item keranjang; gulir untuk melihat semua item"
            tabIndex={0}
            onScroll={(event) => {
              const next = event.currentTarget.scrollTop > 4;
              setLinesScrolled((current) => (current === next ? current : next));
            }}
            className={cn(
              "min-h-0 flex-1 overscroll-contain bg-[var(--pos-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]",
              scrollMode === "page" ? "overflow-visible" : "pos-cart-lines overflow-y-auto",
              linesScrolled && "pos-cart-lines-scrolled",
            )}
          >
            {cart.length === 0 ? (
              <div className="flex h-full min-h-[160px] flex-col items-center justify-center border-b border-[var(--pos-border-strong)] bg-[var(--pos-tray)] px-4 py-10 text-center">
                <span className="grid size-12 place-items-center rounded-full border border-[var(--pos-border-strong)] bg-[var(--pos-panel)]">
                  <ShoppingCart className="size-6 text-[var(--pos-muted)]" />
                </span>
                <p className="mt-3 max-w-[240px] text-sm font-medium text-[var(--pos-muted)]">
                  Scan barcode atau pilih produk untuk mulai.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {cart.map((item) => {
                  const key = cartLineKey(item);
                  const line = quoteLine(item.productId, item.packagingId);
                  const cached = cache[item.productId];
                  // S4: baris berkemasan — harga tampil PER KEMASAN
                  // (harga quote per satuan dasar × faktor cuplikan),
                  // qty & stok dinilai dalam satuan dasar.
                  const pack = item.packagingId
                    ? (cached?.packagings?.find((row) => row.id === item.packagingId) ?? null)
                    : null;
                  const isi = line ? Number(line.isiSnapshot) : cartLineIsi(item, cached);
                  const baseQty = item.qty * isi;
                  const unitPriceShown = line ? line.unitPrice * isi : Number(cached?.salePrice ?? 0);
                  const price = line
                    ? line.groupUnitPrice * isi
                    : pack
                      ? pack.salePrice != null
                        ? Number(pack.salePrice)
                        : Number(cached?.salePrice ?? 0) * isi
                      : Number(cached?.salePrice ?? 0);
                  const stock = line?.stock ?? cached?.stock ?? 0;
                  const tracked = line?.trackStock ?? cached?.trackStock ?? true;
                  const unitName = pack?.name ?? line?.packagingName ?? cached?.unitCode ?? "PCS";
                  return (
                    <li key={key} className="px-3 py-3 transition-colors hover:bg-[var(--pos-tray)]">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="line-clamp-2 text-[15px] font-semibold leading-snug">{line?.name ?? cached?.name ?? "Produk"}</p>
                          <p className="num mt-0.5 text-xs text-muted-foreground">
                            {line?.sku ?? cached?.sku} · {formatIDR(price)}
                            {pack ? <span> / {pack.name}</span> : null}
                            {line && line.unitPrice > line.groupUnitPrice ? (
                              <span className="ml-1 line-through opacity-60">{formatIDR(unitPriceShown)}</span>
                            ) : null}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {setLineDiscount ? (
                            <button
                              type="button"
                              onClick={() => {
                                if (discountTargetKey === key) {
                                  setDiscountTargetKey(null);
                                } else {
                                  setDiscountTargetKey(key);
                                  setLineDiscType(item.discountType ?? "percent");
                                  setLineDiscVal(item.discountValue ? String(item.discountValue) : "");
                                }
                              }}
                              aria-expanded={discountTargetKey === key}
                              aria-label={
                                item.discountType && (item.discountValue ?? 0) > 0
                                  ? `Ubah diskon ${line?.name ?? cached?.name ?? "item"}`
                                  : `Tambah diskon ${line?.name ?? cached?.name ?? "item"}`
                              }
                              title={
                                item.discountType && (item.discountValue ?? 0) > 0
                                  ? "Ubah diskon item"
                                  : "Tambah diskon item"
                              }
                              className={cn(
                                "grid size-11 place-items-center rounded-md hover:bg-tone-plum-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                item.discountType && (item.discountValue ?? 0) > 0
                                  ? "text-tone-plum"
                                  : "text-muted-foreground",
                              )}
                            >
                              <Tag className="size-4" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => setQty(key, 0)}
                            className="grid size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Hapus ${line?.name ?? cached?.name ?? "item"} dari keranjang`}
                          >
                            <X className="size-4" />
                          </button>
                        </div>
                      </div>

                      {/* S4: pemilih satuan baris — hanya untuk produk
                          berkemasan; mengganti satuan me-reset qty ke
                          1 satuan baru (ditegakkan di setLinePackaging). */}
                      {(cached?.packagings?.length ?? 0) > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <label className="text-xs font-semibold text-foreground">
                            Satuan
                          </label>
                          <select
                            value={item.packagingId ?? ""}
                            onChange={(event) =>
                              setLinePackaging(key, event.target.value || null)
                            }
                            aria-label={`Satuan ${line?.name ?? cached?.name ?? "produk"}`}
                            className="h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                          >
                            <option value="">{cached?.unitCode ?? "PCS"} (satuan dasar)</option>
                            {cached!.packagings!.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} (isi {formatQty(option.isi)})
                              </option>
                            ))}
                          </select>
                          {pack ? (
                            <span className="num text-xs text-muted-foreground">
                              = {formatQty(baseQty)} {cached?.unitCode ?? "PCS"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        {/* A-26 Q9 (K-11): stepper qty adalah target sentuh
                            primer kasir — tombol visual 36px dengan area
                            sentuh efektif 44x44px lewat after:-inset-1
                            (pola area sentuh checkbox/switch). Tombol
                            Hapus di atas baris ini juga diperluas area
                            sentuhnya ke 44px tanpa mengubah visualnya. */}
                        <div className="flex shrink-0 items-center overflow-hidden rounded-lg border border-[var(--pos-border-strong)] bg-[var(--pos-panel)]">
                          <button
                            type="button"
                            onClick={() => setQty(key, item.qty - 1)}
                            className="grid size-11 place-items-center text-[var(--pos-ink)] hover:bg-[var(--pos-tray)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)]"
                            aria-label={`Kurangi jumlah ${line?.name ?? cached?.name ?? "item"}`}
                          >
                            <Minus className="size-4" />
                          </button>
                          {/* G2 (FRM-03): QtyInput bersama di dalam
                              stepper — semantik setQty tetap: nilai
                              diserahkan sebagai number, kosong = 0
                              (baris terhapus oleh setCartLineQty,
                              sama seperti Number("") || 0 lama). */}
                          <QtyInput
                            value={String(item.qty)}
                            onChange={(value) => setQty(key, value === "" ? 0 : Number(value))}
                            decimals={line?.trackSerial ?? cached?.trackSerial ? 0 : undefined}
                            aria-label={`Jumlah ${unitName}`}
                            wrapperClassName="h-11 w-12 shrink-0"
                            className="h-11 w-full rounded-none border-x border-y-0 border-[var(--pos-border-strong)] bg-transparent px-0 text-center text-sm font-bold text-[var(--pos-ink)] focus:border-[var(--pos-action)]"
                          />
                          <button
                            type="button"
                            onClick={() => setQty(key, item.qty + 1)}
                            disabled={!allowNegativeStock && tracked && baseQty >= stock}
                            className="grid size-11 place-items-center text-[var(--pos-ink)] hover:bg-[var(--pos-tray)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pos-gold)] disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Tambah jumlah ${line?.name ?? cached?.name ?? "item"}`}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                        <div className="flex justify-end">
                          <div className="text-right">
                            <span className="block text-xs font-semibold uppercase tracking-wide text-[var(--pos-muted)]">
                              Total
                            </span>
                            <span className="num text-lg font-extrabold leading-tight text-[var(--pos-ink)]">
                              {/* lineTotal sudah termasuk pajak (POS-RCPT-01) */}
                              {formatIDR(line ? line.lineTotal : price * item.qty)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {discountTargetKey === key ? (
                        <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-surface-alt)] p-2">
                          <select
                            value={lineDiscType}
                            onChange={(e) => setLineDiscType(e.target.value as "percent" | "nominal")}
                            className="h-11 rounded border border-[var(--pos-border-strong)] bg-background px-2 text-[12px] font-medium"
                          >
                            <option value="percent">% Persen</option>
                            <option value="nominal">Rp Nominal</option>
                          </select>
                          <input
                            type="number"
                            min="0"
                            max={lineDiscType === "percent" ? 100 : undefined}
                            value={lineDiscVal}
                            onChange={(e) => setLineDiscVal(e.target.value)}
                            placeholder={lineDiscType === "percent" ? "Diskon %" : "Nominal Rp"}
                            className="num h-11 w-24 rounded border border-[var(--pos-border-strong)] bg-background px-2 text-[12px]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const val = Number(lineDiscVal) || 0;
                              if (val > 0) {
                                setLineDiscount?.(key, lineDiscType, val);
                              } else {
                                setLineDiscount?.(key, null, 0);
                              }
                              setDiscountTargetKey(null);
                            }}
                            className="h-11 rounded bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
                          >
                            Simpan
                          </button>
                          <button
                            type="button"
                            onClick={() => setDiscountTargetKey(null)}
                            className="h-11 rounded px-2 text-[12px] text-muted-foreground hover:bg-muted"
                          >
                            Batal
                          </button>
                        </div>
                      ) : null}

                      {/* FIX-POS Tahap 4 (POS2-06): qty melewati stok
                          diperingatkan SEGERA di baris — bukan baru
                          gagal di checkout. Tombol + juga berhenti di
                          stok tersedia untuk produk terlacak.
                          S4: yang dinilai adalah qty SATUAN DASAR. */}
                      {tracked && baseQty > stock && !allowNegativeStock ? (
                        <p className="mt-2 flex items-center gap-2 text-xs text-destructive">
                          <AlertTriangle className="size-4 shrink-0" />
                          {stock <= 0
                            ? `Stok tercatat ${formatQty(stock)}`
                            : `Melebihi stok tersedia (${formatQty(stock)}) — kurangi jumlah; checkout akan ditolak`}
                        </p>
                      ) : null}

                      {(line?.trackSerial ?? cached?.trackSerial) ? (
                        <div className="mt-2 space-y-2">
                          {baseQty <= 3 ? (
                            Array.from({ length: Math.max(0, Math.floor(baseQty)) }, (_, serialIndex) => (
                              <input
                                key={serialIndex}
                                value={item.serialNumbers?.[serialIndex] ?? ""}
                                onChange={(event) => setSerial(key, serialIndex, event.target.value)}
                                placeholder={`Nomor seri unit ${serialIndex + 1} *`}
                                aria-label={`Nomor seri unit ${serialIndex + 1} ${line?.name ?? cached?.name ?? ""}`}
                                className="num h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                              />
                            ))
                          ) : (
                            <div className="rounded-md border border-[var(--pos-border-strong)] bg-[var(--pos-surface-alt)] p-2.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium">
                                  Nomor Seri ({((item.serialNumbers ?? []).filter((s) => s.trim().length > 0)).length} / {Math.floor(baseQty)} terisi)
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setBulkSerialKey(key);
                                    setBulkSerialText((item.serialNumbers ?? []).join("\n"));
                                  }}
                                  className="rounded bg-primary/10 px-2 py-1 font-semibold text-primary hover:bg-primary/20"
                                >
                                  Kelola Seri ({Math.floor(baseQty)} unit)
                                </button>
                              </div>
                              {((item.serialNumbers ?? []).filter((s) => s.trim().length > 0)).length < Math.floor(baseQty) ? (
                                <p className="mt-1 text-[11px] text-destructive">
                                  Wajib mengisi semua nomor seri sebelum pembayaran.
                                </p>
                              ) : null}
                            </div>
                          )}
                          <p className="text-xs leading-4 text-muted-foreground">
                            Produk bernomor seri — isi seri yang tersedia untuk setiap unit sebelum membayar.
                          </p>
                        </div>
                      ) : null}

                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {footer ? <div className="shrink-0">{footer}</div> : null}

          <Dialog open={summaryOpen} onOpenChange={setSummaryOpen}>
            <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>Rincian transaksi</DialogTitle>
                <DialogDescription>
                  {cart.length} baris · {formatIDR(total)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                {hasBreakdown ? (
                  <Row label="Subtotal" value={formatIDR(quote?.subtotal ?? 0)} />
                ) : null}
                {(quote?.discountTotal ?? 0) > 0 ? (
                  <Row label="Diskon" value={`−${formatIDR(quote?.discountTotal ?? 0)}`} tone="plum" />
                ) : null}
                {(quote?.taxTotal ?? 0) > 0 ? (
                  <Row label="termasuk PPN" value={formatIDR(quote?.taxTotal ?? 0)} />
                ) : null}
                {(quote?.roundingAdjustment ?? 0) !== 0 ? (
                  <Row
                    label={`Pembulatan total (${roundingLabel(quote?.cashRounding)})`}
                    value={`${(quote?.roundingAdjustment ?? 0) > 0 ? "+" : "−"}${formatIDR(Math.abs(quote?.roundingAdjustment ?? 0))}`}
                  />
                ) : null}
                <div className="flex items-end justify-between gap-3 border-t border-[var(--pos-border-strong)] pt-2.5">
                  <span className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--pos-muted)]">
                    Total
                  </span>
                  <span className="num text-2xl font-extrabold tracking-tight text-[var(--pos-action)]">
                    {formatIDR(total)}
                  </span>
                </div>
                {heldTotal !== null && Math.abs(total - heldTotal) > 0.01 ? (
                  <p className="rounded-md bg-tone-amber-soft p-2 text-xs leading-4 text-tone-amber">
                    Total berbeda dari {formatIDR(heldTotal)} saat ditahan karena penyesuaian harga atau diskon terkini.
                  </p>
                ) : null}
                {quoteBusy && cart.length > 0 ? (
                  <p className="text-right text-xs text-[var(--pos-muted)]">Menghitung total…</p>
                ) : null}
              </div>
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            open={confirmClearCart}
            title="Kosongkan Keranjang?"
            description={`Ada ${cart.length} item di dalam keranjang transaksi. Seluruh item yang telah dimasukkan akan dihapus.`}
            confirmLabel="Ya, Kosongkan"
            cancelLabel="Batal"
            danger
            onConfirm={() => {
              if (onClearCart) onClearCart();
              else setCart([]);
              setConfirmClearCart(false);
            }}
            onCancel={() => setConfirmClearCart(false)}
          />

          {bulkSerialKey ? (
            <Dialog open={true} onOpenChange={(open) => !open && setBulkSerialKey(null)}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Input Nomor Seri Massal</DialogTitle>
                  <DialogDescription>
                    Tempel atau scan nomor seri (satu seri per baris). Sistem akan memetakan seri berurutan per unit.
                  </DialogDescription>
                </DialogHeader>
                <textarea
                  value={bulkSerialText}
                  onChange={(e) => setBulkSerialText(e.target.value)}
                  rows={8}
                  placeholder="Contoh:&#10;SN10001&#10;SN10002&#10;SN10003"
                  className="mt-2 w-full rounded-md border border-input bg-background p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Terdeteksi:{" "}
                    <strong className="num text-foreground">
                      {bulkSerialText.split(/\r?\n/).filter((s) => s.trim().length > 0).length}
                    </strong>{" "}
                    nomor seri
                  </span>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setBulkSerialKey(null)}
                    className="rounded-md border border-[var(--pos-border-strong)] px-3 py-1.5 text-xs font-semibold hover:bg-muted"
                  >
                    Batal
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const targetItem = cart.find((c) => cartLineKey(c) === bulkSerialKey);
                      const needed = targetItem
                        ? Math.floor(cartLineBaseQty(targetItem, cache[targetItem.productId]))
                        : 0;
                      const lines = bulkSerialText
                        .split(/\r?\n/)
                        .map((s) => s.trim())
                        .filter((s) => s.length > 0);
                      for (let i = 0; i < needed; i++) {
                        setSerial(bulkSerialKey, i, lines[i] ?? "");
                      }
                      setBulkSerialKey(null);
                    }}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
                  >
                    Simpan Nomor Seri
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          ) : null}
        </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "plum" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[var(--pos-muted)]">{label}</span>
      <span className={cn("num", tone === "plum" && "font-semibold text-tone-plum")}>{value}</span>
    </div>
  );
}

function roundingLabel(rounding: { step: number; direction: string } | null | undefined): string {
  if (!rounding || rounding.step <= 0) return "tanpa pembulatan";
  const amount = rounding.step.toLocaleString("id-ID");
  const direction =
    rounding.direction === "up" ? "ke atas" : rounding.direction === "down" ? "ke bawah" : "terdekat";
  return `${direction} ${amount}`;
}
