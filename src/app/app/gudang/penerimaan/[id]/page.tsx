import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getReceiptDetail } from "@/server/catalog";
import { RECEIPT_SOURCE_LABELS } from "@/server/inventory";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateLong } from "@/lib/format";
import { DocumentMetaRows, DocumentPage } from "@/components/blocks/document-page";
import { StatusBadge, statusLabel } from "@/components/blocks/status-badge";
import {
  STOCK_POSTED_FLOW_STAGES,
  documentFlowSteps,
} from "@/lib/document-flow";
import { DocumentJournals } from "@/components/blocks/document-journals";
import { ReceiptVoidButton } from "@/components/gudang/void-buttons";
import { ReceiptInvoiceNumberForm } from "@/components/gudang/receipt-invoice-number-form";

export const metadata = { title: "Detail Penerimaan Barang" };
export const dynamic = "force-dynamic";

/**
 * FIX-GDG Tahap 4 (GDG2-02) — halaman detail penerimaan. Sebelumnya isi
 * sebuah penerimaan hanya bisa dilihat dari halaman CETAK GRN-nya;
 * kini baris, batch/kedaluwarsa, nomor seri, dan jurnal terkait dapat
 * diperiksa di layar.
 *
 * A-25 U3 — detail memakai DocumentPage bersama: penerimaan adalah
 * dokumen stok satu langkah (STOCK_POSTED_FLOW_STAGES — lahir langsung
 * terposting; void menutup alur dengan tahap Batal), meta dokumen di
 * rel kanan, jurnal terkait diteruskan apa adanya ke slot journals.
 */
