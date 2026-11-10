import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getReceiptPrintData, getSettings } from "@/server/catalog";
import { RECEIPT_SOURCE_LABELS, type ReceiptSource } from "@/server/inventory";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Bukti Penerimaan Barang" };
export const dynamic = "force-dynamic";

export default async function GoodsReceiptPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const printData = await getReceiptPrintData(tx, ctx.company.id, id);
    if (!printData) return null;
    const settings = await getSettings(tx, ctx.company.id);
    return { ...printData, settings };
  });

  if (!data) notFound();
  const { receipt, lines, serialsByProduct, settings } = data;
  const hasDiscount = lines.some((line) => d(line.discountAmount).gt(0));
  // Print Engine (T4-4, D-13): shared shell/header/footer; figures unchanged.
  const printSettings = toPrintSettings(settings);
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(receipt.number) : null;
  const source = receipt.source as ReceiptSource;
  const isCreditPurchase = source === "purchase" && !receipt.paymentAccountId;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Bukti Penerimaan Barang (GRN)
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{receipt.number}</h1>
            <StatusBadge status={receipt.status} label={receipt.status === "void" ? "Dibatalkan" : undefined} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/app/gudang/penerimaan"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Riwayat penerimaan
          </Link>
          <ReceiptPrint auto={query.autoprint === "1"} />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
        <PrintHeader
          settings={printSettings}
          companyName={settings?.legalName ?? "Bisa Minimarket"}
          address={settings?.address}
          phone={settings?.phone}
          variant="document"
          title="Bukti Penerimaan Barang"
          number={receipt.number}
          dateLabel={formatDate(receipt.date)}
        />

        {/* CT-11: label-above-value cells keep every label–value pair
            aligned in both A4 and A5 (the old side-by-side flex wrapped
            wide values like "Status pembayaran" out of alignment). */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
          <div>
            <span className="block text-black/60">Sumber penerimaan</span>
            <span className="font-medium">
              {RECEIPT_SOURCE_LABELS[source] ?? receipt.source}
              {source === "purchase" && receipt.paymentAccountId ? " — dibayar tunai" : ""}
            </span>
          </div>
          <div>
            <span className="block text-black/60">Gudang tujuan</span>
            <span className="font-medium">{receipt.warehouseName ?? "—"}</span>
          </div>
          <div>
            <span className="block text-black/60">Pemasok</span>
            <span className="font-medium">{receipt.supplierName ?? "—"}</span>
          </div>
          {receipt.supplierInvoiceNumber ? (
            <div>
              <span className="block text-black/60">No. invoice pemasok</span>
              <span className="num font-medium">{receipt.supplierInvoiceNumber}</span>
            </div>
          ) : null}
          {receipt.paymentAccountId ? (
            <div>
              <span className="block text-black/60">Dibayar dari</span>
              <span className="font-medium">
                {receipt.paymentAccountCode} — {receipt.paymentAccountName}
              </span>
            </div>
          ) : null}
          {isCreditPurchase ? (
            <div>
              <span className="block text-black/60">Status pembayaran</span>
              <span className="font-medium">
                Utang — terbayar {formatIDR(receipt.paidAmount)} dari {formatIDR(receipt.total)}
              </span>
            </div>
          ) : null}
          {d(receipt.advanceApplied).gt(0) ? (
            <div>
              <span className="block text-black/60">Uang muka dipakai</span>
              <span className="font-medium">{formatIDR(receipt.advanceApplied)}</span>
            </div>
          ) : null}
        </div>

        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="border-y border-black/60 text-left">
              <th className="py-1.5 pr-2 font-semibold">Produk</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Harga perolehan</th>
              {hasDiscount ? (
                <th className="py-1.5 pr-2 text-right font-semibold">Diskon</th>
              ) : null}
              <th className="py-1.5 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-black/15 align-top">
                <td className="py-1.5 pr-2">
                  <p className="font-medium">{line.productName}</p>
                  <p className="num text-[10px] text-black/60">{line.sku}</p>
                  {line.batchNumber ? (
                    <p className="num text-[10px] text-black/60">
                      Batch {line.batchNumber}
                      {line.expiryDate ? ` · kedaluwarsa ${formatDate(line.expiryDate)}` : ""}
                    </p>
                  ) : null}
                  {(serialsByProduct.get(line.productId) ?? []).length > 0 ? (
                    <p className="num text-[10px] text-black/60">
                      Seri: {(serialsByProduct.get(line.productId) ?? []).join(", ")}
                    </p>
                  ) : null}
                </td>
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                  {formatQty(line.qty)}{line.unitName ? ` ${line.unitName}` : ""}
                </td>
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap">{formatIDR(line.unitCost)}</td>
                {hasDiscount ? (
                  <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                    {d(line.discountAmount).gt(0) ? formatIDR(line.discountAmount) : "—"}
                  </td>
                ) : null}
                <td className="num py-1.5 text-right whitespace-nowrap">{formatIDR(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* CT-05/CT-10: the total lives outside the table — a <tfoot>
            would be repeated by Chromium on every page fragment, so a
            multi-page document showed a premature TOTAL on page 1. As a
            summary block it prints once, after the last row, unsplit. */}
        <div className="print-total-bar mt-2 flex items-baseline justify-end gap-6 break-inside-avoid text-[12px]">
          <span className="font-bold tracking-wide">TOTAL</span>
          <span className="num font-bold">{formatIDR(receipt.total)}</span>
        </div>

        {receipt.notes ? (
          <p className="mt-3 text-[11px]">
            <span className="text-black/60">Catatan: </span>
            {receipt.notes}
          </p>
        ) : null}

        {receipt.status === "void" ? (
          <p className="mt-3 text-center text-[13px] font-bold uppercase">
            Dokumen dibatalkan — tidak berlaku
          </p>
        ) : null}

        <PrintFooter
          settings={printSettings}
          documentNumber={receipt.number}
          variant="document"
          qrDataUrl={qrDataUrl}
          qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
          signatures={applySignatureLabels(printSettings, "penerimaan", [
            { label: "Diserahkan oleh", name: receipt.supplierName ?? "Pemasok / Pengirim" },
            { label: "Diterima oleh", name: "Petugas gudang" },
            { label: "Mengetahui", name: "Kepala gudang / Pemilik" },
          ])}
        />
        </PrintShell>
      </div>
    </div>
  );
}
