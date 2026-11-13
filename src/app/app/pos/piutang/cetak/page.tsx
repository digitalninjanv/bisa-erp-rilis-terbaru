import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { customers } from "@/db/schema";
import { getSettings } from "@/server/catalog";
import { listReceivables } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { d, formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Statement Piutang Pelanggan" };
export const dynamic = "force-dynamic";

function bucket(days: number): string {
  if (days <= 0) return "Belum jatuh tempo";
  if (days <= 30) return "1–30 hari";
  if (days <= 60) return "31–60 hari";
  if (days <= 90) return "61–90 hari";
  return "> 90 hari";
}

export default async function CustomerStatementPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; autoprint?: string }>;
}) {
  const params = await searchParams;
  const customerId = params.customerId;
  if (!customerId) notFound();
  const ctx = await requirePermissionPage("pos.sell");
  const today = todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [customerRows, receivables, settings] = await Promise.all([
      tx
        .select({ id: customers.id, name: customers.name, phone: customers.phone, address: customers.address })
        .from(customers)
        .where(and(eq(customers.companyId, ctx.company.id), eq(customers.id, customerId)))
        .limit(1),
      listReceivables(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
    ]);
    return { customer: customerRows[0] ?? null, receivables, settings };
  });
  if (!data.customer) notFound();

  const rows = data.receivables
    .filter((row) => row.customerId === customerId && row.outstanding > 0.004)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const totalOutstanding = rows.reduce((acc, row) => acc.plus(row.outstanding), d(0));
  const buckets = new Map<string, ReturnType<typeof d>>();
  for (const row of rows) {
    const base = row.dueDate ?? row.date;
    const days = Math.max(
      0,
      Math.round(
        (new Date(`${today}T00:00:00Z`).getTime() -
          new Date(`${String(base).slice(0, 10)}T00:00:00Z`).getTime()) /
          86_400_000,
      ),
    );
    const key = bucket(days > 0 && row.dueDate ? days : 0);
    buckets.set(key, (buckets.get(key) ?? d(0)).plus(row.outstanding));
  }

  const printSettings = toPrintSettings(data.settings, "statement");
  const qrDataUrl = printSettings.showQr
    ? await documentQrDataUrl(`AR-${data.customer.id.slice(0, 8).toUpperCase()}`)
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Link
          href="/app/pos/piutang"
          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" /> Kembali ke piutang
        </Link>
        <ReceiptPrint auto={params.autoprint === "1"} />
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={data.settings?.legalName ?? "Bisa Minimarket"}
            address={data.settings?.address}
            phone={data.settings?.phone}
            taxId={data.settings?.taxId}
            variant="document"
            title="Statement Piutang Pelanggan"
            number={data.customer.name}
            dateLabel={`Per ${formatDate(today)}`}
          />

          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px]">
            <div>
              <p className="text-black/60">Pelanggan</p>
              <p className="font-medium">{data.customer.name}</p>
              {data.customer.address ? <p className="whitespace-pre-line">{data.customer.address}</p> : null}
              {data.customer.phone ? <p className="num">Telp. {data.customer.phone}</p> : null}
            </div>
            <div>
              <p className="text-black/60">Total piutang</p>
              <p className="num text-[15px] font-bold">{formatIDR(totalOutstanding.toString())}</p>
              <p className="mt-1 text-black/60">Jumlah dokumen</p>
              <p className="font-medium">{rows.length} tagihan terbuka</p>
            </div>
          </div>

          <table className="mt-4 w-full text-[11px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="py-1.5 pr-2 font-semibold">Tanggal</th>
                <th className="py-1.5 pr-2 font-semibold">Dokumen</th>
                <th className="py-1.5 pr-2 font-semibold">Jatuh tempo</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Total</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Dibayar</th>
                <th className="py-1.5 pr-2 text-right font-semibold">Sisa</th>
                <th className="py-1.5 text-left font-semibold">Umur</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-black/60">
                    Tidak ada piutang terbuka.
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const base = row.dueDate ?? row.date;
                  const days = Math.max(
                    0,
                    Math.round(
                      (new Date(`${today}T00:00:00Z`).getTime() -
                        new Date(`${String(base).slice(0, 10)}T00:00:00Z`).getTime()) /
                        86_400_000,
                    ),
                  );
                  return (
                    <tr key={`${row.source}-${row.id}`} className="border-b border-black/10">
                      <td className="py-1 pr-2 whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="num py-1 pr-2">{row.number}</td>
                      <td className="py-1 pr-2 whitespace-nowrap">
                        {row.dueDate ? formatDate(row.dueDate) : "—"}
                      </td>
                      <td className="num py-1 pr-2 text-right">{formatIDR(row.total)}</td>
                      <td className="num py-1 pr-2 text-right">{formatIDR(row.paidTotal)}</td>
                      <td className="num py-1 pr-2 text-right font-medium">{formatIDR(row.outstanding)}</td>
                      <td className="py-1">{row.dueDate ? bucket(days) : "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-black">
                  <td colSpan={5} className="py-1.5 text-right font-semibold">
                    Total piutang
                  </td>
                  <td className="num py-1.5 pr-2 text-right font-bold">
                    {formatIDR(totalOutstanding.toString())}
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>

          {rows.length > 0 ? (
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] md:grid-cols-5">
              {["Belum jatuh tempo", "1–30 hari", "31–60 hari", "61–90 hari", "> 90 hari"].map((key) => (
                <div key={key} className="border border-black/20 px-2 py-1.5">
                  <p className="text-black/60">{key}</p>
                  <p className="num font-semibold">{formatIDR((buckets.get(key) ?? d(0)).toString())}</p>
                </div>
              ))}
            </div>
          ) : null}

          <p className="mt-3 text-[10px] leading-5 text-black/70">
            Statement ini merangkum tagihan terbuka per {formatDate(today)}. Pembayaran yang sudah
            diterima setelah tanggal tersebut mungkin belum tercermin. Cantumkan nomor dokumen pada
            bukti pembayaran.
          </p>

          <PrintFooter
            settings={printSettings}
            documentNumber={`AR-${data.customer.id.slice(0, 8).toUpperCase()}`}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={[{ label: "Dibuat oleh" }]}
          />
        </PrintShell>
      </div>
    </div>
  );
}