export default async function ReceiptDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    getReceiptDetail(tx, ctx.company.id, id),
  );
  if (!data) notFound();
  const { receipt, lines, serialsByProduct, journals } = data;
  const hasDiscount = lines.some((line) => d(line.discountAmount).gt(0));
  const isCreditPurchase = receipt.source === "purchase" && !receipt.paymentAccountCode;
  const sourceLabel =
    RECEIPT_SOURCE_LABELS[receipt.source as keyof typeof RECEIPT_SOURCE_LABELS] ?? receipt.source;

  const metaRows: { label: string; value: React.ReactNode }[] = [
    { label: "Tanggal", value: formatDateLong(receipt.date) },
    { label: "Sumber", value: sourceLabel },
    { label: "Gudang tujuan", value: receipt.warehouseName ?? "—" },
    { label: "Pemasok", value: receipt.supplierName ?? "—" },
  ];
  if (receipt.source === "purchase") {
    metaRows.push({
      label: "No. faktur pemasok",
      value: receipt.supplierInvoiceNumber ?? "Belum dicatat",
    });
  }
  if (receipt.priceVarianceReason) {
    metaRows.push({ label: "Alasan selisih harga PO", value: receipt.priceVarianceReason });
  }
  if (receipt.purchaseOrderId) {
    metaRows.push({
      label: "Pesanan pembelian",
      value: (
        <Link
          href={`/app/gudang/pembelian/${receipt.purchaseOrderId}`}
          className="num text-primary hover:underline"
        >
          {receipt.purchaseOrderNumber ?? "Lihat PO"}
        </Link>
      ),
    });
  }
  if (receipt.paymentAccountCode) {
    metaRows.push({
      label: "Dibayar dari",
      value: `${receipt.paymentAccountCode} — ${receipt.paymentAccountName}`,
    });
  }
  if (isCreditPurchase) {
    metaRows.push({
      label: "Status pembayaran",
      value: <StatusBadge status={receipt.paymentStatus} />,
    });
    if (canSeeCost) {
      metaRows.push({
        label: "Pembayaran utang",
        value: `Terbayar ${formatIDR(receipt.paidAmount)} dari ${formatIDR(receipt.total)}`,
      });
    }
  }
  if (canSeeCost && d(receipt.taxAmount).gt(0)) {
    metaRows.push({
      label: "PPN Masukan",
      value: `${formatIDR(receipt.taxAmount)} (${formatQty(receipt.taxRate)}%)`,
    });
  }
  if (canSeeCost && d(receipt.advanceApplied).gt(0)) {
    metaRows.push({ label: "Uang muka dipakai", value: formatIDR(receipt.advanceApplied) });
  }
  if (canSeeCost) metaRows.push({ label: "Total dokumen", value: formatIDR(receipt.total) });
  if (receipt.notes) {
    metaRows.push({ label: "Catatan", value: receipt.notes });
  }

  return (
    <DocumentPage
      backHref="/app/gudang/penerimaan"
      backLabel="Kembali ke riwayat penerimaan"
      eyebrow="Gudang · Penerimaan"
      number={receipt.number}
      title={`Penerimaan barang — ${sourceLabel}`}
      status={receipt.status}
      steps={documentFlowSteps(
        receipt.status,
        STOCK_POSTED_FLOW_STAGES,
        statusLabel(receipt.status),
      )}
      actions={
        <>
          <Link
            href={`/app/gudang/penerimaan/${receipt.id}/cetak`}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Cetak GRN
          </Link>
          {receipt.status === "posted" && receipt.supplierId && can(ctx, "inventory.manage") ? (
            <Link
              href={`/app/gudang/retur-pembelian/baru?receiptId=${receipt.id}`}
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
            >
              Retur ke pemasok
            </Link>
          ) : null}
          {receipt.status === "posted" && can(ctx, "inventory.manage") ? (
            <ReceiptVoidButton id={receipt.id} number={receipt.number} />
          ) : null}
        </>
      }
      meta={<DocumentMetaRows rows={metaRows} />}
      journals={<DocumentJournals journals={journals} />}
    >
      {receipt.source === "purchase" && receipt.status === "posted" && receipt.supplierId && can(ctx, "inventory.manage") ? (
        <ReceiptInvoiceNumberForm
          receiptId={receipt.id}
          initialValue={receipt.supplierInvoiceNumber}
          initialInvoiceDate={receipt.supplierInvoiceDate}
          initialDueDate={receipt.dueDate}
        />
      ) : null}
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Baris penerimaan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Batch / Kedaluwarsa</th>
                <th>Nomor seri</th>
                <th className="text-right">Qty</th>
                {canSeeCost ? <th className="text-right">Harga perolehan</th> : null}
                {canSeeCost && hasDiscount ? <th className="text-right">Diskon</th> : null}
                {canSeeCost ? <th className="text-right">Subtotal</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const serials = serialsByProduct.get(line.productId) ?? [];
                return (
                  <tr key={line.id}>
                    <td>
                      <p className="font-medium">{line.productName}</p>
                      <p className="num text-[11px] text-muted-foreground">{line.sku ?? ""}</p>
                      {line.packagingId ? (
                        <p className="text-[11px] text-muted-foreground">
                          Diterima sebagai {formatQty(line.qtyInput)} {line.packagingName ?? "kemasan"} · isi {formatQty(line.isiSnapshot)} — qty & harga di tabel ini satuan dasar
                        </p>
                      ) : null}
                    </td>
                    <td className="text-[12px]">
                      {line.batchNumber ? (
                        <>
                          <span className="num">{line.batchNumber}</span>
                          {line.expiryDate ? (
                            <span className="text-muted-foreground"> · kedaluwarsa {formatDate(line.expiryDate)}</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="text-[12px]">
                      {serials.length > 0 ? (
                        <span className="num">{serials.map((row) => row.serialNumber).join(", ")}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="num text-right">
                      {formatQty(line.qty)}
                      {line.unitName ? ` ${line.unitName}` : ""}
                    </td>
                    {canSeeCost ? <td className="num text-right">{formatIDR(line.unitCost)}</td> : null}
                    {canSeeCost && hasDiscount ? (
                      <td className="num text-right text-muted-foreground">
                        {d(line.discountAmount).gt(0) ? (
                          <>
                            {formatIDR(line.discountAmount)}
                            {line.discountType === "percent" ? (
                              <span className="text-[10px]"> ({formatQty(line.discountValue)}%)</span>
                            ) : null}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : null}
                    {canSeeCost ? <td className="num text-right font-medium">{formatIDR(line.lineTotal)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td colSpan={canSeeCost ? (hasDiscount ? 6 : 5) : 3} className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Total dokumen
                </td>
                {canSeeCost ? <td className="num px-3 py-2 text-right font-semibold">{formatIDR(receipt.total)}</td> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </DocumentPage>
  );
}
