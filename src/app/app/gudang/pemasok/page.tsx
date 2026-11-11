import Link from "next/link";
import { ArrowDown, ArrowUp, Download, Upload } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { customerGroups } from "@/db/schema";
import { getSettings, listCustomersPage, listSuppliersPage } from "@/server/catalog";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatNumber } from "@/lib/money";
import { LIST_PAGE_SIZE, parsePageParam } from "@/lib/pagination";
import { PageHeader } from "@/components/blocks/page-header";
import { EmptyState } from "@/components/blocks/empty-state";
import { FilterChips } from "@/components/blocks/search-form";
import { DataList, DataListToolbar, dataListFilterClass } from "@/components/blocks/data-list";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { CustomerForm, CustomerRowActions, SupplierForm, SupplierRowActions } from "@/components/gudang/partner-forms";

export const metadata = { title: "Pemasok & pelanggan" };
export const dynamic = "force-dynamic";

type PartySortKey = "nama" | "kode";

/** Kepala kolom terurut (TBL-02): tautan pengalih arah + aria-sort. */
function PartySortHeader({
  label,
  href,
  active,
  dir,
}: {
  label: string;
  href: string;
  active: boolean;
  dir: "asc" | "desc";
}) {
  return (
    <th aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <Link href={href} className="inline-flex items-center gap-1 hover:text-foreground" aria-label={`Urutkan per ${label.toLowerCase()}`}>
        {label}
        {active ? (
          dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />
        ) : null}
      </Link>
    </th>
  );
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; status?: string; page?: string; urut?: string; arah?: string }>;
}) {
  const params = await searchParams;
  const tab = params.tab === "pelanggan" ? "pelanggan" : "pemasok";
  const ctx = await requirePermissionPage("inventory.view");
  const canManage = can(ctx, "inventory.manage");
  const canSell = can(ctx, "pos.sell");
  // S3 (§18F): filter daftar pihak — fungsi kondisi yang sama dipakai
  // rute ekspor (varian Filtered), jadi unduhan CSV selalu persis
  // mengikuti filter ini.
  const filter = { q: params.q, status: params.status };
  // G3 (TBL-01 + TBL-02): daftar pihak kini berpaginasi server dengan
  // ukuran baku LIST_PAGE_SIZE dan bisa diurutkan per nama/kode —
  // sebelumnya seluruh hasil filter dibaca sekaligus tanpa batas.
  const sort: PartySortKey = params.urut === "kode" ? "kode" : "nama";
  const dir: "asc" | "desc" = params.arah === "desc" ? "desc" : "asc";
  const page = parsePageParam(params.page);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const settings = await getSettings(tx, ctx.company.id);
    const [supplierPage, customerPage, supplierTotalPage, customerTotalPage] = await Promise.all([
      // Hanya tab aktif yang dibaca satu halaman penuh; tab lain cukup
      // berukuran 1 (barisnya tidak dirender).
      listSuppliersPage(tx, ctx.company.id, { ...filter, sort, dir, page, pageSize: tab === "pemasok" ? LIST_PAGE_SIZE : 1 }),
      listCustomersPage(tx, ctx.company.id, { ...filter, sort, dir, page, pageSize: tab === "pelanggan" ? LIST_PAGE_SIZE : 1 }),
      // Total tak-tersaring untuk label chip tab: bacaan halaman
      // berukuran 1 — server hanya menghitung (count) + 1 baris.
      listSuppliersPage(tx, ctx.company.id, { page: 1, pageSize: 1 }),
      listCustomersPage(tx, ctx.company.id, { page: 1, pageSize: 1 }),
    ]);
    const groups = await tx
      .select({ id: customerGroups.id, name: customerGroups.name })
      .from(customerGroups)
      .where(eq(customerGroups.companyId, ctx.company.id))
      .orderBy(asc(customerGroups.name));
    return {
      supplierPage,
      customerPage,
      supplierTotal: supplierTotalPage.total,
      customerTotal: customerTotalPage.total,
      groups,
      supplierFields: customFieldDefinitionsFor(settings?.customFields, "supplier"),
      customerFields: customFieldDefinitionsFor(settings?.customFields, "customer"),
    };
  });

  const exportQuery = new URLSearchParams({
    ...(params.q ? { q: params.q } : {}),
    ...(params.status ? { status: params.status } : {}),
  }).toString();

  const activePage = tab === "pemasok" ? data.supplierPage : data.customerPage;

  /** Kepala kolom terurut (TBL-02): klik mengalihkan arah; parameter
   * lain (tab/filter) dipertahankan, halaman kembali ke 1. */
  function sortHref(key: PartySortKey) {
    const nextDir = sort === key && dir === "asc" ? "desc" : "asc";
    const search = new URLSearchParams();
    search.set("tab", tab);
    if (params.q) search.set("q", params.q);
    if (params.status) search.set("status", params.status);
    search.set("urut", key);
    search.set("arah", nextDir);
    return `/app/gudang/pemasok?${search.toString()}`;
  }

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Pemasok & pelanggan"
        description="Data mitra bisnis untuk pembelian, utang usaha, piutang, dan diskon grup pelanggan."
        actions={
          <>
            <Link
              href={`${tab === "pemasok" ? "/api/export/suppliers" : "/api/export/customers"}?${exportQuery ? `${exportQuery}&` : ""}format=xlsx`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Download className="size-3.5" /> Unduh Excel
            </Link>
            <Link
              href={`/app/gudang/impor?jenis=${tab === "pemasok" ? "suppliers" : "customers"}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              <Upload className="size-3.5" /> Impor Excel
            </Link>
            <Link
              href="/app/gudang/pemasok/duplikat"
              className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
            >
              Cek duplikat
            </Link>
            {canManage ? (
              tab === "pemasok" ? (
                <SupplierForm customFields={data.supplierFields} />
              ) : (
                <CustomerForm groups={data.groups} customFields={data.customerFields} />
              )
            ) : null}
          </>
        }
      />

      {/* A-25 U3 (DAFTAR-1): daftar pihak memakai DataList bersama —
          tab jenis pihak menjadi chip di kepala kartu (SectionTitle
          bare, tanpa judul ganda), pencarian + filter status menyatu
          di DataListToolbar, dan status memakai StatusBadge bersama.
          G3: density compact (UX4-09), slot pagination terisi
          (TBL-01), aksi baris satu menu ⋯ (UX4-01), kepala kolom
          Nama/Kode terurut (TBL-02). */}
      <DataList
        density="compact"
        headerActions={
          <FilterChips
            basePath="/app/gudang/pemasok"
            param="tab"
            q={params.q}
            params={{ status: params.status, urut: params.urut, arah: params.arah }}
            value={tab === "pelanggan" ? "pelanggan" : ""}
            options={[
              { label: `Pemasok (${formatNumber(data.supplierTotal)})`, value: "" },
              { label: `Pelanggan (${formatNumber(data.customerTotal)})`, value: "pelanggan" },
            ]}
          />
        }
        toolbar={
          /* status TIDAK diteruskan sebagai hidden — ia sudah menjadi
             <select> anak di bawah (pelajaran A-22 K1: parameter ganda
             mengerror halaman). tab + urutan dipertahankan lewat
             hidden karena tidak ada kontrol anak bernama sama. */
          <DataListToolbar
            action="/app/gudang/pemasok"
            q={params.q}
            placeholder="Cari nama, kode, atau telepon…"
            hidden={{ tab, urut: sort, arah: dir }}
            resetHref={params.q || params.status ? `/app/gudang/pemasok?tab=${tab}` : undefined}
          >
            <select
              name="status"
              defaultValue={params.status ?? ""}
              className={dataListFilterClass}
              aria-label="Status"
            >
              <option value="">Semua status</option>
              <option value="aktif">Aktif</option>
              <option value="nonaktif">Nonaktif</option>
            </select>
          </DataListToolbar>
        }
        isEmpty={activePage.rows.length === 0}
        empty={
          tab === "pemasok" ? (
            <EmptyState title="Belum ada pemasok" description={canManage ? "Tambahkan pemasok untuk memulai pembelian." : "Peran Anda dapat melihat; pemasok dikelola oleh Staf Gudang, Manager, atau Pemilik."} />
          ) : (
            <EmptyState title="Belum ada pelanggan" description={canManage || canSell ? "Tambahkan pelanggan untuk transaksi tempo dan diskon grup." : "Peran Anda dapat melihat; pelanggan dikelola oleh Staf Gudang, Manager, atau Pemilik."} />
          )
        }
        pagination={
          <Pagination
            basePath="/app/gudang/pemasok"
            params={{ tab, q: params.q, status: params.status, urut: sort, arah: dir }}
            page={activePage.page}
            pageSize={activePage.pageSize}
            total={activePage.total}
          />
        }
        footerNote={
          <>
            Menampilkan {formatNumber(activePage.total)} hasil filter dari{" "}
            {formatNumber(tab === "pemasok" ? data.supplierTotal : data.customerTotal)}{" "}
            {tab === "pemasok" ? "pemasok" : "pelanggan"}.
          </>
        }
      >
        {tab === "pemasok" ? (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <PartySortHeader label="Kode" href={sortHref("kode")} active={sort === "kode"} dir={dir} />
                  <PartySortHeader label="Nama" href={sortHref("nama")} active={sort === "nama"} dir={dir} />
                  <th>Telepon</th>
                  <th>Email</th>
                  <th>Alamat</th>
                  <th>Status</th>
                  {canManage ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.supplierPage.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[12px]">{row.code}</td>
                    <td className="text-[12px] font-medium">
                      <Link href={`/app/gudang/pemasok/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="num text-[11px]">{row.phone ?? "—"}</td>
                    <td className="text-[11px]">{row.email ?? "—"}</td>
                    <td className="max-w-[260px] truncate text-[11px] text-muted-foreground">{row.address ?? "—"}</td>
                    <td>
                      <StatusBadge status={row.isActive ? "active" : "inactive"} />
                    </td>
                    {canManage ? (
                      <td>
                        <SupplierRowActions
                          customFields={data.supplierFields}
                          supplier={{
                            id: row.id,
                            code: row.code,
                            name: row.name,
                            phone: row.phone,
                            email: row.email,
                            address: row.address,
                            notes: row.notes,
                            taxId: row.taxId,
                            bankName: row.bankName,
                            bankAccountNumber: row.bankAccountNumber,
                            bankAccountName: row.bankAccountName,
                            paymentTermDays: row.paymentTermDays,
                            attributes: row.attributes ?? null,
                            isActive: row.isActive,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <PartySortHeader label="Kode" href={sortHref("kode")} active={sort === "kode"} dir={dir} />
                  <PartySortHeader label="Nama" href={sortHref("nama")} active={sort === "nama"} dir={dir} />
                  <th>Grup</th>
                  <th>Telepon</th>
                  <th className="text-right">Limit kredit</th>
                  <th>Status</th>
                  {canSell ? <th className="text-right">Aksi</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.customerPage.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num text-[12px]">{row.code}</td>
                    <td className="text-[12px] font-medium">
                      <Link href={`/app/gudang/pelanggan/${row.id}`} className="hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="text-[11px]">{row.groupName ?? "—"}</td>
                    <td className="num text-[11px]">{row.phone ?? "—"}</td>
                    <td className="num text-right text-[11px]">{formatIDR(row.creditLimit)}</td>
                    <td>
                      <StatusBadge status={row.isActive ? "active" : "inactive"} />
                    </td>
                    {canSell ? (
                      <td>
                        <CustomerRowActions
                          groups={data.groups}
                          customFields={data.customerFields}
                          customer={{
                            id: row.id,
                            code: row.code,
                            name: row.name,
                            phone: row.phone,
                            email: row.email,
                            address: row.address,
                            groupId: row.groupId,
                            creditLimit: row.creditLimit,
                            taxId: row.taxId,
                            paymentTermDays: row.paymentTermDays,
                            attributes: row.attributes ?? null,
                            isActive: row.isActive,
                          }}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DataList>
    </div>
  );
}
