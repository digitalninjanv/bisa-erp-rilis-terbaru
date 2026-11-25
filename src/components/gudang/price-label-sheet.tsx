"use client";

import { useMemo, useState } from "react";
import { Printer } from "lucide-react";
import { encodeCode128B } from "@/lib/barcode-svg";
import { formatIDR, formatQty } from "@/lib/money";
import { todayISO, formatDate } from "@/lib/format";

export type PriceLabelProduct = {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  salePrice: string;
  unitCode: string | null;
  isTaxExempt: boolean;
  packagings: Array<{
    id: string;
    name: string;
    isi: string;
    salePrice: string | null;
  }>;
};

type LabelSize = "shelf_60x35" | "sticker_50x30";

export function PriceLabelSheet({
  companyName,
  products,
}: {
  companyName: string;
  products: PriceLabelProduct[];
}) {
  const [size, setSize] = useState<LabelSize>("shelf_60x35");
  const [showBarcode, setShowBarcode] = useState(true);
  const [showPackaging, setShowPackaging] = useState(true);
  const [copies, setCopies] = useState<Record<string, number>>(() =>
    Object.fromEntries(products.map((p) => [p.id, 1])),
  );

  const printedDate = formatDate(todayISO());

  const labels = useMemo(() => {
    const out: Array<{ key: string; product: PriceLabelProduct }> = [];
    for (const product of products) {
      const count = Math.max(0, Math.min(50, copies[product.id] ?? 1));
      for (let i = 0; i < count; i++) {
        out.push({ key: `${product.id}-${i}`, product });
      }
    }
    return out;
  }, [products, copies]);

  return (
    <div className="space-y-4">
      <section className="no-print rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4">
            <fieldset className="flex items-center gap-3 text-[12px]">
              <legend className="sr-only">Ukuran label</legend>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="label-size"
                  checked={size === "shelf_60x35"}
                  onChange={() => setSize("shelf_60x35")}
                />
                <span>Label Rak (60 × 35 mm)</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="label-size"
                  checked={size === "sticker_50x30"}
                  onChange={() => setSize("sticker_50x30")}
                />
                <span>Stiker Barcode (50 × 30 mm)</span>
              </label>
            </fieldset>

            <label className="inline-flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={showBarcode}
                onChange={(event) => setShowBarcode(event.target.checked)}
              />
              <span>Tampilkan barcode</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-[12px]">
              <input
                type="checkbox"
                checked={showPackaging}
                onChange={(event) => setShowPackaging(event.target.checked)}
              />
              <span>Harga kemasan</span>
            </label>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            disabled={labels.length === 0}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Printer className="size-3.5" />
            Cetak ({labels.length} label)
          </button>
        </div>

        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
            Jumlah cetak per produk
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((product) => (
              <div
                key={product.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2.5 py-1.5 text-[11px]"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{product.name}</p>
                  <p className="num text-[10px] text-muted-foreground">
                    {product.barcode ?? product.sku} · {formatIDR(product.salePrice)}
                  </p>
                </div>
                <input
                  type="number"
                  min={0}
                  max={50}
                  aria-label={`Jumlah label ${product.name}`}
                  value={copies[product.id] ?? 1}
                  onChange={(event) => {
                    const n = Math.max(0, Math.min(50, Number(event.target.value) || 0));
                    setCopies((prev) => ({ ...prev, [product.id]: n }));
                  }}
                  className="num h-8 w-16 shrink-0 rounded border border-input bg-background px-2 text-right text-[12px]"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="print-area rounded-lg border border-border bg-white p-4 text-black print:border-0 print:p-0">
        <div
          className={
            size === "shelf_60x35"
              ? "grid grid-cols-[repeat(auto-fill,60mm)] gap-2 print:gap-[2mm]"
              : "grid grid-cols-[repeat(auto-fill,50mm)] gap-2 print:gap-[2mm]"
          }
        >
          {labels.map(({ key, product }) => {
            const codeValue = product.barcode?.trim() || product.sku;
            const barcode = showBarcode ? encodeCode128B(codeValue) : null;
            const firstPack = product.packagings.find((pack) => pack.salePrice != null);
            return (
              <article
                key={key}
                style={{
                  width: size === "shelf_60x35" ? "60mm" : "50mm",
                  minHeight: size === "shelf_60x35" ? "35mm" : "30mm",
                }}
                className="flex break-inside-avoid flex-col justify-between rounded border border-neutral-400 bg-white p-2 text-black"
              >
                <div>
                  <div className="flex items-center justify-between gap-1 text-[8px] font-semibold uppercase tracking-wide text-neutral-600">
                    <span className="truncate">{companyName}</span>
                    <span className="shrink-0">{printedDate}</span>
                  </div>
                  <h3 className="mt-0.5 line-clamp-2 text-[10px] font-bold leading-tight">
                    {product.name}
                  </h3>
                </div>

                <div className="my-1">
                  <p className="num text-[16px] font-extrabold leading-none tracking-tight">
                    {formatIDR(product.salePrice)}
                    {product.unitCode ? (
                      <span className="ml-1 text-[9px] font-semibold text-neutral-700">
                        / {product.unitCode}
                      </span>
                    ) : null}
                  </p>
                  {showPackaging && firstPack ? (
                    <p className="num mt-0.5 text-[8.5px] font-semibold text-neutral-700">
                      {firstPack.name} ({formatQty(firstPack.isi)}): {formatIDR(firstPack.salePrice!)}
                    </p>
                  ) : null}
                </div>

                {barcode ? (
                  <div className="flex flex-col items-center">
                    <svg
                      role="img"
                      aria-label={`Barcode ${barcode.value}`}
                      viewBox={`0 0 ${barcode.totalWidth} 28`}
                      className="h-6 w-full max-w-[48mm]"
                      preserveAspectRatio="none"
                    >
                      <title>{barcode.value}</title>
                      {barcode.bars.map((bar, index) => (
                        <rect
                          key={index}
                          x={bar.x}
                          y={0}
                          width={bar.width}
                          height={28}
                          fill="#000"
                        />
                      ))}
                    </svg>
                    <span className="num text-[8px] tracking-wider text-neutral-800">
                      {barcode.value}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-between text-[8px] text-neutral-700">
                    <span className="num">{codeValue}</span>
                    {product.isTaxExempt ? <span>Non-BKP</span> : null}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
