import Link from "next/link";
import { withCompanyReadOnly } from "@/db/tenant";
import { getAccountMap, listPaymentAccounts } from "@/server/accounting";
import { getPurchaseOrderSupplier } from "@/server/purchasing";
import { RECEIPT_SOURCE_LABELS } from "@/server/inventory";
import {
  getSettings,
  listReceiptHistory,
  listSuppliers,
  listWarehouses,
  pickDefaultWarehouseId,
} from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { can } from "@/lib/permissions";
import { formGateState } from "@/lib/form-gate";
import { GateNotice, viewModeText } from "@/components/blocks/gate-notice";
import { formatIDR, formatNumber } from "@/lib/money";
import { formatDate, todayISO } from "@/lib/format";
import { PageHeader } from "@/components/blocks/page-header";
import { DataList, DataListToolbar } from "@/components/blocks/data-list";
import { StatusBadge } from "@/components/blocks/status-badge";
import { EmptyState } from "@/components/blocks/empty-state";
import { Pagination } from "@/components/blocks/pagination";
import { ReceiptForm } from "@/components/gudang/receipt-form";
import { ReceiptRowActions } from "@/components/gudang/void-buttons";

export const metadata = { title: "Penerimaan barang" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 40;

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string; po?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouseRows, supplierRows, settings, history, mappings, paymentAccounts] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      listSuppliers(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      listReceiptHistory(tx, {
        companyId: ctx.company.id,
        page: parsePageParam(params.page),
        pageSize: PAGE_SIZE,
        q: params.q,
      }),
      getAccountMap(tx, ctx.company.id),
      // Cash-purchase payment accounts follow the project's payment pattern
      // (piutang-utang page): the accounts mapped as cash / bank / qris.
      listPaymentAccounts(tx, ctx.company.id),
    ]);
    // FIX-GDG Tahap 4 (GDG2-15): tautan "Terima barang" dari detail PO
    // membawa ?po=<id> — selesaikan pemasoknya di server agar form
    // penerimaan terbuka dengan PO tertaut (baris diisi klien dari
    // daftar PO terbuka pemasok itu, jalur yang sama seperti memilih
    // PO manual).
    const initialPurchaseOrder = params.po
      ? await getPurchaseOrderSupplier(tx, ctx.company.id, params.po)
      : null;

    return {
      warehouseRows,
      supplierRows,
      receipts: history.rows,
      history,
      paymentAccounts,
      defaultWarehouseId: pickDefaultWarehouseId(warehouseRows, settings?.defaultWarehouseId),
      // FIX-P1 Tahap 4 (AK4-04): tarif PPN efektif + status pemetaan
      // PPN Masukan untuk opsi "harga termasuk PPN" di formulir.
      taxRate: settings?.taxEnabled ? (settings?.taxRate ?? "0") : "0",
      taxInputMapped: Boolean(mappings.tax_input),
      initialPurchaseOrder,
    };
  });

  const gate = formGateState({
    canManage: can(ctx, "inventory.manage"),
    available: data.warehouseRows.length,
  });

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Penerimaan barang"
        description="Catat barang masuk dari pembelian (kredit atau tunai), stok awal, bonus, atau retur pelanggan. Stok dan jurnal diperbarui otomatis mengikuti sumber penerimaan."
      />

      {/* A-24 T1 (SIS-05): cabang dipisah lewat formGateState — peran
          lihat-saja TIDAK lagi menerima "Tambahkan gudang" padahal
          gudang ada; pesan prasyarat hanya untuk pembuat dokumen. */}
      {gate === "form" ? (
        <ReceiptForm
          warehouses={data.warehouseRows}
          suppliers={data.supplierRows}
          paymentAccounts={data.paymentAccounts}
          defaultWarehouseId={data.defaultWarehouseId}
          today={todayISO()}
          taxRate={data.taxRate}
          taxInputMapped={data.taxInputMapped}
          initialPurchaseOrder={data.initialPurchaseOrder}
          canPrice={can(ctx, "inventory.price")}
        />
      ) : gate === "missing" ? (
        <GateNotice>
          {can(ctx, "settings.manage")
            ? "Tambahkan gudang terlebih dahulu di menu Pengaturan."
            : "Belum ada gudang terdaftar. Gudang diatur oleh pemilik/admin di menu Pengaturan."}
        </GateNotice>
      ) : (
        <GateNotice>{viewModeText("penerimaan barang")}</GateNotice>
      )}

      {/* A-25 U3 (DAFTAR-1): riwayat penerimaan memakai DataList
          bersama — judul kartu "Riwayat penerimaan" ditutup, satu
          bar pencarian DataListToolbar, tanpa slot KPI. Filter yang
          didukung fungsi baca yang ada hanya q (ARS1-01: filter
          status/gudang/tanggal tidak ditambah tanpa parameter baca).
          Form penerimaan di atas TIDAK diubah cara membukanya
          (kontrak e2e: tombol "Penerimaan baru" tetap di form). */}
      <DataList
        className="mt-4"
        toolbar={
          <DataListToolbar
            action="/app/gudang/penerimaan"
            q={params.q}
            placeholder="Cari nomor, no. invoice, atau nama pemasok…"
            resetHref={params.q ? "/app/gudang/penerimaan" : undefined}
          />
        }
        isEmpty={data.receipts.length === 0}
        empty={
          <EmptyState title="Belum ada penerimaan" description="Dokumen penerimaan barang akan tampil di sini." />
        }
        pagination={
          <Pagination
            page={data.history.page}
            pageSize={data.history.pageSize}
            total={data.history.total}
            basePath="/app/gudang/penerimaan"
            params={{ q: params.q }}
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
                <th>Sumber</th>
                <th>Pemasok</th>
                <th>Gudang</th>
                <th className="text-right">Jumlah item</th>
                <th className="text-right">Total</th>
                <th className="text-right">Dibayar</th>
                <th>Status</th>
                <th className="text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {data.receipts.map((row) => {
                const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
                return (
                <tr key={row.id}>
                  <td className="num font-medium">
                    <Link href={`/app/gudang/penerimaan/${row.id}`} className="text-primary hover:underline">
                      {row.number}
                    </Link>
                  </td>
                  <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                  <td className="text-[12px]">
                    {RECEIPT_SOURCE_LABELS[row.source as keyof typeof RECEIPT_SOURCE_LABELS] ?? row.source}
                    {row.source === "purchase" && row.paymentAccountId ? (
                      <span className="text-muted-foreground"> · tunai</span>
                    ) : null}
                  </td>
                  <td className="text-[12px]">{row.supplierName ?? "—"}</td>
                  <td className="text-[11px]">{row.warehouseName ?? "—"}</td>
                  <td className="num text-right text-[11px]">{formatNumber(row.itemCount)}</td>
                  <td className="num text-right font-medium">{formatIDR(row.total)}</td>
                  <td className="num text-right text-[11px] text-muted-foreground">{formatIDR(row.paidAmount)}</td>
                  <td>
                    <div className="flex items-center gap-1">
                      {isCreditPurchase ? (
                        <StatusBadge status={row.paymentStatus} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          {row.source === "purchase" ? "Lunas (tunai)" : "Tanpa utang"}
                        </span>
                      )}
                      {row.status === "void" ? (
                        <StatusBadge status={row.status} label="Dibatalkan" />
                      ) : row.status !== "posted" ? (
                        <StatusBadge status={row.status} />
                      ) : null}
                    </div>
                  </td>
                  <td>
                    {/* A-28 UI-5 (UX-A05): pola aksi baris A-25 —
                        Cetak GRN berlabel + Batalkan di menu ⋯. */}
                    <ReceiptRowActions
                      id={row.id}
                      number={row.number}
                      canVoid={row.status === "posted" && can(ctx, "inventory.manage")}
                    />
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="divide-y divide-border/70 lg:hidden">
          {data.receipts.map((row) => {
            const isCreditPurchase = row.source === "purchase" && !row.paymentAccountId;
            return (
              <div key={row.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <Link href={`/app/gudang/penerimaan/${row.id}`} className="num text-[12px] font-medium text-primary hover:underline">
                    {row.number}
                  </Link>
                  <span className="num text-[12px] font-semibold">{formatIDR(row.total)}</span>
                </div>
                <p className="mt-0.5 text-[12px]">
                  {row.supplierName ?? "—"}
                  <span className="text-muted-foreground">
                    {" · "}
                    {RECEIPT_SOURCE_LABELS[row.source as keyof typeof RECEIPT_SOURCE_LABELS] ?? row.source}
                    {row.source === "purchase" && row.paymentAccountId ? " · tunai" : ""}
                  </span>
                </p>
                <p className="num mt-0.5 text-[11px] text-muted-foreground">
                  {formatDate(row.date)} · {row.warehouseName ?? "—"} · {formatNumber(row.itemCount)} item
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {isCreditPurchase ? (
                    <StatusBadge status={row.paymentStatus} />
                  ) : (
                    <span className="text-[11px] text-muted-foreground">
                      {row.source === "purchase" ? "Lunas (tunai)" : "Tanpa utang"}
                    </span>
                  )}
                  {row.status === "void" ? (
                    <StatusBadge status={row.status} label="Dibatalkan" />
                  ) : row.status !== "posted" ? (
                    <StatusBadge status={row.status} />
                  ) : null}
                  <div className="ml-auto">
                    <ReceiptRowActions
                      id={row.id}
                      number={row.number}
                      canVoid={row.status === "posted" && can(ctx, "inventory.manage")}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </DataList>
    </div>
  );
}
