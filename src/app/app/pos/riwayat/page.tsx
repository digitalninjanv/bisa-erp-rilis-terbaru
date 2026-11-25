import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import { listSales, getSalesSummary } from "@/server/reports";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatNumber } from "@/lib/money";
import { formatDateTime, formatDate, todayISO, monthStartISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { DateRangeField } from "@/components/date-field";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { StatusBadge } from "@/components/blocks/status-badge";
import { Pagination } from "@/components/blocks/pagination";
import { FilterChips } from "@/components/blocks/search-form";
import { EmptyState } from "@/components/blocks/empty-state";
import { SaleRowActions } from "@/components/pos/sale-row-actions";

export const metadata = { title: "Riwayat transaksi" };
export const dynamic = "force-dynamic";

export default async function SalesHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; from?: string; to?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("pos.sell");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [list, summary] = await Promise.all([
      listSales(tx, {
        companyId: ctx.company.id,
        q: params.q,
        status: params.status,
        from,
        to,
        page: Number(params.page ?? 1),
        pageSize: 20,
      }),
      getSalesSummary(tx, ctx.company.id, {
        from: `${from}T00:00:00`,
        to: `${to}T23:59:59`,
      }),
    ]);
    return { list, summary };
  });

  return (
    <div>
      <PageHeader
        eyebrow="POS"
        title="Riwayat transaksi"
        description="Semua nota penjualan, status pembayaran, cetak ulang, retur, dan pembatalan dengan otorisasi."
        actions={
          <Link
            href="/app/pos"
            className="inline-flex h-11 items-center rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 lg:h-8"
          >
            Transaksi baru
          </Link>
        }
      />

      {/* A-25 U8: daftar memakai pola tunggal modul lain — KPI di
          slot DataList, satu toolbar (cari + rentang tanggal
          DateRangeField), chip status di bawahnya. A-22 K1 tetap
          berlaku: from/to TIDAK diteruskan sebagai hidden karena
          keduanya kontrol anak form (DateRangeField mengirim ISO
          lewat input tersembunyi bernama sama). Chip kini membawa
          param="status" + from/to (pola A-22 K6 di halaman akun &
          piutang-utang) — sebelumnya chip menulis parameter "filter"
          yang tidak pernah dibaca halaman ini, jadi chip tampil
          aktif tetapi tidak menyaring apa pun. Aksi baris tetap
          SaleRowActions (pemicu dialog void milik sendiri — batasan
          yang sama seperti daftar berdialog di U3/U4). */}
      <DataList
        kpis={
          <SummaryStrip
            items={[
              { label: "Transaksi", value: formatNumber(data.summary.transactions), hint: "Periode terpilih" },
              { label: "Penjualan", value: formatIDR(data.summary.total), hint: "Setelah diskon & pembulatan" },
              { label: "Diskon", value: formatIDR(data.summary.discount), hint: "Diskon baris & pelanggan" },
              { label: "Rata-rata / nota", value: formatIDR(data.summary.average), hint: "Nilai transaksi rata-rata" },
            ]}
          />
        }
        toolbar={
          <>
            <DataListToolbar
              action="/app/pos/riwayat"
              q={params.q}
              placeholder="Cari nomor nota atau pelanggan…"
              hidden={{ status: params.status }}
              resetHref={
                params.q || params.status || params.from || params.to ? "/app/pos/riwayat" : undefined
              }
            >
              <DateRangeField
                from={{ name: "from", defaultValue: from }}
                to={{ name: "to", defaultValue: to }}
              />
            </DataListToolbar>
            <div className="mt-2">
              <FilterChips
                basePath="/app/pos/riwayat"
                param="status"
                value={params.status}
                q={params.q}
                params={{ from, to }}
                options={[
                  { label: "Semua", value: "" },
                  { label: "Selesai", value: "completed" },
                  { label: "Ditahan", value: "held" },
                  { label: "Batal", value: "void" },
                  { label: "Retur", value: "returned" },
                ]}
              />
            </div>
          </>
        }
        isEmpty={data.list.rows.length === 0}
        empty={
          <EmptyState
            title="Belum ada transaksi"
            description="Transaksi yang dibuat di kasir akan muncul di sini lengkap dengan status dan aksi."
            action={
              <Link href="/app/pos" className="inline-flex min-h-11 items-center text-[12px] font-medium text-primary hover:underline">
                Mulai transaksi pertama
              </Link>
            }
          />
        }
        pagination={
          <Pagination
            page={data.list.page}
            pageSize={data.list.pageSize}
            total={data.list.total}
            basePath="/app/pos/riwayat"
            params={{ q: params.q, status: params.status, from, to }}
          />
        }
      >
        <div className="hidden overflow-x-auto lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Waktu</th>
                <th>Kasir</th>
                <th>Pelanggan</th>
                <th className="text-right">Item</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.list.rows.map((sale) => (
                <tr key={sale.id}>
                  <td>
                    <Link href={`/app/pos/nota/${sale.id}`} prefetch={false} className="num font-medium hover:underline">
                      {sale.number}
                    </Link>
                    <p className="text-[10px] text-muted-foreground">{formatDate(sale.date)}</p>
                  </td>
                  <td className="num whitespace-nowrap text-[12px] text-muted-foreground">
                    {formatDateTime(sale.createdAt)}
                  </td>
                  <td className="text-[12px]">{sale.cashierName ?? "—"}</td>
                  <td className="text-[12px]">{sale.customerName ?? "Umum"}</td>
                  <td className="num text-right text-[12px]">{formatNumber(sale.itemCount)}</td>
                  <td className="num text-right font-medium">{formatIDR(sale.total)}</td>
                  <td>
                    <div className="flex flex-wrap items-center gap-1">
                      <StatusBadge status={sale.status} />
                      {sale.paymentStatus !== "paid" && sale.status === "completed" ? (
                        <StatusBadge status={sale.paymentStatus} />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    <SaleRowActions
                      saleId={sale.id}
                      number={sale.number}
                      status={sale.status}
                      canVoid={can(ctx, "pos.void")}
                      canReturn={can(ctx, "pos.return")}
                      canReprint={can(ctx, "pos.receipt.reprint")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border/70 lg:hidden">
          {data.list.rows.map((sale) => (
            <div key={sale.id} className="px-4 py-3">
              <div className="flex items-baseline justify-between gap-2">
                <Link
                  href={`/app/pos/nota/${sale.id}`}
                  prefetch={false}
                  className="num inline-flex min-h-11 items-center text-[12px] font-medium text-primary hover:underline"
                >
                  {sale.number}
                </Link>
                <span className="num text-[12px] font-semibold">{formatIDR(sale.total)}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {formatDateTime(sale.createdAt)} · {sale.customerName ?? "Umum"} · {sale.itemCount} item
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <StatusBadge status={sale.status} />
                {sale.paymentStatus !== "paid" && sale.status === "completed" ? (
                  <StatusBadge status={sale.paymentStatus} />
                ) : null}
                <span className="ml-auto">
                  <SaleRowActions
                    saleId={sale.id}
                    number={sale.number}
                    status={sale.status}
                    canVoid={can(ctx, "pos.void")}
                    canReturn={can(ctx, "pos.return")}
                    canReprint={can(ctx, "pos.receipt.reprint")}
                  />
                </span>
              </div>
            </div>
          ))}
        </div>
      </DataList>
    </div>
  );
}
