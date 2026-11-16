import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  AlertTriangle,
  Minus,
  PauseCircle,
  Plus,
  ShoppingCart,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatIDR, formatQty } from "@/lib/money";
import type { QuoteResultPublic } from "@/server/pos";
import { QtyInput } from "@/components/qty-input";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import {
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
// pemilih kelompok harga, daftar baris (qty/seri/diskon), dan total;
// JSX dipindah apa adanya dari PosTerminal. State `discountFor` hanya
// hidup di panel ini, jadi ikut berpindah ke dalamnya.
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
  /** S4: penyunting berkunci baris (produk, kemasan) — lihat cartLineKey. */
  setQty: (key: string, qty: number) => void;
  setSerial: (key: string, index: number, value: string) => void;
  setDiscount: (key: string, type: "percent" | "nominal" | null, value: number) => void;
  setLinePackaging: (key: string, packagingId: string | null) => void;
  quoteBusy: boolean;
  allowNegativeStock?: boolean;
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
    setQty,
    setSerial,
    setDiscount,
    setLinePackaging,
    quoteBusy,
    allowNegativeStock = false,
  } = props;
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  return (
        <div className="rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div className="flex items-center gap-2">
              <ShoppingCart className="size-4 text-muted-foreground" />
              <h2 className="text-[13px] font-semibold">Keranjang</h2>
              <span className="num rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {cart.length} baris
              </span>
            </div>
            <div className="flex items-center gap-1">
              {heldCount > 0 ? (
                <a
                  href="/app/pos/ditahan"
                  aria-label={`Lihat ${heldCount} pesanan ditahan`}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted"
                >
                  <PauseCircle className="size-3.5" /> {heldCount}
                </a>
              ) : null}
              {cart.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setConfirmClearCart(true)}
                  className="rounded px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  Kosongkan
                </button>
              ) : null}
            </div>
          </div>

          <div className="border-b border-border px-3 py-2">
            <div className="flex items-center gap-2">
              <label className="flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <UserRound className="size-3" /> Harga
              </label>
              <select
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[12px]"
                aria-label="Kelompok harga"
              >
                <option value="">Harga normal (tanpa kelompok)</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
            {selectedGroup ? (
              <p className="mt-1 text-[10px] text-tone-teal">
                Harga kelompok aktif · pembulatan {selectedGroup.roundingStep.toLocaleString("id-ID")}
                {selectedGroup.roundingDirection === "down"
                  ? " ke bawah"
                  : selectedGroup.roundingDirection === "up"
                    ? " ke atas"
                    : " terdekat"}
                {selectedGroup.roundCashTotal ? " · total tunai dibulatkan" : ""}
              </p>
            ) : null}
          </div>

          <div className="max-h-[42vh] min-h-[120px] overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
                <ShoppingCart className="size-6 text-muted-foreground/60" />
                <p className="mt-2 text-[12px] text-muted-foreground">
                  Scan barcode atau pilih produk untuk mulai.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70">
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
                    <li key={key} className="px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium">{line?.name ?? cached?.name ?? "Produk"}</p>
                          <p className="num text-[11px] text-muted-foreground">
                            {line?.sku ?? cached?.sku} · {formatIDR(price)}
                            {pack ? <span> / {pack.name}</span> : null}
                            {line && line.unitPrice > line.groupUnitPrice ? (
                              <span className="ml-1 line-through opacity-60">{formatIDR(unitPriceShown)}</span>
                            ) : null}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setQty(key, 0)}
                          className="relative rounded p-1 text-muted-foreground after:absolute after:-inset-[11px] hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`Hapus ${line?.name ?? cached?.name ?? "item"} dari keranjang`}
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>

                      {/* S4: pemilih satuan baris — hanya untuk produk
                          berkemasan; mengganti satuan me-reset qty ke
                          1 satuan baru (ditegakkan di setLinePackaging). */}
                      {(cached?.packagings?.length ?? 0) > 0 ? (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Satuan
                          </label>
                          <select
                            value={item.packagingId ?? ""}
                            onChange={(event) =>
                              setLinePackaging(key, event.target.value || null)
                            }
                            aria-label={`Satuan ${line?.name ?? cached?.name ?? "produk"}`}
                            className="h-7 rounded border border-input bg-background px-1 text-[11px]"
                          >
                            <option value="">{cached?.unitCode ?? "PCS"} (satuan dasar)</option>
                            {cached!.packagings!.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name} (isi {formatQty(option.isi)})
                              </option>
                            ))}
                          </select>
                          {pack ? (
                            <span className="num text-[10px] text-muted-foreground">
                              = {formatQty(baseQty)} {cached?.unitCode ?? "PCS"}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        {/* A-26 Q9 (K-11): stepper qty adalah target sentuh
                            primer kasir — tombol visual 36px dengan area
                            sentuh efektif 44x44px lewat after:-inset-1
                            (pola area sentuh checkbox/switch). Tombol
                            Hapus di atas baris ini juga diperluas area
                            sentuhnya ke 44px tanpa mengubah visualnya. */}
                        <div className="flex items-center rounded-md border border-border">
                          <button
                            type="button"
                            onClick={() => setQty(key, item.qty - 1)}
                            className="relative grid size-9 place-items-center after:absolute after:-inset-1 hover:bg-muted"
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
                            aria-label={`Jumlah ${unitName}`}
                            wrapperClassName="w-10 shrink-0"
                            className="w-full rounded-none border-x border-y-0 border-border bg-transparent px-0 text-center text-[13px] focus:border-border"
                          />
                          <button
                            type="button"
                            onClick={() => setQty(key, item.qty + 1)}
                            disabled={!allowNegativeStock && tracked && baseQty >= stock}
                            className="relative grid size-9 place-items-center after:absolute after:-inset-1 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Tambah jumlah ${line?.name ?? cached?.name ?? "item"}`}
                          >
                            <Plus className="size-4" />
                          </button>
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            type="button"
                            onClick={() => setDiscountFor(discountFor === key ? null : key)}
                            className={cn(
                              "rounded px-1.5 py-0.5 text-[10px]",
                              line && line.discountAmount > 0
                                ? "bg-tone-plum-soft text-tone-plum"
                                : "text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {line && line.discountAmount > 0 ? `Diskon −${formatIDR(line.discountAmount)}` : "Diskon"}
                          </button>
                          <div className="text-right">
                            <span className="block text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Total
                            </span>
                            <span className="num text-[14px] font-semibold leading-tight">
                              {/* lineTotal sudah termasuk pajak (POS-RCPT-01) */}
                              {formatIDR(line ? line.lineTotal : price * item.qty)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* FIX-POS Tahap 4 (POS2-06): qty melewati stok
                          diperingatkan SEGERA di baris — bukan baru
                          gagal di checkout. Tombol + juga berhenti di
                          stok tersedia untuk produk terlacak.
                          S4: yang dinilai adalah qty SATUAN DASAR. */}
                      {tracked && baseQty > stock ? (
                        allowNegativeStock ? (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="size-3" />
                            {stock <= 0
                              ? `Stok tercatat ${formatQty(stock)} (penjualan minus diizinkan)`
                              : `Melebihi stok tercatat (${formatQty(stock)}) — stok akan menjadi minus`}
                          </p>
                        ) : (
                          <p className="mt-1 flex items-center gap-1 text-[11px] text-destructive">
                            <AlertTriangle className="size-3" />
                            {stock <= 0
                              ? `Stok tercatat ${formatQty(stock)}`
                              : `Melebihi stok tersedia (${formatQty(stock)}) — kurangi jumlah; checkout akan ditolak`}
                          </p>
                        )
                      ) : null}

                      {(line?.trackSerial ?? cached?.trackSerial) ? (
                        <div className="mt-1.5 space-y-1">
                          {Array.from({ length: Math.max(0, Math.floor(baseQty)) }, (_, serialIndex) => (
                            <input
                              key={serialIndex}
                              value={item.serialNumbers?.[serialIndex] ?? ""}
                              onChange={(event) => setSerial(key, serialIndex, event.target.value)}
                              placeholder={`Nomor seri unit ${serialIndex + 1} *`}
                              aria-label={`Nomor seri unit ${serialIndex + 1} ${line?.name ?? cached?.name ?? ""}`}
                              className="num h-6 w-full rounded border border-input bg-background px-1.5 text-[11px]"
                            />
                          ))}
                          <p className="text-[10px] text-muted-foreground">
                            Produk bernomor seri — isi seri yang tersedia untuk setiap unit sebelum membayar.
                          </p>
                        </div>
                      ) : null}

                      {discountFor === key ? (
                        <div className="mt-2 flex items-center gap-1.5 rounded-md bg-muted/60 p-1.5">
                          <select
                            value={item.discountType ?? "percent"}
                            aria-label={`Jenis diskon ${line?.name ?? cached?.name ?? "produk"}`}
                            onChange={(event) =>
                              setDiscount(
                                key,
                                event.target.value as "percent" | "nominal",
                                item.discountValue ?? 0,
                              )
                            }
                            className="h-9 rounded border border-input bg-background px-1 text-[11px]"
                          >
                            <option value="percent">%</option>
                            <option value="nominal">Rp / unit</option>
                          </select>
                          <input
                            value={item.discountValue ?? ""}
                            aria-label={`Nilai diskon ${line?.name ?? cached?.name ?? "produk"}`}
                            onChange={(event) =>
                              setDiscount(
                                key,
                                item.discountType ?? "percent",
                                Number(event.target.value) || 0,
                              )
                            }
                            inputMode="decimal"
                            placeholder="0"
                            className="num h-9 w-20 rounded border border-input bg-background px-1.5 text-right text-[11px]"
                          />
                          <button
                            type="button"
                            onClick={() => setDiscount(key, null, 0)}
                            className="ml-auto rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-background"
                          >
                            Hapus
                          </button>
                          {line && line.groupDiscountAmount > 0 ? (
                            <p className="text-[10px] text-tone-plum">
                              Diskon grup: −{formatIDR(line.groupDiscountAmount)}
                            </p>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-1.5 border-t border-border px-3 py-2.5 text-[12px]">
            {heldTotal !== null && quote && Math.abs(quote.total - heldTotal) > 0.005 ? (
              <p className="flex items-start gap-1.5 rounded-md bg-tone-amber-soft px-2 py-1.5 text-[11px] leading-4 text-tone-amber">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  Total berubah sejak pesanan ditahan: {formatIDR(heldTotal)} →{" "}
                  {formatIDR(quote.total)}. Harga dan diskon terkini yang berlaku.
                </span>
              </p>
            ) : null}
            <Row label="Subtotal" value={formatIDR(quote?.subtotal ?? 0)} />
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
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-[13px] font-semibold">Total</span>
              <span className="num text-xl font-semibold">{formatIDR(total)}</span>
            </div>
            {/* POS2-01/22: status perhitungan adalah informasi
                operasional — 11px, dan tampil juga saat quote basi
                sedang dihitung ulang (quotePending). */}
            {quoteBusy && cart.length > 0 ? (
              <p className="text-right text-[11px] text-muted-foreground">Menghitung…</p>
            ) : null}
          </div>

          <ConfirmDialog
            open={confirmClearCart}
            title="Kosongkan Keranjang?"
            description={`Ada ${cart.length} item di dalam keranjang transaksi. Seluruh item yang telah dimasukkan akan dihapus.`}
            confirmLabel="Ya, Kosongkan"
            cancelLabel="Batal"
            danger
            onConfirm={() => {
              setCart([]);
              setConfirmClearCart(false);
            }}
            onCancel={() => setConfirmClearCart(false)}
          />
        </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "plum" }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("num", tone === "plum" ? "text-tone-plum" : "")}>{value}</span>
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
