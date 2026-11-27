import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompany } from "@/db/tenant";
import { getSaleDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { writeAudit } from "@/server/audit";
import { verifyReceiptPrintToken } from "@/server/pos";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { receiptHref } from "@/lib/pos/receipt-links";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  applySignatureLabels,
  paperSpec,
  toPrintSettings,
} from "@/components/print/types";

export const metadata = { title: "Faktur Penjualan" };
export const dynamic = "force-dynamic";

/**
 * A-28 UI-2 (UX-D03): faktur penjualan format dokumen (kertas
 * dokumen A4/A5 dari mesin cetak yang sama) — dokumen penjualan
 * untuk pelanggan bisnis, berdampingan dengan struk termal.
 * Sumber datanya getSaleDetail yang sama persis dengan halaman
 * nota: angka faktur dan struk tidak mungkin berbeda. PPN pada
 * penjualan POS bersifat termasuk dalam total (baris "termasuk
 * PPN" di struk), jadi faktur menyatakannya apa adanya: DPP =
 * jumlah neto baris yang dikenai PPN, PPN ditampilkan terpisah,
 * TOTAL identik. Barang bebas pajak dan pembulatan tidak masuk DPP.
 */
export default async function SalesInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; salinan?: string; printToken?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  // Faktur A4 dapat dibuka sebagai dokumen pertama dari checkout
  // (membawa printToken) atau sebagai salinan historis (salinan=1,
  // memerlukan izin cetak ulang + audit). Token tidak pernah
  // menggantikan izin untuk salinan historis.
  const isCopy = query.salinan === "1";
  const ctx = await requirePermissionPage("pos.sell");
  const canReprint = can(ctx, "pos.receipt.reprint");
  if (isCopy && !canReprint) notFound();

  const data = await withCompany(ctx.company.id, async (tx) => {
    const fresh = await verifyReceiptPrintToken(tx, {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      saleId: id,
      token: query.printToken,
    });
    if (!fresh && !canReprint) return null;
    const detail = await getSaleDetail(tx, ctx.company.id, id);
    if (!detail) return null;
    const settings = await getSettings(tx, ctx.company.id);
    if (isCopy || !fresh) {
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos.receipt.reprint",
        entityType: "sale",
        entityId: id,
        after: {
          number: detail.sale.number,
          autoprint: query.autoprint === "1",
          transport: "faktur",
        },
      });
    }
    return { ...detail, settings, fresh };
  });

  if (!data) notFound();
  const { sale, lines, payments, settings, customer, cashier, branch } = data;
  const printSettings = toPrintSettings(settings, "faktur");
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(sale.number) : null;
  const taxAmount = d(sale.taxTotal);
  const showTax = printSettings.showTax && taxAmount.gt(0);
  // DPP hanya dari baris yang benar-benar dikenai PPN. Rumus lama
  // (total − PPN) ikut memasukkan pembulatan dan barang bebas pajak.
  const taxBase = lines.reduce(
    (sum, line) =>
      d(line.taxAmount).gt(0)
        ? sum.plus(d(line.lineTotal).minus(d(line.taxAmount)))
        : sum,
    d(0),
  );
  const remaining = d(sale.total).minus(d(sale.paidTotal));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] text-muted-foreground">Faktur penjualan</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-[20px] font-semibold leading-tight tracking-tight">{sale.number}</h1>
            <StatusBadge status={sale.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={receiptHref(sale.id, { copy: isCopy, printToken: query.printToken })}
            className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-8"
          >
            Struk termal
          </Link>
          <Link
            href="/app/pos/riwayat"
            className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-8"
          >
            Riwayat
          </Link>
          <ReceiptPrint
            auto={query.autoprint === "1"}
            // Hanya alur checkout (tanpa salinan) yang kembali ke kasir.
            // Cetak ulang dari riwayat membiarkan tab faktur tetap terbuka.
            returnTo={
              query.autoprint === "1" && !isCopy && data.fresh ? "/app/pos" : undefined
            }
          />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            branchName={branch?.name}
            address={branch?.address ?? settings?.address}
            phone={branch?.phone ?? settings?.phone}
            taxId={settings?.taxId}
            variant="document"
            title="Faktur Penjualan"
            number={sale.number}
            dateLabel={formatDateTime(sale.createdAt)}
          />

          {isCopy ? (
            <p className="mb-2 border-y-2 border-double border-black py-1 text-center text-[13px] font-bold uppercase tracking-widest">
              Salinan — bukan faktur asli
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div>
              <span className="block text-black/60">Ditagihkan kepada</span>
              <span className="font-medium">{customer?.name ?? "Pelanggan umum"}</span>
              {customer?.taxId ? (
                <span className="num block text-black/70">NPWP {customer.taxId}</span>
              ) : null}
              <span className="mt-1 inline-block border border-black/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                {remaining.gt(0) ? "Belum lunas" : "Lunas"}
              </span>
              {customer?.address ? (
                <span className="block whitespace-pre-line">{customer.address}</span>
              ) : null}
              {customer?.phone ? <span className="num block">Telp. {customer.phone}</span> : null}
            </div>
            <div>
              <span className="block text-black/60">Tanggal</span>
              <span className="font-medium">{formatDate(sale.createdAt)}</span>
              {printSettings.showCashier ? (
                <>
                  <span className="mt-2 block text-black/60">Kasir</span>
                  <span className="font-medium">{cashier?.name ?? "—"}</span>
                </>
              ) : null}
              {sale.dueDate ? (
                <>
                  <span className="mt-2 block text-black/60">Jatuh tempo</span>
                  <span className="font-medium">{formatDate(sale.dueDate)}</span>
                </>
              ) : null}
            </div>
          </div>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="py-1.5 pr-2 font-semibold">Produk</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Harga satuan</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Diskon</th>
                <th className="py-1.5 text-right font-semibold">Jumlah</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-black/15 align-top">
                  <td className="py-1.5 pr-2">
                    <p className="font-medium">{line.productName}</p>
                    {line.productSku ? (
                      <p className="num text-[10px] text-black/50">{line.productSku}</p>
                    ) : null}
                    {/* S4: baris berkemasan pada faktur A4 — qty &
                        harga satuan dalam bentuk masukan, padanan
                        satuan dasar sebagai anotasi. */}
                    {line.packagingId ? (
                      <p className="num text-[11px] text-black/60">
                        = {formatQty(line.qty)} Pcs (isi {formatQty(line.isiSnapshot)})
                      </p>
                    ) : null}
                  </td>
                  <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                    {line.packagingId
                      ? `${formatQty(line.qtyInput)} ${line.packagingName}`
                      : formatQty(line.qty)}
                  </td>
                  <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                    {line.packagingId
                      ? formatIDR(Number(line.unitPrice) * Number(line.isiSnapshot))
                      : formatIDR(line.unitPrice)}
                  </td>
                  <td className="num py-1.5 pr-2 text-right whitespace-nowrap">
                    {Number(line.discountAmount) > 0 ? `−${formatIDR(line.discountAmount)}` : "—"}
                  </td>
                  <td className="num py-1.5 text-right whitespace-nowrap">{formatIDR(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 flex justify-end break-inside-avoid">
            <div className="w-64 space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span>Subtotal</span>
                <span className="num">{formatIDR(sale.subtotal)}</span>
              </div>
              {Number(sale.discountTotal) > 0 ? (
                <div className="flex justify-between">
                  <span>Diskon</span>
                  <span className="num">−{formatIDR(sale.discountTotal)}</span>
                </div>
              ) : null}
              {Number(sale.roundingAdjustment) !== 0 ? (
                <div className="flex justify-between">
                  <span>Pembulatan</span>
                  <span className="num">
                    {Number(sale.roundingAdjustment) > 0 ? "+" : "−"}
                    {formatIDR(Math.abs(Number(sale.roundingAdjustment)))}
                  </span>
                </div>
              ) : null}
              {showTax ? (
                <>
                  <div className="flex justify-between">
                    <span>Dasar pengenaan pajak</span>
                    <span className="num">{formatIDR(taxBase.toString())}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>PPN (termasuk dalam total)</span>
                    <span className="num">{formatIDR(sale.taxTotal)}</span>
                  </div>
                </>
              ) : null}
              <div className="print-total-bar flex justify-between border-t border-black/50 pt-1 text-[13px] font-bold">
                <span>TOTAL</span>
                <span className="num">{formatIDR(sale.total)}</span>
              </div>
              {payments.map((payment) => (
                <div key={payment.id} className="flex justify-between">
                  <span>{payment.methodName ?? "Pembayaran"}</span>
                  <span className="num">{formatIDR(payment.amount)}</span>
                </div>
              ))}
              {remaining.gt(0) ? (
                <div className="flex justify-between font-medium">
                  <span>Sisa utang</span>
                  <span className="num">{formatIDR(remaining.toString())}</span>
                </div>
              ) : (
                <div className="flex justify-between">
                  <span>Status pembayaran</span>
                  <span className="font-medium">Lunas</span>
                </div>
              )}
            </div>
          </div>

          {remaining.gt(0) ? (
            <div className="mt-3 break-inside-avoid rounded border border-black/30 p-3 text-[11px] leading-5">
              <p className="font-semibold uppercase tracking-wide">Cara pembayaran</p>
              <p>
                Mohon lakukan pembayaran{sale.dueDate ? ` sebelum ${formatDate(sale.dueDate)}` : ""}.
                Cantumkan nomor faktur <span className="num font-medium">{sale.number}</span> pada
                bukti transfer.
              </p>
              {settings?.phone ? <p>Konfirmasi pembayaran: {settings.phone}</p> : null}
            </div>
          ) : null}

          {sale.voidReason ? (
            <p className="mt-3 border-y-2 border-double border-black py-1.5 text-center text-[13px] font-bold uppercase tracking-widest text-black">
              Dokumen dibatalkan — {sale.voidReason}
            </p>
          ) : null}

          <PrintFooter
            settings={printSettings}
            documentNumber={sale.number}
            variant="document"
            printedByName={cashier?.name}
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={applySignatureLabels(printSettings, "faktur", [
              { label: "Dibuat oleh", name: cashier?.name ?? undefined },
              { label: "Diterima oleh", name: customer?.name ?? undefined },
            ])}
          />
        </PrintShell>
      </div>

      <div className="no-print mt-4 rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        <p className="font-medium text-foreground">Faktur dari penjualan yang sama</p>
        <p className="mt-0.5">
          Faktur ini memakai data penjualan dan mesin cetak yang sama dengan struk termal — kop, logo,
          tanda tangan, dan kertas dokumen diatur di{" "}
          <Link href="/app/pengaturan?tab=cetak" className="underline">Pengaturan → Cetak</Link>.
        </p>
      </div>
    </div>
  );
}
