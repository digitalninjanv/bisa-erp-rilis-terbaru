import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSaleDetail, listSales } from "@/server/reports";
import {
  getOpenCashSession,
  getReturnedQtyBySaleLine,
  listRecentSaleReturns,
} from "@/server/pos";
import { requirePermissionPage } from "@/lib/session";
import { formatIDR } from "@/lib/money";
import { parsePageParam } from "@/lib/pagination";
import { formatDate, formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ReturnForm } from "@/components/pos/return-form";

export const metadata = { title: "Retur penjualan" };
export const dynamic = "force-dynamic";

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<{ sale?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("pos.return");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const recent = await listSales(tx, {
      companyId: ctx.company.id,
      status: "completed",
      q: params.q,
      page: parsePageParam(params.page),
      pageSize: 20,
    });
    const history = await listRecentSaleReturns(tx, ctx.company.id);

    // Sesi terbuka milik kasir pemroses: refund tunai dicatat ke sesi ini
    // (D-8), jadi form perlu tahu apakah sesi itu ada.
    const openSession = await getOpenCashSession(tx, ctx.company.id, ctx.user.id);

    let detail: Awaited<ReturnType<typeof getSaleDetail>> = null;
    let returned = new Map<string, number>();
    if (params.sale) {
      detail = await getSaleDetail(tx, ctx.company.id, params.sale);
      if (detail) {
        // S4: sisa retur dihitung PER BARIS ASAL — penjualan campuran
        // Dus + Pcs produk yang sama memiliki dua sisa kemasan
        // yang berbeda dan tidak boleh saling menghabiskan.
        returned = await getReturnedQtyBySaleLine(tx, ctx.company.id, params.sale);
      }
    }
    return { recent, history, detail, returned, openSession };
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Retur penjualan"
        description="Retur, tukar barang, dan pengembalian dana dengan pembalik stok serta jurnal otomatis."
      />

      {data.detail ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
          <ReturnForm
            saleId={data.detail.sale.id}
            number={data.detail.sale.number}
            outstandingReceivable={
              data.detail.sale.paymentStatus === "unpaid" || data.detail.sale.paymentStatus === "partial"
                ? Math.max(0, Number(data.detail.sale.total) - Number(data.detail.sale.paidTotal))
                : 0
            }
            cashSession={
              data.openSession ? { openedAtLabel: formatDateTime(data.openSession.openedAt) } : null
            }
            lines={data.detail.lines.map((line) => {
              const isi = Number(line.isiSnapshot) || 1;
              const remainingBase = Math.max(0, Number(line.qty) - (data.returned.get(line.id) ?? 0));
              return {
                // S4: retur diteruskan per baris asal; qty & sisa
                // dinyatakan dalam BENTUK MASUKAN baris asal
                // ("1 Dus"), harga per kemasan asal.
                saleLineId: line.id,
                productId: line.productId,
                productName: line.productName,
                packagingName: line.packagingName,
                qty: Number(line.qtyInput),
                remaining: remainingBase / isi,
                unitPrice: Number(line.unitPrice) * isi,
                // lineTotal sudah termasuk pajak; estimasi refund di form
                // diturunkan dari nilai ini (POS-RCPT-01).
                lineTotal: Number(line.lineTotal),
              };
            })}
          />
          <aside className="space-y-3">
            <div className="rounded-lg border border-border bg-card p-4 text-[12px]">
              <h2 className="text-[13px] font-semibold">Ringkasan transaksi asal</h2>
              <dl className="mt-2 space-y-1.5">
                <Row label="Nomor" value={data.detail.sale.number} />
                <Row label="Tanggal" value={formatDateTime(data.detail.sale.createdAt)} />
                <Row label="Kasir" value={data.detail.cashier?.name ?? "—"} />
                <Row label="Pelanggan" value={data.detail.customer?.name ?? "Umum"} />
                <Row label="Total" value={formatIDR(data.detail.sale.total)} />
                {data.detail.sale.paymentStatus === "unpaid" || data.detail.sale.paymentStatus === "partial" ? (
                  <>
                    <Row label="Terbayar" value={formatIDR(data.detail.sale.paidTotal)} />
                    <Row
                      label="Sisa piutang"
                      value={formatIDR(Number(data.detail.sale.total) - Number(data.detail.sale.paidTotal))}
                    />
                  </>
                ) : null}
              </dl>
              <Link href="/app/pos/retur" className="mt-3 block text-center text-[11px] text-muted-foreground underline">
                Pilih transaksi lain
              </Link>
            </div>
          </aside>
        </div>
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Pilih transaksi yang akan diretur</h2>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Cari nomor nota atau nama pelanggan. Retur selalu mengacu ke transaksi asal.
            </p>
          </div>
          <div className="border-b border-border px-3 py-2.5">
            <DataListToolbar
              action="/app/pos/retur"
              q={params.q}
              placeholder="Cari nomor nota atau pelanggan…"
              resetHref={params.q ? "/app/pos/retur" : undefined}
            />
          </div>
          {data.recent.rows.length === 0 ? (
            <EmptyState title="Transaksi tidak ditemukan" description="Ubah kata kunci atau selesaikan transaksi di kasir terlebih dahulu." />
          ) : (
            <>
              <div className="hidden overflow-x-auto sm:block">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Nota</th>
                      <th>Tanggal</th>
                      <th>Pelanggan</th>
                      <th className="text-right">Item</th>
                      <th className="text-right">Total</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.rows.map((sale) => (
                      <tr key={sale.id}>
                        <td className="num font-medium">{sale.number}</td>
                        <td className="num text-[11px] text-muted-foreground">{formatDateTime(sale.createdAt)}</td>
                        <td className="text-[12px]">{sale.customerName ?? "Umum"}</td>
                        <td className="num text-right text-[11px]">{sale.itemCount}</td>
                        <td className="num text-right font-medium">{formatIDR(sale.total)}</td>
                        <td className="text-right">
                          <Link
                            href={`/app/pos/retur?sale=${sale.id}`}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
                          >
                            <RotateCcw className="size-3" /> Retur
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-border/70 sm:hidden">
                {data.recent.rows.map((sale) => (
                  <Link
                    key={sale.id}
                    href={`/app/pos/retur?sale=${sale.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p className="num text-[12px] font-medium">{sale.number}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatDateTime(sale.createdAt)} · {sale.customerName ?? "Umum"} · {sale.itemCount} item
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="num text-[12px] font-semibold">{formatIDR(sale.total)}</span>
                      <RotateCcw className="size-3.5 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
              <Pagination
                page={data.recent.page}
                pageSize={data.recent.pageSize}
                total={data.recent.total}
                basePath="/app/pos/retur"
                params={{ q: params.q }}
              />
            </>
          )}
        </section>
      )}

      {/* A-25 U8: tabel riwayat memakai DataList bersama; judul
          seksi berdiri di atas kartu. Bagian pemilih transaksi di
          atas tetap seksi alur (bukan daftar) seperti sebelumnya. */}
      <div className="mt-4">
        <div className="mb-2 flex items-end justify-between gap-2">
          <h2 className="text-[13px] font-semibold">Riwayat retur</h2>
          <span className="text-[11px] text-muted-foreground">20 retur terbaru</span>
        </div>
        <DataList
          isEmpty={data.history.length === 0}
          empty={
            <EmptyState title="Belum ada retur" description="Retur yang diproses akan tercatat di sini." />
          }
        >
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Nota asal</th>
                  <th>Jenis</th>
                  <th>Pengembalian</th>
                  <th>Alasan</th>
                  <th className="text-right">Nilai</th>
                  <th className="text-right">Kredit terpakai</th>
                  <th className="text-right">Sisa kredit</th>
                </tr>
              </thead>
              <tbody>
                {data.history.map((row) => {
                  // D-12: hanya retur tukar barang/kredit toko yang
                  // melahirkan kredit yang dapat ditebus.
                  const hasCredit = row.refundMethod === "exchange" || row.refundMethod === "store_credit";
                  return (
                    <tr key={row.id}>
                      <td className="num font-medium">{row.number}</td>
                      <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                      <td className="num text-[12px]">{row.saleNumber}</td>
                      <td className="text-[12px]">{row.type === "exchange" ? "Tukar barang" : "Retur"}</td>
                      <td className="text-[12px]">{refundLabel(row.refundMethod)}</td>
                      <td className="max-w-[220px] truncate text-[12px] text-muted-foreground">{row.reason}</td>
                      <td className="num text-right font-medium">{formatIDR(row.total)}</td>
                      <td className="num text-right text-[12px]">{hasCredit ? formatIDR(row.creditUsed) : "—"}</td>
                      <td className="num text-right text-[12px] font-medium">
                        {hasCredit ? formatIDR(Number(row.total) - Number(row.creditUsed)) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DataList>
      </div>
    </div>
  );
}

function refundLabel(method: string) {
  return (
    {
      cash: "Tunai",
      transfer: "Transfer",
      store_credit: "Kredit toko (kredit pelanggan)",
      exchange: "Tukar barang (kredit pelanggan)",
    }[method] ?? method
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
