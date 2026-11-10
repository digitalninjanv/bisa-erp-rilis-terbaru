"use client";

import { Fragment, useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";
import { d, formatIDR, formatQty, receiptLineDiscount, toDb } from "@/lib/money";
import { formatMargin, marginPercent, marginToneClass, marginToneDot } from "@/lib/margin";
import { MarginPopover } from "@/components/gudang/margin-popover";
import { productsStockAction } from "@/server/actions/inventory/produk";
import { ProductPicker, type PickedPackaging } from "@/components/gudang/product-picker";
import { DateField } from "@/components/date-field";
import { MoneyInput } from "@/components/money-input";
import { QtyInput } from "@/components/qty-input";

export type DocLine = {
  productId: string;
  name: string;
  sku: string;
  qty: string;
  unitCost: string;
  /** Harga jual per satuan masukan (kemasan bila packagingId terisi). */
  salePrice?: string;
  /** Diskon baris penerimaan: percent = % bruto; nominal = total potongan. */
  discountType?: "percent" | "nominal";
  discountValue?: string;
  systemQty?: number;
  stock?: number;
  // Batch identity (G8/D-7); only meaningful in receipt mode for products
  // flagged trackBatch.
  trackBatch?: boolean;
  batchNumber?: string;
  expiryDate?: string;
  // Serial identity (SIM-2 S7B-2); receipt mode only — one serial per
  // line/comma in the textarea, count must equal qty (domain enforces).
  trackSerial?: boolean;
  serialNumbersText?: string;
  // Satuan kemasan (S2 receipt; S3 transfer & penyesuaian). Mode
  // receipt: bila packagingId terisi, qty & unitCost baris adalah PER
  // KEMASAN. Mode transfer/penyesuaian: hanya qty yang per kemasan —
  // unitCost tetap per SATUAN DASAR. Kosong = satuan dasar.
  // baseUnitCost = harga satuan dasar produk saat baris dibuat
  // (isian awal saat berpindah satuan, mode receipt).
  packagings?: PickedPackaging[];
  packagingId?: string;
  baseUnitCost?: string;
  /** Harga jual satuan dasar saat baris dibuat (untuk kembali dari kemasan). */
  baseSalePrice?: string;
};

/** Qty baris dalam SATUAN DASAR (qty masukan × isi kemasan terpilih). */
export function docLineBaseQty(line: DocLine) {
  const pack = line.packagings?.find((row) => row.id === line.packagingId);
  const qty = d(line.qty || 0);
  return pack ? qty.mul(d(pack.isi)) : qty;
}

/** Nilai neto baris penerimaan: qty × harga beli − diskon baris. */
export function docLineReceiptNet(line: DocLine) {
  const gross = d(line.qty || 0).mul(d(line.unitCost || 0));
  const discount = receiptLineDiscount(gross, line.discountType, line.discountValue);
  return gross.minus(discount.gt(gross) ? gross : discount);
}

/** Cara kolom stok menilai baris (GDG2-04):
 * - "out": qty adalah barang KELUAR (transfer, keluarga hapus-buku) —
 *   qty melewati stok adalah peringatan.
 * - "signed": qty bertanda (penyesuaian koreksi) — hanya arah negatif
 *   yang bisa melewati stok.
 * - "compare": stok ditampilkan sebagai pembanding saja (penerimaan
 *   menambah stok, tidak pernah ditolak karena stok). */
export type LineStockMode = "out" | "signed" | "compare";

export function LineEditor({
  lines,
  onChange,
  mode,
  warehouseId,
  stockMode,
  expectedByProduct,
  allowSalePrice = false,
  showDiscount = false,
}: {
  lines: DocLine[];
  onChange: (lines: DocLine[]) => void;
  mode: "receipt" | "adjustment" | "transfer" | "opname";
  /** Gudang acuan kolom stok; tanpa ini kolom stok tidak tampil. */
  warehouseId?: string;
  stockMode?: LineStockMode;
  /**
   * A-24 T3 (pola G2): qty yang DIMINTA per produk (sisa PO pada
   * penerimaan tertaut PO). Bila terisi, sel qty menampilkan
   * "Diminta X" + status selisih berstatus warna terhadap qty isian.
   * Murni tampilan panduan — penegakan batas tetap di server.
   */
  expectedByProduct?: Record<string, string>;
  /** Izinkan ubah harga jual master dari baris penerimaan. */
  allowSalePrice?: boolean;
  /** Tampilkan kolom diskon baris (penerimaan pembelian). */
  showDiscount?: boolean;
}) {
  const showCost = mode === "receipt" || mode === "adjustment";
  const receiptPricing = mode === "receipt" && showCost;
  const receiptDiscount = receiptPricing && showDiscount;
  const qtyLabel = mode === "opname" ? "Dihitung" : "Qty";
  const effectiveStockMode: LineStockMode =
    stockMode ?? (mode === "receipt" ? "compare" : "out");
  const showStock = Boolean(warehouseId) && mode !== "opname";
  const stockHeader =
    mode === "transfer" ? "Stok asal" : mode === "receipt" ? "Stok kini" : "Stok kini";

  // GDG2-04: isi kolom `stock` per baris dari server — sebelumnya kolom
  // ini ada di tipe tetapi tidak pernah diisi/dirender, sehingga
  // petugas mengisi qty dari ingatan dan baru tahu stok kurang dari
  // penolakan submit. Ambil ulang saat gudang atau himpunan produk
  // berubah; penggabungan diterapkan ke baris TERBARU agar ketikan qty
  // yang masuk selama pengambilan tidak tertimpa.
  const linesRef = useRef(lines);
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);
  const fetchKeyRef = useRef("");
  useEffect(() => {
    if (!warehouseId || mode === "opname") return;
    const ids = [...new Set(lines.map((line) => line.productId))];
    if (ids.length === 0) return;
    const key = `${warehouseId}:${ids.sort().join(",")}`;
    if (fetchKeyRef.current === key) return;
    fetchKeyRef.current = key;
    let cancelled = false;
    void productsStockAction({ warehouseId, productIds: ids }).then((result) => {
      if (cancelled || !result.ok) return;
      const fresh = new Map(result.data.map((row) => [row.productId, row.qty]));
      onChange(
        linesRef.current.map((line) => ({
          ...line,
          stock: fresh.get(line.productId) ?? 0,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [warehouseId, lines, mode, onChange]);

  function add(product: { id: string; name: string; sku: string; costPrice: string | null; salePrice?: string | null; trackBatch?: boolean; trackSerial?: boolean; packagings?: PickedPackaging[]; scannedPackagingId?: string | null }) {
    // R-4: in receipt mode a batch-tracked product may appear on several
    // lines (one per batch identity) — the server validates duplicates
    // per (product, batch, expiry). Everywhere else, and for untracked
    // products, one line per product stays the rule.
    const allowDuplicate = mode === "receipt" && (product.trackBatch ?? false);
    if (!allowDuplicate && lines.some((line) => line.productId === product.id)) return;
    // S2: baris produk berkemasan di mode receipt mulai dari kemasan
    // yang terpindai, atau kemasan bawaan beli produk — qty & harga
    // baris lalu berarti per kemasan (harga awal: harga beli kemasan,
    // atau taksiran isi × harga pcs; selalu dapat diedit).
    const packagings = product.packagings ?? [];
    const chosen =
      mode === "receipt"
        ? (packagings.find((row) => row.id === product.scannedPackagingId) ??
          packagings.find((row) => row.isDefaultPurchase))
        : undefined;
    onChange([
      ...lines,
      {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        qty: mode === "opname" ? "" : "1",
        // K-3: tanpa inventory.cost harga pokok master tidak sampai ke
        // klien — isian awal harga baris kosong (petugas mengisi harga
        // dokumennya sendiri); pemegang izin tak berubah perilakunya.
        unitCost: chosen
          ? (chosen.buyPrice ??
            (product.costPrice !== null ? toDb(d(product.costPrice).mul(d(chosen.isi))) : ""))
          : (product.costPrice ?? ""),
        salePrice: chosen
          ? (chosen.salePrice ??
            (product.salePrice ? toDb(d(product.salePrice).mul(d(chosen.isi))) : ""))
          : (product.salePrice ?? ""),
        systemQty: 0,
        trackBatch: product.trackBatch ?? false,
        batchNumber: "",
        expiryDate: "",
        trackSerial: product.trackSerial ?? false,
        serialNumbersText: "",
        discountType: "percent",
        discountValue: "",
        packagings,
        packagingId: chosen?.id ?? "",
        baseUnitCost: product.costPrice ?? undefined,
        baseSalePrice: product.salePrice ?? undefined,
      },
    ]);
  }

  /** S2: ganti satuan baris — pada mode receipt harga mengikuti
   * satuan baru (harga beli kemasan master, atau taksiran dari harga
   * satuan dasar baris). Mode transfer/penyesuaian (S3): harga pokok
   * tetap per satuan dasar, jadi hanya satuannya yang berganti. */
  function changePackaging(index: number, packagingId: string) {
    const line = lines[index];
    const pack = line.packagings?.find((row) => row.id === packagingId);
    if (mode !== "receipt") {
      update(index, { packagingId });
      return;
    }
    if (pack) {
      update(index, {
        packagingId,
        unitCost: pack.buyPrice ?? toDb(d(line.baseUnitCost ?? "0").mul(d(pack.isi))),
        salePrice:
          pack.salePrice ??
          (line.baseSalePrice ? toDb(d(line.baseSalePrice).mul(d(pack.isi))) : ""),
      });
    } else {
      update(index, {
        packagingId: "",
        unitCost: line.baseUnitCost ?? line.unitCost,
        salePrice: line.baseSalePrice ?? line.salePrice,
      });
    }
  }

  function update(index: number, patch: Partial<DocLine>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  /** Qty yang keluar dari gudang acuan menurut mode stok baris ini —
   * selalu SATUAN DASAR (baris berkemasan dikonversi lebih dulu). */
  function outgoingQty(line: DocLine) {
    const qty = docLineBaseQty(line);
    if (effectiveStockMode === "out") return qty;
    if (effectiveStockMode === "signed") return qty.isNegative() ? qty.negated() : d(0);
    return d(0);
  }

  /** Nilai baris untuk subtotal tampilan: mode receipt mengalikan
   * qty per kemasan × harga per kemasan; mode lain qty DASAR × harga
   * per satuan dasar (S3 — unitCost penyesuaian tidak per kemasan). */
  function lineAmount(line: DocLine) {
    if (receiptPricing) return docLineReceiptNet(line);
    return docLineBaseQty(line).mul(d(line.unitCost || 0));
  }

  return (
    <div className="space-y-2">
      <ProductPicker onPick={add} placeholder="Tambah produk ke dokumen…" scanMode />

      {lines.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">
          Belum ada baris. Cari dan pilih produk di atas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table
            className={`data-table data-table-dense ${
              mode === "receipt"
                ? receiptDiscount
                  ? "w-full min-w-[880px] table-fixed"
                  : "w-full min-w-[760px] table-fixed"
                : ""
            }`}
          >
            {mode === "receipt" ? (
              <colgroup>
                {receiptDiscount ? (
                  <>
                    <col className="w-[25%]" />
                    <col className="w-[9%]" />
                    <col className="w-[12%]" />
                    <col className="w-[15%]" />
                    <col className="w-[12%]" />
                    <col className="w-[10%]" />
                    <col className="w-[13%]" />
                    <col className="w-[4%]" />
                  </>
                ) : (
                  <>
                    <col className="w-[33%]" />
                    <col className="w-[9%]" />
                    <col className="w-[15%]" />
                    <col className="w-[15%]" />
                    <col className="w-[11%]" />
                    <col className="w-[12%]" />
                    <col className="w-[5%]" />
                  </>
                )}
              </colgroup>
            ) : null}
            <thead>
              <tr>
                <th className="text-left">Produk</th>
                {showStock && !receiptPricing ? (
                  <th className="text-right">{stockHeader}</th>
                ) : null}
                <th className="text-right">{qtyLabel}</th>
                {showCost ? (
                  <th className="text-right">{mode === "receipt" ? "Harga beli" : "Harga"}</th>
                ) : null}
                {receiptDiscount ? <th className="text-right">Diskon</th> : null}
                {receiptPricing ? <th className="text-right">Harga jual</th> : null}
                {receiptPricing ? <th className="text-right">Margin</th> : null}
                {showCost ? <th className="text-right">Subtotal</th> : null}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const exceeds =
                  showStock &&
                  line.stock !== undefined &&
                  outgoingQty(line).gt(d(line.stock));
                const expectedRaw = expectedByProduct?.[line.productId];
                const expected = expectedRaw !== undefined ? d(expectedRaw) : null;
                // S2: panduan sisa PO selalu dalam satuan dasar.
                const expectedDiff = expected ? docLineBaseQty(line).minus(expected) : null;
                // Margin mengikuti HPP efektif setelah diskon baris —
                // potongan pemasok menurunkan biaya persediaan (AVCO).
                const lineQty = d(line.qty || 0);
                const netUnitCost = lineQty.gt(0)
                  ? docLineReceiptNet(line).div(lineQty)
                  : d(line.unitCost || 0);
                const pricePct = marginPercent(netUnitCost, line.salePrice ?? "");
                const packName = line.packagingId
                  ? (line.packagings?.find((row) => row.id === line.packagingId)?.name ?? "kemasan")
                  : "satuan dasar";
                return (
                <Fragment key={mode === "receipt" ? `${line.productId}#${index}` : line.productId}>
                <tr>
                  <td className="cell-wrap">
                    <p className="max-w-[260px] truncate font-medium">{line.name}</p>
                    <p className="num text-[10px] text-muted-foreground">
                      {line.sku}
                      {mode === "receipt" && showStock
                        ? ` · stok ${line.stock === undefined ? "…" : formatQty(line.stock)}`
                        : ""}
                    </p>
                    {mode !== "opname" && line.packagings && line.packagings.length > 0 ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <select
                          value={line.packagingId ?? ""}
                          onChange={(event) => changePackaging(index, event.target.value)}
                          aria-label={`Satuan baris ${line.name}`}
                          className="h-9 rounded border border-input bg-background px-1.5 text-[11px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        >
                          <option value="">Satuan dasar</option>
                          {line.packagings.map((pack) => (
                            <option key={pack.id} value={pack.id}>
                              {pack.name} · isi {formatQty(pack.isi)}
                            </option>
                          ))}
                        </select>
                        {line.packagingId ? (
                          <span className="num text-[10px] text-muted-foreground">
                            = {formatQty(docLineBaseQty(line))} satuan
                            {mode === "receipt" &&
                            docLineBaseQty(line).gt(0) &&
                            docLineReceiptNet(line).gt(0)
                              ? ` · HPP ${formatIDR(
                                  docLineReceiptNet(line).div(docLineBaseQty(line)),
                                )}/satuan`
                              : ""}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {mode === "receipt" && line.trackBatch ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <input
                          value={line.batchNumber ?? ""}
                          onChange={(event) => update(index, { batchNumber: event.target.value })}
                          placeholder="Nomor batch *"
                          aria-label={`Nomor batch ${line.name}`}
                          className="h-9 w-32 rounded border border-input bg-background px-1.5 text-[11px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <DateField
                          value={line.expiryDate ?? ""}
                          onChange={(value) => update(index, { expiryDate: value })}
                          aria-label={`Tanggal kedaluwarsa ${line.name}`}
                          className="h-9 w-32 px-1.5 text-[11px]"
                        />
                        <span className="text-[10px] text-muted-foreground">Batch dilacak — nomor wajib, kedaluwarsa opsional.</span>
                      </div>
                    ) : null}
                    {mode === "receipt" && line.trackSerial ? (
                      <div className="mt-1.5">
                        <textarea
                          value={line.serialNumbersText ?? ""}
                          onChange={(event) => update(index, { serialNumbersText: event.target.value })}
                          placeholder={"Nomor seri — satu per baris\nSN-001\nSN-002"}
                          aria-label={`Nomor seri ${line.name}`}
                          rows={2}
                          className="num w-56 rounded border border-input bg-background px-1.5 py-1 text-[11px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
                        />
                        <span className="block text-[10px] text-muted-foreground">
                          Seri dilacak — jumlah nomor seri harus persis qty satuan dasar ({formatQty(docLineBaseQty(line))}).
                        </span>
                      </div>
                    ) : null}
                  </td>
                  {showStock && !receiptPricing ? (
                    <td className="num text-right text-muted-foreground">
                      {line.stock === undefined ? "…" : formatQty(line.stock)}
                    </td>
                  ) : null}
                  <td>
                    {/* G2 (FRM-03): QtyInput bersama menggantikan input
                        mentah — nilai state tetap string kanonis yang
                        sama; parse/jepit kini terpusat. */}
                    <QtyInput
                      value={line.qty}
                      onChange={(value) => update(index, { qty: value })}
                      placeholder="0"
                      aria-label={`Qty ${line.name}`}
                      wrapperClassName="w-full"
                      className={`w-full rounded px-1.5 focus:ring-2 focus:ring-ring/20 ${
                        exceeds ? "border-tone-amber" : ""
                      }`}
                    />
                    {exceeds ? (
                      <p className="mt-1 max-w-[150px] text-right text-[10px] font-medium leading-4 text-tone-amber">
                        Melebihi stok tersedia ({formatQty(line.stock ?? 0)})
                      </p>
                    ) : null}
                    {expected && expectedDiff ? (
                      <p className="mt-1 max-w-[150px] text-right text-[10px] leading-4">
                        <span className="text-muted-foreground">
                          Diminta {formatQty(expected)} ·{" "}
                        </span>
                        {expectedDiff.eq(0) ? (
                          <span className="font-semibold text-tone-green">Pas</span>
                        ) : expectedDiff.lt(0) ? (
                          <span className="font-semibold text-tone-amber">
                            Kurang {formatQty(expectedDiff.negated())}
                          </span>
                        ) : (
                          <span className="font-semibold text-destructive">
                            Lebih {formatQty(expectedDiff)}
                          </span>
                        )}
                      </p>
                    ) : null}
                  </td>
                  {showCost ? (
                    <td className="align-middle">
                      {/* A-24 T1 (SIS-07): harga pokok memakai MoneyInput
                          bersama (dulu input mentah menampilkan
                          "5200.0000"). Nilai kanonis & posting tetap
                          string desimal yang sama. */}
                      <MoneyInput
                        value={line.unitCost}
                        onChange={(value) => update(index, { unitCost: value })}
                        aria-label={`Harga pokok ${line.name}`}
                        className="h-9 w-full px-2 text-[12px]"
                      />
                    </td>
                  ) : null}
                  {receiptDiscount ? (
                    <td className="align-middle">
                      <div className="flex items-center gap-1">
                        <select
                          value={line.discountType ?? "percent"}
                          onChange={(event) =>
                            update(index, {
                              discountType: event.target.value as "percent" | "nominal",
                            })
                          }
                          aria-label={`Jenis diskon ${line.name}`}
                          title="Jenis diskon: % atau Rp"
                          className="h-9 w-11 shrink-0 rounded-md border border-input bg-background px-1 text-[11px] outline-none focus:border-ring"
                        >
                          <option value="percent">%</option>
                          <option value="nominal">Rp</option>
                        </select>
                        <div className="min-w-0 flex-1">
                          <MoneyInput
                            value={line.discountValue ?? ""}
                            onChange={(value) => update(index, { discountValue: value })}
                            aria-label={`Diskon ${line.name}`}
                            placeholder="0"
                            className="h-9 px-2 text-[12px]"
                          />
                        </div>
                      </div>
                    </td>
                  ) : null}
                  {receiptPricing ? (
                    <td className="align-middle">
                      {allowSalePrice ? (
                        <MoneyInput
                          value={line.salePrice ?? ""}
                          onChange={(value) => update(index, { salePrice: value })}
                          aria-label={`Harga jual ${line.name}`}
                          className="h-9 w-full px-2 text-[12px]"
                        />
                      ) : (
                        <span className="num block text-right text-[12px] font-medium">
                          {formatIDR(line.salePrice ?? 0)}
                        </span>
                      )}
                    </td>
                  ) : null}
                  {receiptPricing ? (
                    <td className="align-middle">
                      <div className="flex items-center justify-end gap-1">
                        <span
                          aria-hidden
                          className={`size-1.5 shrink-0 rounded-full ${marginToneDot(pricePct)}`}
                        />
                        <span className={`num text-[11px] font-medium ${marginToneClass(pricePct)}`}>
                          {formatMargin(pricePct)}
                        </span>
                        {allowSalePrice ? (
                          <MarginPopover
                            cost={toDb(netUnitCost)}
                            salePrice={line.salePrice ?? ""}
                            unitLabel={packName}
                            onApply={(value) => update(index, { salePrice: value })}
                          />
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                  {showCost ? (
                    <td className="num text-right">
                      {/* GDG2-21: subtotal tampilan memakai Decimal yang
                          sama dengan server — aritmetika Number JS bisa
                          berbeda satu-dua rupiah dari total dokumen. */}
                      {formatIDR(lineAmount(line))}
                    </td>
                  ) : null}
                  <td>
                    <button
                      type="button"
                      onClick={() => onChange(lines.filter((_, i) => i !== index))}
                      className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Hapus ${line.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
                </Fragment>
                );
              })}
            </tbody>
            {showCost ? (
              <tfoot>
                <tr className="border-t border-border bg-muted/40">
                  <td colSpan={receiptDiscount ? 6 : receiptPricing ? 5 : showStock ? 4 : 3} className="text-right text-[10px] uppercase tracking-wide text-muted-foreground">
                    {receiptPricing ? "Subtotal" : "Total"}
                  </td>
                  <td className="num text-right font-semibold">
                    {formatIDR(
                      lines.reduce((acc, line) => acc.plus(lineAmount(line)), d(0)),
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      {mode === "opname" ? (
        <p className="text-[10px] text-muted-foreground">
          {formatQty(lines.length)} baris dipilih. Selisih dihitung otomatis terhadap stok sistem.
        </p>
      ) : null}
    </div>
  );
}
