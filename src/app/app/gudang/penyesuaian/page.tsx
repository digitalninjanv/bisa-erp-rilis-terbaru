import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  getSettings,
  listDocumentHistory,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { resolveAdjustmentReasons } from "@/lib/adjustment-reasons";
import { formatIDR } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { StatusBadge } from "@/components/blocks/status-badge";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { AdjustmentForm } from "@/components/gudang/adjustment-form";
import { StockDocumentRowActions } from "@/components/gudang/void-buttons";
import { FilterChips } from "@/components/blocks/search-form";
import {
  AdjustmentApproveButton,
  AdjustmentCancelButton,
  AdjustmentRejectButton,
} from "@/components/gudang/approval-buttons";

export const metadata = { title: "Penyesuaian stok" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;
// GD-P2-2: documents now store their original type, so the adjustment
// family must be listed explicitly or damaged / expired / lost / quarantine
// documents would vanish from this history (their labels below already know
// these types).
const ADJUSTMENT_TYPES = [
  "adjustment",
  "purchase_return",
  "damaged",
  "expired",
  "lost",
  "quarantine",
];

export default async function AdjustmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; status?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, settings, history] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      listDocumentHistory(tx, {
        companyId: ctx.company.id,
        types: ADJUSTMENT_TYPES,
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
        status: params.status,
      }),
    ]);
    return {
      warehouseRows,
      docs: history.rows,
      history,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
      approvalThreshold: settings?.adjustmentApprovalThreshold ?? null,
      adjustmentReasons: resolveAdjustmentReasons(settings?.adjustmentReasons),
    };
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Penyesuaian & barang keluar"
        description="Catat barang rusak, kedaluwarsa, hilang, dan karantina dengan alasan serta dokumen. Retur ke pemasok dicatat dari menu Retur Pembelian."
      />

      {/* FIX-GDG Tahap 3 (GDG3-10): perusahaan warisan yang ambangnya
          masih kosong tidak diubah diam-diam oleh migrasi — peringatan
          ini adalah pengingat sadarnya sampai pemilik mengisi ambang
          (atau membiarkannya nonaktif dengan mengetahui risikonya). */}
      {data.approvalThreshold === null && can(ctx, "inventory.manage") ? (
        <div className="mt-3 rounded-md border border-tone-amber/40 bg-tone-amber-soft px-3 py-2 text-[11px] leading-5 text-tone-amber">
          <span className="font-semibold">Persetujuan penyesuaian stok NONAKTIF.</span>{" "}
          Perusahaan ini belum memiliki ambang persetujuan, sehingga penyesuaian stok bernilai
          berapa pun — termasuk penghapusan barang rusak/hilang — langsung terposting oleh
          pembuatnya tanpa pemeriksaan pengguna kedua. Perusahaan baru otomatis berambang
          Rp1.000.000; perusahaan lama tidak diubah tanpa keputusan pemilik.{" "}
          {can(ctx, "settings.manage") ? (
            <Link href="/app/pengaturan" className="font-medium underline">
              Atur ambang persetujuan di Pengaturan
            </Link>
          ) : (
            "Minta pemilik/admin mengaktifkan ambang persetujuan di Pengaturan."
          )}
        </div>
      ) : null}

      {can(ctx, "inventory.manage") && data.warehouseRows.length > 0 ? (
        <AdjustmentForm
          warehouses={data.warehouseRows}
          defaultWarehouseId={data.defaultWarehouseId}
          today={todayISO()}
          approvalThreshold={data.approvalThreshold}
          reasons={data.adjustmentReasons}
        />
      ) : can(ctx, "inventory.manage") ? (
        <GateNotice>
          {can(ctx, "settings.manage")
            ? "Tambahkan gudang terlebih dahulu di menu Pengaturan."
            : "Belum ada gudang terdaftar. Gudang diatur oleh pemilik/admin di menu Pengaturan."}
        </GateNotice>
      ) : (
        <GateNotice>{viewModeText("penyesuaian stok")}</GateNotice>
      )}

      {/* A-25 U3: riwayat penyesuaian memakai DataList bersama — bar
          pencarian terpisah di atas kartu dan kepala kartu "Riwayat
          penyesuaian" digabung ke DataListToolbar di dalam bingkai.
          GDG-07: teks keadaan kosong dibetulkan — sebelumnya salah
          menyebut "retur pembelian" (sisa salin-tempel). Tombol aksi
          baris (batalkan/setujui/tolak) tetap komponen bersama
          void-buttons/approval-buttons apa adanya. Bentuk pengambilan
          data tidak berubah (ARS1-01). */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          options={[
            { label: "Semua", value: "" },
            { label: "Menunggu persetujuan", value: "pending" },
            { label: "Terposting", value: "posted" },
            { label: "Ditolak", value: "rejected" },
            { label: "Dibatalkan", value: "void" },
          ]}
          value={params.status ?? ""}
          basePath="/app/gudang/penyesuaian"
          param="status"
          q={params.q}
        />
        {params.status === "pending" ? (
          <p className="text-[11px] text-muted-foreground">
            Menunggu pemeriksa kedua — setujui atau tolak dari kolom aksi.
          </p>
        ) : null}
      </div>
      <div className="mt-3">
        <DataList
          toolbar={
            <DataListToolbar
              action="/app/gudang/penyesuaian"
              q={params.q}
              placeholder="Cari nomor dokumen atau catatan…"
              resetHref={
                params.q || params.status ? "/app/gudang/penyesuaian" : undefined
              }
            />
          }
          isEmpty={data.docs.length === 0}
          empty={
            <EmptyState
              title="Belum ada penyesuaian"
              description="Dokumen penyesuaian stok — barang rusak, kedaluwarsa, hilang, dan karantina — akan tampil di sini."
            />
          }
          pagination={
            <Pagination
              page={data.history.page}
              pageSize={data.history.pageSize}
              total={data.history.total}
              basePath="/app/gudang/penyesuaian"
              params={{ q: params.q, status: params.status }}
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
                  <th>Jenis</th>
                  <th>Gudang</th>
                  <th>Alasan</th>
                  <th className="text-right">Item</th>
                  {canSeeCost ? <th className="text-right">Nilai</th> : null}
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
                    <td className="text-[12px]">{typeLabel(row.type)}</td>
                    <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                    <td className="max-w-[260px] truncate text-[12px] text-muted-foreground">
                      {row.reason}
                      {row.supplierName ? ` · ${row.supplierName}` : ""}
                      {row.refundMethod ? ` · ${refundLabel(row.refundMethod)}` : ""}
                      {row.status === "rejected" && row.rejectionReason
                        ? ` · Ditolak: ${row.rejectionReason}`
                        : ""}
                    </td>
                    <td className="num text-right text-[11px]">{Number(row.itemCount)}</td>
                    {canSeeCost ? <td className="num text-right font-medium">{formatIDR(row.total)}</td> : null}
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
                      ) : row.status === "pending" && can(ctx, "inventory.manage") ? (
                        row.createdBy === ctx.user.id ? (
                          <AdjustmentCancelButton id={row.id} number={row.number} />
                        ) : (
                          <div className="flex gap-1">
                            <AdjustmentApproveButton id={row.id} number={row.number} />
                            <AdjustmentRejectButton id={row.id} number={row.number} />
                          </div>
                        )
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
                  {canSeeCost ? <span className="num text-[12px] font-semibold">{formatIDR(row.total)}</span> : null}
                </div>
                <p className="mt-0.5 text-[12px]">
                  {typeLabel(row.type)}
                  <span className="text-muted-foreground"> · {row.warehouseName ?? "—"}</span>
                </p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(row.date)} · {Number(row.itemCount)} item
                </p>
                {row.reason ? (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                    {row.reason}
                    {row.supplierName ? ` · ${row.supplierName}` : ""}
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
                    ) : row.status === "pending" && can(ctx, "inventory.manage") ? (
                      row.createdBy === ctx.user.id ? (
                        <AdjustmentCancelButton id={row.id} number={row.number} />
                      ) : (
                        <span className="flex gap-1">
                          <AdjustmentApproveButton id={row.id} number={row.number} />
                          <AdjustmentRejectButton id={row.id} number={row.number} />
                        </span>
                      )
                    ) : null}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </DataList>
      </div>
    </div>
  );
}

function typeLabel(type: string) {
  return (
    {
      adjustment: "Penyesuaian",
      purchase_return: "Retur pembelian",
      damaged: "Barang rusak",
      expired: "Kedaluwarsa",
      lost: "Hilang",
      quarantine: "Karantina",
    }[type] ?? type
  );
}

function refundLabel(value: string) {
  return (
    {
      cash: "Tunai",
      credit_note: "Nota kredit",
      replacement: "Penggantian",
      deduction: "Potong utang",
    }[value] ?? value
  );
}
