import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatNumber } from "@/lib/money";
import { formatDate } from "@/lib/format";
import {
  PR_STATUS_LABELS,
  countPurchaseRequestsByStatus,
  listPurchaseRequestProductOptions,
  listPurchaseRequestsPage,
} from "@/server/purchase-requests";
import { listDepartmentOptions, listEmployeeOptions } from "@/server/hr";
import { LIST_PAGE_SIZE, parsePageParam } from "@/lib/pagination";
import { PageHeader } from "@/components/blocks/page-header";
import { StatCard } from "@/components/blocks/stat-card";
import { DataList } from "@/components/blocks/data-list";
import { Pagination } from "@/components/blocks/pagination";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PurchaseRequestForm } from "@/components/gudang/purchase-request-panel";

export const metadata = { title: "Permintaan pembelian" };
export const dynamic = "force-dynamic";

export default async function PurchaseRequestPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [requestsPage, statusCounts] = await Promise.all([
      listPurchaseRequestsPage(tx, ctx.company.id, {
        page: parsePageParam(params.page),
        pageSize: LIST_PAGE_SIZE,
      }),
      countPurchaseRequestsByStatus(tx, ctx.company.id),
    ]);
    const productRows = await listPurchaseRequestProductOptions(tx, ctx.company.id);
    const staff = await listEmployeeOptions(tx, ctx.company.id);
    const departmentRows = await listDepartmentOptions(tx, ctx.company.id);
    return { requestsPage, statusCounts, productRows, staff, departmentRows };
  });

  const canManage = can(ctx, "inventory.manage");
  const totalRequests = Object.values(data.statusCounts).reduce((acc, value) => acc + value, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Permintaan pembelian"
        description="Permintaan pembelian formal sebelum PO: diajukan, disahkan pengguna lain (maker-checker), lalu dikonversi sekali menjadi PO. Di atas ambang persetujuan perusahaan, pengesahan wajib peran senior."
        actions={
          canManage ? (
            <PurchaseRequestForm
              products={data.productRows}
              employees={data.staff}
              departments={data.departmentRows}
            />
          ) : null
        }
      />

      {/* A-25 U3 (DAFTAR-1): daftar memakai DataList bersama — judul
          kartu ganda "Semua Purchase Request" ditutup dan judul
          Inggris menjadi "Permintaan pembelian". G3 (TBL-01):
          daftar kini TERPAGINASI server (listPurchaseRequestsPage)
          dan KPI dihitung dari agregasi per status
          (countPurchaseRequestsByStatus) — angka KPI tidak berubah,
          hanya sumbernya bukan lagi daftar penuh di memori. Form
          buat permintaan tetap aksi utama di PageHeader. */}
      <DataList
        kpis={
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatCard label="Menunggu pengesahan" value={formatNumber(data.statusCounts.submitted ?? 0)} hint="Permintaan berstatus diajukan" icon={ClipboardList} tone="amber" />
            <StatCard label="Disahkan, belum PO" value={formatNumber(data.statusCounts.approved ?? 0)} hint="Siap dikonversi" tone="teal" />
            <StatCard label="Total permintaan" value={formatNumber(totalRequests)} hint="Semua status" tone="plum" />
            <StatCard label="Terkonversi" value={formatNumber(data.statusCounts.converted ?? 0)} hint="Sudah menjadi PO" tone="green" />
          </div>
        }
        isEmpty={data.requestsPage.rows.length === 0}
        empty={
          <EmptyState title="Belum ada permintaan pembelian" description={canManage ? "Ajukan permintaan pertama lewat tombol Permintaan baru." : "Peran Anda dapat melihat; permintaan pembelian dibuat oleh Staf Gudang, Manager, atau Pemilik."} />
        }
        pagination={
          <Pagination
            basePath="/app/gudang/purchase-request"
            page={data.requestsPage.page}
            pageSize={data.requestsPage.pageSize}
            total={data.requestsPage.total}
          />
        }
      >
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nomor</th>
                <th>Tanggal</th>
                <th>Peminta</th>
                <th>Departemen</th>
                <th className="text-right">Total perkiraan</th>
                <th>Status</th>
                <th>PO hasil</th>
              </tr>
            </thead>
            <tbody>
              {data.requestsPage.rows.map((row) => (
                <tr key={row.id}>
                  <td className="num text-[11px]">
                    <Link href={`/app/gudang/purchase-request/${row.id}`} className="font-medium hover:underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="text-[12px]">{formatDate(row.date)}</td>
                  <td className="text-[12px]">{row.requesterName ?? "—"}</td>
                  <td className="text-[11px] text-muted-foreground">{row.departmentName ?? "—"}</td>
                  <td className="num text-right text-[12px] font-medium">{formatIDR(row.totalEstimate)}</td>
                  <td>
                    <StatusBadge status={row.status} label={PR_STATUS_LABELS[row.status]} />
                  </td>
                  <td className="num text-[11px]">
                    {row.convertedPoId ? (
                      <Link href={`/app/gudang/pembelian/${row.convertedPoId}`} className="text-muted-foreground hover:underline">
                        Buka PO
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DataList>
    </div>
  );
}
