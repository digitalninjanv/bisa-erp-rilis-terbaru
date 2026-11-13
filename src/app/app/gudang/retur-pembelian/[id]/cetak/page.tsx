import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, inArray } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { purchaseOrders, stockReceiptLines, stockReceipts } from "@/db/schema";
import { getSettings } from "@/server/catalog";
import {
  SUPPLIER_RETURN_REASON_LABELS,
  SUPPLIER_RETURN_RESOLUTION_LABELS,
  getSupplierReturnPrintData,
} from "@/server/supplier-returns";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Dokumen Retur Pembelian" };
export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  posted: "Terposting",
  partially_resolved: "Sebagian selesai",
  resolved: "Selesai",
  void: "Batal",
};

export default async function SupplierReturnPrintPage({
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
    const printData = await getSupplierReturnPrintData(tx, ctx.company.id, id);
    if (!printData) return null;
    const settings = await getSettings(tx, ctx.company.id);
    // Retur menautkan baris ke baris penerimaan asal (receiptLineId).
    // Satu kueri lokal di halaman cetak menampilkan GRN/PO asal tanpa
    // memperluas kontrak getSupplierReturnPrintData yang dipakai bersama.
    const receiptLineIds = printData.detail.lines
      .map((line) => line.receiptLineId)
      .filter((value): value is string => Boolean(value));
    let sourceDocuments: { receiptNumber: string; purchaseOrderNumber: string | null }[] = [];
    if (receiptLineIds.length > 0) {
      const rows = await tx
        .select({
          receiptNumber: stockReceipts.number,
          purchaseOrderNumber: purchaseOrders.number,
        })
        .from(stockReceiptLines)
        .innerJoin(stockReceipts, eq(stockReceiptLines.receiptId, stockReceipts.id))
        .leftJoin(purchaseOrders, eq(stockReceipts.purchaseOrderId, purchaseOrders.id))
        .where(
          and(
            eq(stockReceiptLines.companyId, ctx.company.id),
            inArray(stockReceiptLines.id, receiptLineIds),
          ),
        );
      const seen = new Set<string>();
      sourceDocuments = rows.filter((row) => {
        if (seen.has(row.receiptNumber)) return false;
        seen.add(row.receiptNumber);
        return true;
      });
    }
    return { ...printData, settings, sourceDocuments };
  });

  if (!data) notFound();
  const { detail, settings, sourceDocuments } = data;
  const printSettings = toPrintSettings(settings, "retur_pembelian");
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(detail.number) : null;
  const isDraft = detail.status === "draft";
  const remaining = d(detail.creditAmount).minus(d(detail.resolvedAmount));
  const resolutionStatus =
    detail.status === "draft"
      ? "Belum diposting"
      : detail.status === "void"
        ? "Dibatalkan"
        : detail.status === "resolved"
          ? "Selesai"
          : remaining.gt(0)
            ? `Sisa klaim ${formatIDR(remaining)}`
            : "Tidak ada klaim kredit";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Dokumen Retur Pembelian (RTB)
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{detail.number}</h1>
            <StatusBadge status={detail.status} label={STATUS_LABELS[detail.status] ?? detail.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/gudang/retur-pembelian/${detail.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Detail retur
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
            taxId={settings?.taxId}
            variant="document"
            title="Retur Pembelian ke Pemasok"
            number={detail.number}
            dateLabel={formatDate(detail.date)}
          />

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div>
              <span className="block text-black/60">Pemasok</span>
              <span className="font-medium">{data.supplierName ?? "—"}</span>
            </div>
            <div>
              <span className="block text-black/60">Gudang asal</span>
              <span className="font-medium">{data.warehouseName ?? "—"}</span>
            </div>
            <div>
              <span className="block text-black/60">Status dokumen</span>
              <span className="font-medium">{STATUS_LABELS[detail.status] ?? detail.status}</span>
            </div>
            <div>
              <span className="block text-black/60">Status penyelesaian</span>
              <span className="font-medium">{resolutionStatus}</span>
            </div>
            <div>
              <span className="block text-black/60">Kategori alasan</span>
              <span className="font-medium">
                {SUPPLIER_RETURN_REASON_LABELS[detail.reasonCategory] ?? detail.reasonCategory}
              </span>
            </div>
            <div>
              <span className="block text-black/60">Penyelesaian yang direncanakan</span>
              <span className="font-medium">
                {SUPPLIER_RETURN_RESOLUTION_LABELS[detail.resolutionType] ?? detail.resolutionType}
              </span>
            </div>
            {sourceDocuments.length > 0 ? (
              <div className="col-span-2">
                <span className="block text-black/60">Dokumen asal</span>
                <span className="font-medium">
                  {sourceDocuments
                    .map(
                      (doc) =>
                        `GRN ${doc.receiptNumber}${doc.purchaseOrderNumber ? ` (PO ${doc.purchaseOrderNumber})` : ""}`,
                    )
                    .join(" · ")}
                </span>
              </div>
            ) : null}
            <div className="col-span-2">
              <span className="block text-black/60">Alasan retur</span>
              <span className="font-medium">{detail.reasonDetail}</span>
            </div>
            {detail.resolutionNote ? (
              <div className="col-span-2">
                <span className="block text-black/60">Catatan penyelesaian</span>
                <span className="font-medium">{detail.resolutionNote}</span>
              </div>
            ) : null}
          </div>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="py-1.5 pr-2 font-semibold">Produk</th>
                <th className="py-1.5 pr-2 font-semibold">Batch</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Harga pokok</th>
                <th className="py-1.5 text-right font-semibold">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => {
                const info = data.productInfo.get(line.productId);
                const batch = line.batchId ? data.batchById.get(line.batchId) : undefined;
                return (
                  <tr key={line.id} className="border-b border-black/15 align-top">
                    <td className="py-1.5 pr-2">
                      <p className="font-medium">{line.productName}</p>
                      <p className="num text-[10px] text-black/60">{info?.sku ?? ""}</p>
                    </td>
                    <td className="py-1.5 pr-2">
                      {line.batchId ? (batch?.batchNumber ?? "—") : "—"}
                      {batch?.expiryDate ? (
                        <span className="block text-[10px] text-black/60">ED {formatDate(batch.expiryDate)}</span>
                      ) : null}
                    </td>
                    <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                      {formatQty(line.qty)}{info?.unitName ? ` ${info.unitName}` : ""}
                    </td>
                    <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                      {isDraft ? "—" : formatIDR(line.unitCost)}
                    </td>
                    <td className="num py-1.5 text-right whitespace-nowrap">
                      {isDraft ? "—" : formatIDR(line.lineTotal)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* CT-05/CT-10: total di luar tabel agar tidak berulang prematur di dokumen multipel-halaman. */}
          {!isDraft ? (
            <div className="print-total-bar mt-2 flex items-baseline justify-end gap-6 break-inside-avoid text-[12px]">
              <span className="font-bold tracking-wide">TOTAL NILAI RETUR</span>
              <span className="num font-bold">{formatIDR(detail.totalValue)}</span>
            </div>
          ) : null}

          {!isDraft && detail.status !== "void" ? (
            <div className="mt-3 space-y-1 text-[11px]">
              <p>
                <span className="text-black/60">Memotong utang pemasok: </span>
                <span className="num font-medium">{formatIDR(detail.payableAmount)}</span>
                <span className="text-black/60"> · Menjadi Kredit Pemasok: </span>
                <span className="num font-medium">{formatIDR(detail.creditAmount)}</span>
                {d(detail.resolvedAmount).gt(0) ? (
                  <>
                    <span className="text-black/60"> · Sudah diselesaikan: </span>
                    <span className="num font-medium">{formatIDR(detail.resolvedAmount)}</span>
                    <span className="text-black/60"> · Sisa klaim: </span>
                    <span className="num font-medium">{formatIDR(remaining)}</span>
                  </>
                ) : null}
              </p>
            </div>
          ) : null}

          {isDraft ? (
            <p className="mt-3 text-center text-[13px] font-bold uppercase">
              Draf — belum diposting, nilai belum dibekukan
            </p>
          ) : null}
          {detail.status === "void" ? (
            <p className="mt-3 border-y-2 border-double border-black py-1.5 text-center text-[13px] font-bold uppercase tracking-widest text-black">
              Dokumen dibatalkan — tidak berlaku
            </p>
          ) : null}

          <PrintFooter
            settings={printSettings}
            documentNumber={detail.number}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={applySignatureLabels(printSettings, "retur_pembelian", [
              { label: "Diserahkan oleh", name: "Petugas gudang" },
              { label: "Diterima oleh", name: data.supplierName ?? "Pemasok / Kurir" },
              { label: "Mengetahui", name: "Kepala gudang / Pemilik" },
            ])}
          />
        </PrintShell>
      </div>
    </div>
  );
}
