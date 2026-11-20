import { withCompanyReadOnly } from "@/db/tenant";
import { listProductOptions, listWarehouseOptions } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/format";
import {
  RESERVATION_STATUS_LABELS,
  countReservationsSummary,
  getInTransitSummary,
  listReservationsPage,
} from "@/server/reservations";
import { LIST_PAGE_SIZE, parsePageParam } from "@/lib/pagination";
import { formatIDR, formatQty } from "@/lib/money";
import { PageHeader } from "@/components/blocks/page-header";
import { SummaryStrip } from "@/components/blocks/summary-strip";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { Pagination } from "@/components/blocks/pagination";
import {
  ReservationForm,
  ReservationReleaseButtons,
} from "@/components/gudang/reservation-panel";

export const metadata = { title: "Reservasi Stok" };
export const dynamic = "force-dynamic";

export default async function ReservasiPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  // G3 (TBL-01): daftar kini TERPAGINASI server dengan saringan kata
  // kunci di SQL (listReservationsPage) — pola lama membaca seluruh
  // daftar lalu menyaring & membaliknya di memori saat render sudah
  // ditutup. KPI aktif/total berasal dari agregasi
  // countReservationsSummary; angka tampil tidak berubah.
  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [reservationsPage, summary] = await Promise.all([
      listReservationsPage(tx, ctx.company.id, {
        q: params.q,
        page: parsePageParam(params.page),
        pageSize: LIST_PAGE_SIZE,
      }),
      countReservationsSummary(tx, ctx.company.id),
    ]);
    const inTransit = await getInTransitSummary(tx, ctx.company.id);
    const productRows = await listProductOptions(tx, ctx.company.id);
    const warehouseRows = await listWarehouseOptions(tx, ctx.company.id);
    return { reservationsPage, summary, inTransit, productRows, warehouseRows };
  });

  const canManage = can(ctx, "inventory.manage");
  const q = params.q?.trim() ?? "";
  const visible = data.reservationsPage.rows;

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Reservasi Stok"
        description="Reservasi menahan stok untuk penjualan yang akan datang: stok tersedia di POS berkurang, stok fisik dan ledger tidak berubah. Kedaluwarsa berlaku otomatis saat dibaca."
        actions={
          canManage ? (
            <ReservationForm products={data.productRows} warehouses={data.warehouseRows} />
          ) : null
        }
      />

      {/* A-25 U3: daftar reservasi memakai DataList bersama — kepala
          kartu "Semua reservasi" ditutup, ringkasan mengisi slot KPI
          (angka bermakna dari data tampil: aktif, in-transit, total),
          status selalu StatusBadge berlabel Indonesia, dan aksi baris
          (Rilis/Batalkan) masuk menu ⋯ di reservation-panel. G3:
          slot pagination DataList kini terisi. */}
      <DataList
        kpis={
          <SummaryStrip
            items={[
              {
                label: "Reservasi aktif",
                value: String(data.summary.active),
                hint: `${formatQty(data.summary.activeQty)} unit tertahan`,
                tone: data.summary.active > 0 ? "amber" : "default",
              },
              {
                label: "Dalam perjalanan",
                value: String(data.inTransit.documents),
                hint: "Transfer dua tahap belum diterima",
              },
              {
                label: "Nilai in-transit",
                value: formatIDR(data.inTransit.totalValue),
                hint: `${formatQty(data.inTransit.totalQty)} unit di perjalanan`,
              },
              {
                label: "Total reservasi",
                value: String(data.summary.total),
                hint: "Semua status",
                tone: "green",
              },
            ]}
          />
        }
        toolbar={
          <DataListToolbar
            action="/app/gudang/reservasi"
            q={params.q}
            placeholder="Cari nomor, produk, atau gudang…"
            resetHref={params.q ? "/app/gudang/reservasi" : undefined}
          />
        }
        pagination={
          <Pagination
            basePath="/app/gudang/reservasi"
            params={{ q: params.q }}
            page={data.reservationsPage.page}
            pageSize={data.reservationsPage.pageSize}
            total={data.reservationsPage.total}
          />
        }
        isEmpty={visible.length === 0}
        empty={
          <EmptyState
            title={q ? "Reservasi tidak ditemukan" : "Belum ada reservasi"}
            description={
              q
                ? "Ubah kata kunci pencarian."
                : canManage
                  ? "Buat reservasi pertama lewat tombol Reservasi Baru."
                  : "Peran Anda dapat melihat; reservasi dibuat oleh Staf Gudang, Manager, atau Pemilik."
            }
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Produk</th>
                <th>Gudang</th>
                <th className="text-right">Qty</th>
                <th>Berlaku sampai</th>
                <th>Alasan</th>
                <th>Status</th>
                {canManage ? (
                  <th className="w-10">
                    <span className="sr-only">Aksi</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="num text-[11px] text-muted-foreground">{row.number}</td>
                  <td className="text-[12px]">{formatDate(row.date)}</td>
                  <td className="text-[12px] font-medium">
                    {row.productName}
                    <span className="num ml-1.5 text-[10px] font-normal text-muted-foreground">{row.productSku}</span>
                  </td>
                  <td className="text-[11px] text-muted-foreground">{row.warehouseName}</td>
                  <td className="num text-right text-[12px] font-medium">{formatQty(row.qty)}</td>
                  <td className="text-[11px] text-muted-foreground">
                    {row.expiresAt ? formatDate(row.expiresAt.toISOString().slice(0, 10)) : "—"}
                  </td>
                  <td className="max-w-[200px] truncate text-[11px] text-muted-foreground">{row.reason ?? "—"}</td>
                  <td>
                    <StatusBadge status={row.effectiveStatus} label={RESERVATION_STATUS_LABELS[row.effectiveStatus]} />
                  </td>
                  {canManage ? (
                    <td>
                      {row.effectiveStatus === "active" ? (
                        <ReservationReleaseButtons id={row.id} number={row.number} />
                      ) : (
                        <span className="block text-right text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
