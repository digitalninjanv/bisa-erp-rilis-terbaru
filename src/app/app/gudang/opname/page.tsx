import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listCategories,
  listDocumentHistory,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import {
  listOpnameAssigneeOptions,
  listOpnameTasks,
} from "@/server/inventory";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { formatDate, todayISO } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { OpnameForm } from "@/components/gudang/opname-form";
import { OpnameTasksPanel } from "@/components/gudang/opname-tasks-panel";
import { StockDocumentRowActions } from "@/components/gudang/void-buttons";
import { FilterChips } from "@/components/blocks/search-form";

export const metadata = { title: "Stok opname" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

type OpnameTab = "hitung" | "tugas" | "riwayat";

const TABS: { key: OpnameTab; label: string }[] = [
  { key: "hitung", label: "Hitung opname" },
  { key: "tugas", label: "Tugas" },
  { key: "riwayat", label: "Riwayat" },
];

/**
 * A-25 U3 — opname dipecah PER PEKERJAAN (AUDIT-UI-A25 §5 halaman
 * terburuk #2 + POLA-01): dulu tugas + form hitung + riwayat tertumpuk
 * terbuka dalam satu gulir. Kini tiga tab berpindah yang jelas —
 * pekerjaan harian (lembar hitung / form hitung) adalah bawaan, tugas
 * dan riwayat di tabnya sendiri. Tab adalah parameter URL (?tab=)
 * agar tautan lama tetap bekerja: kartu tugas & Mode Operasi menautkan
 * ?warehouse= (masuk tab Hitung), beranda menautkan ?tab=tugas.
 */
export default async function OpnamePage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    q?: string;
    warehouse?: string;
    tab?: string;
    status?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const tab: OpnameTab =
    params.tab === "tugas" ? "tugas" : params.tab === "riwayat" ? "riwayat" : "hitung";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, settings, history, tasks, assignees, categories] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      listDocumentHistory(tx, {
        companyId: ctx.company.id,
        types: ["opname"],
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
        status: params.status,
      }),
      // A-24 T3 (G3): tugas opname — lapisan penugasan di atas domain.
      listOpnameTasks(tx, ctx.company.id),
      listOpnameAssigneeOptions(tx, ctx.company.id),
      listCategories(tx, ctx.company.id),
    ]);
    return {
      warehouseRows,
      docs: history.rows,
      history,
      tasks,
      assignees,
      categories,
      // ?warehouse= (dari kartu tugas / Mode Operasi) mengalahkan
      // gudang bawaan pengaturan — pola yang sama seperti lembar hitung.
      defaultWarehouseId:
        warehouseRows.find((row) => row.id === params.warehouse)?.id ??
        pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
    };
  });

  const openTaskCount = data.tasks.filter((task) => task.status === "open").length;

  function tabHref(key: OpnameTab) {
    const query = new URLSearchParams();
    if (params.warehouse) query.set("warehouse", params.warehouse);
    if (key !== "hitung") query.set("tab", key);
    const suffix = query.toString();
    return suffix ? `/app/gudang/opname?${suffix}` : "/app/gudang/opname";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Stok opname"
        description="Hitung fisik stok dan posting selisihnya. Setiap selisih tercatat dengan alasan dan pengguna."
      />

      <nav
        aria-label="Pekerjaan opname"
        className="mb-4 inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5"
      >
        {TABS.map((item) => (
          <Link
            key={item.key}
            href={tabHref(item.key)}
            aria-current={tab === item.key ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[12px] transition-colors",
              tab === item.key
                ? "bg-card font-semibold text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {item.key === "tugas" && openTaskCount > 0 ? (
              <span className="num rounded-full bg-tone-amber-soft px-1.5 py-0.5 text-[10px] font-semibold text-tone-amber">
                {openTaskCount}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      {tab === "tugas" ? (
        <OpnameTasksPanel
          embedded
          tasks={data.tasks.map((task) => ({
            id: task.id,
            warehouseId: task.warehouseId,
            warehouseName: task.warehouseName,
            categoryId: task.categoryId,
            categoryName: task.categoryName,
            assigneeId: task.assigneeId,
            assigneeName: task.assigneeName,
            dueDate: task.dueDate,
            status: task.status,
            documentId: task.documentId,
            documentNumber: task.documentNumber,
            notes: task.notes,
          }))}
          canManage={can(ctx, "inventory.manage")}
          currentUserId={ctx.user.id}
          warehouses={data.warehouseRows}
          categories={data.categories}
          assignees={data.assignees}
          today={todayISO()}
        />
      ) : null}

      {tab === "hitung" ? (
        can(ctx, "inventory.manage") && data.warehouseRows.length > 0 ? (
          <OpnameForm companyId={ctx.company.id} warehouses={data.warehouseRows} defaultWarehouseId={data.defaultWarehouseId} today={todayISO()} />
        ) : can(ctx, "inventory.manage") ? (
          <GateNotice>
            {can(ctx, "settings.manage")
              ? "Tambahkan gudang terlebih dahulu di menu Pengaturan."
              : "Belum ada gudang terdaftar. Gudang diatur oleh pemilik/admin di menu Pengaturan."}
          </GateNotice>
        ) : (
          <GateNotice>{viewModeText("stok opname")}</GateNotice>
        )
      ) : null}

      {tab === "riwayat" ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <FilterChips
            options={[
              { label: "Semua", value: "" },
              { label: "Menunggu", value: "pending" },
              { label: "Terposting", value: "posted" },
              { label: "Dibatalkan", value: "void" },
            ]}
            value={params.status ?? ""}
            basePath="/app/gudang/opname"
            param="status"
            q={params.q}
            params={{ tab: "riwayat" }}
          />
        </div>
      ) : null}
      {tab === "riwayat" ? (
        <DataList
          toolbar={
            <DataListToolbar
              action="/app/gudang/opname"
              q={params.q}
              placeholder="Cari nomor dokumen atau catatan…"
              hidden={{ tab: "riwayat" }}
              resetHref={
                params.q || params.status ? "/app/gudang/opname?tab=riwayat" : undefined
              }
            />
          }
          isEmpty={data.docs.length === 0}
          empty={
            <EmptyState title="Belum ada opname" description="Dokumen opname yang terposting akan tampil di sini." />
          }
          pagination={
            <Pagination
              page={data.history.page}
              pageSize={data.history.pageSize}
              total={data.history.total}
              basePath="/app/gudang/opname"
              params={{ q: params.q, tab: "riwayat", status: params.status }}
            />
          }
        >
          {/* A-24 T3 (SIS-08): mode kartu di bawah lg, pola A-22. */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Tanggal</th>
                  <th>Gudang</th>
                  <th className="text-right">Item</th>
                  <th>Catatan</th>
                  <th>Status</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {data.docs.map((row) => (
                  <tr key={row.id}>
                    <td className="num font-medium">
                      <Link href={`/app/gudang/dokumen/${row.id}`} className="text-primary hover:underline">
                        {row.number}
                      </Link>
                    </td>
                    <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                    <td className="text-[12px]">{row.warehouseName ?? "—"}</td>
                    <td className="num text-right text-[11px]">{Number(row.itemCount)}</td>
                    <td className="max-w-[280px] truncate text-[11px] text-muted-foreground">{row.notes ?? row.reason ?? "—"}</td>
                    <td>
                      {row.status === "void" ? (
                        <StatusBadge status="void" label="Dibatalkan" />
                      ) : (
                        <StatusBadge status={row.status} />
                      )}
                    </td>
                    <td>
                      {row.status === "posted" && can(ctx, "inventory.manage") ? (
                        <StockDocumentRowActions id={row.id} number={row.number} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border/70 lg:hidden">
            {data.docs.map((row) => (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/app/gudang/dokumen/${row.id}`} className="num text-[12px] font-medium text-primary hover:underline">
                    {row.number}
                  </Link>
                  <span className="num text-[11px] text-muted-foreground">{Number(row.itemCount)} item</span>
                </div>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(row.date)} · {row.warehouseName ?? "—"}
                </p>
                {row.notes ?? row.reason ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {row.notes ?? row.reason}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {row.status === "void" ? (
                    <StatusBadge status="void" label="Dibatalkan" />
                  ) : (
                    <StatusBadge status={row.status} />
                  )}
                  <span className="ml-auto">
                    {row.status === "posted" && can(ctx, "inventory.manage") ? (
                      <StockDocumentRowActions id={row.id} number={row.number} />
                    ) : null}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DataList>
      ) : null}
    </div>
  );
}
