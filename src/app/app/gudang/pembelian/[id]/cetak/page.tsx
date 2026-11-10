import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSettings } from "@/server/catalog";
import { PURCHASE_ORDER_STATUS_LABELS, getPurchaseOrderPrintData } from "@/server/purchasing";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Pesanan Pembelian" };
export const dynamic = "force-dynamic";

export default async function PurchaseOrderPrintPage({
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
    const printData = await getPurchaseOrderPrintData(tx, ctx.company.id, id);
    if (!printData) return null;
    const settings = await getSettings(tx, ctx.company.id);
    return { ...printData, settings };
  });

  if (!data) notFound();
  const { order, lines, settings } = data;
  // Print Engine (T4-4, D-13): shared shell/header/footer; figures unchanged.
  const printSettings = toPrintSettings(settings);
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(order.number) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Pesanan Pembelian (Purchase Order)
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{order.number}</h1>
            <StatusBadge
              status={order.status}
              label={PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/gudang/pembelian/${order.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Detail PO
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
          title="Pesanan Pembelian"
          number={order.number}
          dateLabel={formatDate(order.date)}
        />

        {/* CT-11: label-above-value cells (see the GRN print page). */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
          <div>
            <span className="block text-black/60">Pemasok</span>
            <span className="font-medium">{order.supplierName ?? "—"}</span>
          </div>
          <div>
            <span className="block text-black/60">Status</span>
            <span className="font-medium">
              {PURCHASE_ORDER_STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>
          {order.supplierAddress ? (
            <div>
              <span className="block text-black/60">Alamat pemasok</span>
              <span className="font-medium">{order.supplierAddress}</span>
            </div>
          ) : null}
          {order.expectedDate ? (
            <div>
              <span className="block text-black/60">Perkiraan tiba</span>
              <span className="font-medium">{formatDate(order.expectedDate)}</span>
            </div>
          ) : null}
          {order.supplierPhone ? (
            <div>
              <span className="block text-black/60">Telepon pemasok</span>
              <span className="num font-medium">{order.supplierPhone}</span>
            </div>
          ) : null}
        </div>

        <table className="mt-4 w-full text-[12px]">
          <thead>
            <tr className="border-y border-black/60 text-left">
              <th className="py-1.5 pr-2 font-semibold">Produk</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Qty dipesan</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Sudah diterima</th>
              <th className="py-1.5 pr-2 text-right font-semibold">Harga beli</th>
              <th className="py-1.5 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-b border-black/15 align-top">
                <td className="py-1.5 pr-2">
                  <p className="font-medium">{line.productName}</p>
                  <p className="num text-[10px] text-black/60">{line.sku}</p>
                </td>
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                  {/* S2: baris berkemasan dicetak dalam bentuk pesanannya
                      (10 Dus = 400 satuan dasar) — bentuk yang dipahami
                      pemasok; subtotal tidak berubah. */}
                  {line.packagingId
                    ? `${formatQty(line.qtyInput)} ${line.packagingName ?? "kemasan"} (${formatQty(line.qty)}${line.unitName ? ` ${line.unitName}` : ""})`
                    : `${formatQty(line.qty)}${line.unitName ? ` ${line.unitName}` : ""}`}
                </td>
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                  {formatQty(line.receivedQty)}
                </td>
                <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                  {line.packagingId
                    ? formatIDR(d(line.unitCost).mul(d(line.isiSnapshot)))
                    : formatIDR(line.unitCost)}
                </td>
                <td className="num py-1.5 text-right whitespace-nowrap">{formatIDR(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* CT-05/CT-10: summary block after the table — a <tfoot> TOTAL
            would repeat on every page fragment (see the GRN print page). */}
        <div className="print-total-bar mt-2 flex items-baseline justify-end gap-6 break-inside-avoid text-[12px]">
          <span className="font-bold tracking-wide">TOTAL</span>
          <span className="num font-bold">{formatIDR(order.total)}</span>
        </div>

        {order.notes ? (
          <p className="mt-3 text-[11px]">
            <span className="text-black/60">Catatan: </span>
            {order.notes}
          </p>
        ) : null}

        {order.status === "cancelled" ? (
          <p className="mt-3 text-center text-[13px] font-bold uppercase">
            Dokumen dibatalkan — tidak berlaku
          </p>
        ) : null}

        <PrintFooter
          settings={printSettings}
          documentNumber={order.number}
          variant="document"
          qrDataUrl={qrDataUrl}
          qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
          signatures={applySignatureLabels(printSettings, "pembelian", [
            { label: "Dibuat oleh", name: "Bagian pembelian" },
            { label: "Disetujui oleh", name: "Kepala gudang / Pemilik" },
            { label: "Diterima pemasok", name: order.supplierName ?? "Pemasok" },
          ])}
        />
        </PrintShell>
      </div>
    </div>
  );
}
