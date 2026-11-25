import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSaleReturnVoucher } from "@/server/pos";
import { requirePermissionPage } from "@/lib/session";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Bukti Retur" };
export const dynamic = "force-dynamic";

function refundLabel(method: string): string {
  return (
    {
      cash: "Tunai",
      transfer: "Transfer bank",
      store_credit: "Kredit toko",
      exchange: "Tukar barang (kredit pelanggan)",
    }[method] ?? method
  );
}

export default async function SaleReturnVoucherPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("pos.return");

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getSaleReturnVoucher(tx, ctx.company.id, id),
  );

  if (!data) notFound();
  const { ret, sale, customer, lines, settings } = data;
  const printSettings = toPrintSettings(settings, "faktur");
  const qrDataUrl = printSettings.showQr
    ? await documentQrDataUrl(ret.number)
    : null;
  const isCredit = ret.refundMethod === "store_credit" || ret.refundMethod === "exchange";
  const remainingCredit = isCredit
    ? Math.max(0, Number(ret.total) - Number(ret.creditUsed))
    : 0;
  const goodsTotal = Number(ret.goodsTotal ?? ret.total);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] text-muted-foreground">Bukti retur penjualan</p>
          <h1 className="num mt-1 text-[20px] font-semibold tracking-tight">{ret.number}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {isCredit ? (
            <Link
              href={`/app/pos?credit=${encodeURIComponent(ret.number)}`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Buat penjualan pengganti
            </Link>
          ) : null}
          <Link
            href="/app/pos/retur"
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Retur lain
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
            title="Bukti Retur Penjualan"
            number={ret.number}
            dateLabel={formatDateTime(ret.createdAt)}
          />

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div>
              <p className="text-black/60">Nota asal</p>
              <p className="num font-medium">{sale.number}</p>
              <p className="mt-2 text-black/60">Pelanggan</p>
              <p className="font-medium">{customer?.name ?? "Umum"}</p>
              {customer?.phone ? <p className="num">Telp. {customer.phone}</p> : null}
            </div>
            <div>
              <p className="text-black/60">Tanggal retur</p>
              <p className="font-medium">{formatDate(ret.date)}</p>
              <p className="mt-2 text-black/60">Jenis / penyelesaian</p>
              <p className="font-medium">
                {ret.type === "exchange" ? "Tukar barang" : "Retur dana"} ·{" "}
                {refundLabel(ret.refundMethod)}
              </p>
              <p className="mt-2 text-black/60">Kondisi barang</p>
              <p className="font-medium">
                {ret.disposition === "write_off"
                  ? "Tidak layak jual — dibebankan"
                  : "Layak jual — kembali ke stok"}
              </p>
            </div>
          </div>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/40 text-left">
                <th className="py-1.5 pr-2 font-semibold">Barang</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                <th className="py-1.5 text-right font-semibold">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-black/10">
                  <td className="py-1.5 pr-2">
                    <p className="font-medium">{line.productName}</p>
                    {line.packagingId ? (
                      <p className="num text-[10px] text-black/60">
                        {formatQty(line.qtyInput)} kemasan · {formatQty(line.qty)} satuan dasar
                      </p>
                    ) : null}
                    {(line.serialNumbers ?? []).length > 0 ? (
                      <p className="num text-[10px] text-black/60">
                        Seri: {(line.serialNumbers ?? []).join(", ")}
                      </p>
                    ) : null}
                  </td>
                  <td className="num py-1.5 pr-2 text-right">{formatQty(line.qtyInput)}</td>
                  <td className="num py-1.5 text-right">{formatIDR(line.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-3 ml-auto max-w-xs space-y-1 text-[12px]">
            <div className="flex justify-between border-b border-black/10 py-1">
              <span>Nilai barang diretur</span>
              <span className="num font-medium">{formatIDR(goodsTotal)}</span>
            </div>
            <div className="flex justify-between border-b border-black/10 py-1">
              <span>{isCredit ? "Kredit diterbitkan" : "Refund"}</span>
              <span className="num font-medium">{formatIDR(ret.total)}</span>
            </div>
            {isCredit ? (
              <>
                <div className="flex justify-between border-b border-black/10 py-1">
                  <span>Kredit terpakai</span>
                  <span className="num">{formatIDR(ret.creditUsed)}</span>
                </div>
                <div className="flex justify-between border-b border-black/10 py-1 font-semibold">
                  <span>Sisa kredit</span>
                  <span className="num">{formatIDR(remainingCredit)}</span>
                </div>
              </>
            ) : null}
          </div>

          <p className="mt-4 border-t border-dashed border-black/40 pt-2 text-[11px]">
            Alasan: {ret.reason}
          </p>
          {isCredit ? (
            <p className="mt-1 text-[11px] text-black/70">
              Simpan bukti ini. Kredit ditukarkan dengan menyebutkan nomor retur{" "}
              <span className="num font-semibold">{ret.number}</span>.
            </p>
          ) : null}

          <PrintFooter
            settings={printSettings}
            documentNumber={ret.number}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={[
              { label: "Kasir", name: ctx.user.name },
              { label: "Pelanggan" },
            ]}
          />
        </PrintShell>
      </div>
    </div>
  );
}
