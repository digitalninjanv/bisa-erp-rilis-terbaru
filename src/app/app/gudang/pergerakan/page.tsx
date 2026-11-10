import { withCompanyReadOnly } from "@/db/tenant";
import { listMovements, listWarehouses } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { formatIDR, formatQty } from "@/lib/money";
import {
  formatDateTime,
  movementReferenceHref,
  STOCK_MOVEMENT_TYPE_OPTIONS,
  stockMovementTypeLabel,
} from "@/lib/format";
import Link from "next/link";
import { PageHeader } from "@/components/blocks/page-header";
import { Pagination } from "@/components/blocks/pagination";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { DateRangeField } from "@/components/date-field";

export const metadata = { title: "Pergerakan stok" };
export const dynamic = "force-dynamic";



export default async function MovementsPage({
  searchParams,
}: {
  searchParams: Promise<{ warehouse?: string; type?: string; page?: string; q?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const warehouses = await listWarehouses(tx, ctx.company.id);
    const list = await listMovements(tx, {
      companyId: ctx.company.id,
      warehouseId: params.warehouse,
      type: params.type,
      q: params.q,
      from: params.from,
      to: params.to,
      page: parsePageParam(params.page),
      pageSize: 40,
    });
    return { warehouses, list };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Pergerakan stok"
        description="Jejak lengkap setiap perubahan stok: dokumen, alasan, pengguna, dan waktu."
      />

      {/* A-25 U3: daftar pergerakan memakai DataList bersama — bar
          filter menjadi DataListToolbar tunggal dan pasangan tanggal
          native diganti DateRangeField bersama (tampilan dd/mm/yyyy,
          nilai terkirim tetap ISO). Nomor referensi tetap tertaut ke
          dokumennya lewat movementReferenceHref (GDG-08). Bentuk
          pengambilan data tidak berubah (ARS1-01). */}
      <DataList density="compact"
        toolbar={
          /* A-22 K1 (UX-01): warehouse/type/from/to TIDAK diteruskan
             sebagai hidden — semuanya sudah menjadi kontrol anak form;
             hidden + anak bernama sama mengirim parameter dua kali. */
          <DataListToolbar
            action="/app/gudang/pergerakan"
            q={params.q}
            placeholder="Cari produk, SKU, atau nomor dokumen…"
            resetHref={
              params.q || params.warehouse || params.type || params.from || params.to
                ? "/app/gudang/pergerakan"
                : undefined
            }
          >
            <select name="warehouse" defaultValue={params.warehouse ?? ""} className={dataListFilterClass} aria-label="Gudang">
              <option value="">Semua gudang</option>
              {data.warehouses.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
            <select name="type" defaultValue={params.type ?? ""} className={dataListFilterClass} aria-label="Jenis">
              {STOCK_MOVEMENT_TYPE_OPTIONS.map((row) => (
                <option key={row.value} value={row.value}>{row.label}</option>
              ))}
            </select>
            <DateRangeField
              from={{ name: "from", defaultValue: params.from ?? "" }}
              to={{ name: "to", defaultValue: params.to ?? "" }}
            />
          </DataListToolbar>
        }
        isEmpty={data.list.rows.length === 0}
        empty={
          <EmptyState title="Belum ada pergerakan" description="Transaksi dan dokumen gudang akan tercatat di sini." />
        }
        pagination={
          <Pagination
            page={data.list.page}
            pageSize={data.list.pageSize}
            total={data.list.total}
            basePath="/app/gudang/pergerakan"
            params={{ warehouse: params.warehouse, type: params.type, q: params.q, from: params.from, to: params.to }}
          />
        }
      >
        {/* A-24 T3 (SIS-08): mode kartu di bawah lg, pola A-22. */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="data-table">
            <thead>
              <tr>
                <th>Waktu</th>
                <th>Produk</th>
                <th>Gudang</th>
                <th>Jenis</th>
                <th>Referensi</th>
                <th>Alasan</th>
                <th className="text-right">Qty</th>
                <th className="text-right">HPP</th>
              </tr>
            </thead>
            <tbody>
              {data.list.rows.map((row) => (
                <tr key={row.id}>
                  <td className="num whitespace-nowrap text-[11px] text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                  <td>
                    <p className="text-[12px] font-medium">{row.productName ?? "—"}</p>
                    <p className="num text-[10px] text-muted-foreground">{row.sku}</p>
                  </td>
                  <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                  <td className="text-[11px]">{stockMovementTypeLabel(row.movementType)}</td>
                  <td className="num text-[11px] text-muted-foreground">
                    {(() => {
                      const href = movementReferenceHref(row.referenceType, row.referenceId);
                      return href && row.referenceNumber ? (
                        <Link href={href} className="font-medium text-primary hover:underline">
                          {row.referenceNumber}
                        </Link>
                      ) : (
                        (row.referenceNumber ?? "—")
                      );
                    })()}
                  </td>
                  <td className="max-w-[200px] truncate text-[11px] text-muted-foreground">{row.reason ?? "—"}</td>
                  <td className={`num text-right font-medium ${Number(row.qty) < 0 ? "text-destructive" : "text-tone-green"}`}>
                    {/* S3: baris berkemasan menampilkan satuan masukan
                        dokumennya ("+2 Dus (80 Pcs)"); qty dasar tetap
                        angka ledgernya. */}
                    {row.packagingInputLabel
                      ? `${Number(row.qty) > 0 ? "+" : Number(row.qty) < 0 ? "-" : ""}${row.packagingInputLabel} (${formatQty(Math.abs(Number(row.qty)))}${row.unitName ? ` ${row.unitName}` : ""})`
                      : `${Number(row.qty) > 0 ? "+" : ""}${formatQty(row.qty)}`}
                    {row.countBreakdownLabel ? (
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        Hitungan: {row.countBreakdownLabel}
                      </span>
                    ) : null}
                  </td>
                  <td className="num text-right text-[11px] text-muted-foreground">{formatIDR(row.unitCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border/70 lg:hidden">
          {data.list.rows.map((row) => {
            const href = movementReferenceHref(row.referenceType, row.referenceId);
            return (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[12px] font-medium leading-5">{row.productName ?? "—"}</p>
                  <span className={`num shrink-0 text-[12px] font-semibold ${Number(row.qty) < 0 ? "text-destructive" : "text-tone-green"}`}>
                    {row.packagingInputLabel
                      ? `${Number(row.qty) > 0 ? "+" : Number(row.qty) < 0 ? "-" : ""}${row.packagingInputLabel} (${formatQty(Math.abs(Number(row.qty)))}${row.unitName ? ` ${row.unitName}` : ""})`
                      : `${Number(row.qty) > 0 ? "+" : ""}${formatQty(row.qty)}`}
                  </span>
                </div>
                {row.countBreakdownLabel ? (
                  <p className="num mt-0.5 text-[11px] text-muted-foreground">
                    Hitungan: {row.countBreakdownLabel}
                  </p>
                ) : null}
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {row.sku} · {stockMovementTypeLabel(row.movementType)} · {row.warehouseName ?? "—"}
                </p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDateTime(row.createdAt)}
                  {row.referenceNumber ? (
                    <>
                      {" · "}
                      {href ? (
                        <Link href={href} className="font-medium text-primary hover:underline">
                          {row.referenceNumber}
                        </Link>
                      ) : (
                        row.referenceNumber
                      )}
                    </>
                  ) : null}
                  {row.reason ? ` · ${row.reason}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      </DataList>
    </div>
  );
}
