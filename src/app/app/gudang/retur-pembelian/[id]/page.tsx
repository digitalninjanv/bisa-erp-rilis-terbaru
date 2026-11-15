import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { withCompanyReadOnly } from "@/db/tenant";
import {
  SUPPLIER_RETURN_REASON_LABELS,
  SUPPLIER_RETURN_RESOLUTION_LABELS,
  getSupplierReturnPageData,
} from "@/server/supplier-returns";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateLong, todayISO } from "@/lib/format";
import { DocumentMetaRows, DocumentPage } from "@/components/blocks/document-page";
import { statusLabel } from "@/components/blocks/status-badge";
import {
  SUPPLIER_RETURN_FLOW_STAGES,
  documentFlowSteps,
} from "@/lib/document-flow";
import { SupplierReturnDocActions } from "@/components/gudang/supplier-return-actions";
import {
  SupplierReturnResolutionForms,
  type ReplaceableLine,
} from "@/components/gudang/supplier-return-resolutions";

export const metadata = { title: "Detail Retur Pembelian" };
export const dynamic = "force-dynamic";

const RESOLUTION_KIND_LABELS: Record<string, string> = {
  apply_credit: "Diterapkan ke utang pemasok",
  purchase_advance: "Menjadi uang muka pembelian",
  refund: "Refund uang dari pemasok",
  replacement: "Barang pengganti diterima",
  other: "Ditutup dengan cara lain",
};

export default async function SupplierReturnDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getSupplierReturnPageData(tx, ctx.company.id, id),
  );

  if (!data) notFound();
  const { detail } = data;
  const canManage = can(ctx, "inventory.manage");
  const canSettle = can(ctx, "accounting.post") || canManage;
  const isDraft = detail.status === "draft";

  const replaceableLines: ReplaceableLine[] = detail.lines
    .map((line) => {
      const remainingQty = d(line.qty).minus(d(line.replacedQty));
      return { line, remainingQty };
    })
    .filter(({ remainingQty }) => remainingQty.gt(0))
    .map(({ line, remainingQty }) => ({
      returnLineId: line.id,
      productName: line.productName,
      sku: data.skuById.get(line.productId) ?? "",
      qty: line.qty,
      replacedQty: line.replacedQty,
      remainingQty: remainingQty.toString(),
      unitCost: line.unitCost,
      trackBatch: data.trackBatchById.get(line.productId) ?? false,
    }));

  const lineById = new Map(detail.lines.map((line) => [line.id, line]));

  // A-25 U3: detail retur memakai DocumentPage bersama — StatusSteps
  // Draf → Terposting (posted/partially_resolved) → Selesai dari
  // status nyata, aksi dokumen (Posting retur/Batalkan/Cetak) di rel
  // aksi, meta di rel kanan; pemberitahuan void & penutupan sisa
  // klaim menjadi banner di bawah kepala dokumen.
  return (
    <DocumentPage
      backHref="/app/gudang/retur-pembelian"
      backLabel="Kembali ke daftar Retur Pembelian"
      eyebrow="Gudang · Retur Pembelian"
      number={detail.number}
      title={`Pemasok: ${data.supplierName ?? "—"}`}
      status={detail.status}
      steps={documentFlowSteps(
        detail.status,
        SUPPLIER_RETURN_FLOW_STAGES,
        statusLabel(detail.status),
      )}
      actions={
        <>
          <Link
            href={`/app/gudang/retur-pembelian/${detail.id}/cetak`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
          >
            Cetak
          </Link>
          {canManage ? (
            <SupplierReturnDocActions
              id={detail.id}
              number={detail.number}
              status={detail.status}
              hasResolutions={detail.resolutions.length > 0}
            />
          ) : null}
        </>
      }
      banners={
        <>
          {detail.status === "void" ? (
            <div className="border-t border-border bg-tone-red-soft px-5 py-2 text-[11px] leading-5 text-tone-red">
              Retur ini sudah dibatalkan — stok dikembalikan ke gudang, alokasi utang dilepas, dan jurnal posting
              dibalik
              {data.reversalJournal ? (
                <>
                  {" "}lewat jurnal{" "}
                  <Link
                    href={`/app/akuntansi/jurnal/${data.reversalJournal.id}`}
                    className="num font-medium underline"
                  >
                    {data.reversalJournal.number}
                  </Link>
                </>
              ) : null}
              .
            </div>
          ) : null}
          {detail.closedWithRemainder ? (
            <div className="border-t border-border bg-tone-amber-soft px-5 py-2 text-[11px] leading-5 text-tone-amber">
              Retur ini ditutup dengan cara lain saat klaim masih tersisa. Sisa klaim tetap tercatat sebagai aset
              Kredit Pemasok di buku besar (tidak dihapus). Catatan penutupan: {detail.closeNote ?? "—"}
            </div>
          ) : null}
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Pemasok", value: data.supplierName ?? "—" },
            { label: "Gudang", value: data.warehouseName ?? "—" },
            { label: "Tanggal", value: formatDateLong(detail.date) },
            {
              label: "Kategori alasan",
              value:
                SUPPLIER_RETURN_REASON_LABELS[detail.reasonCategory] ?? detail.reasonCategory,
            },
            {
              label: "Rencana penyelesaian",
              value:
                SUPPLIER_RETURN_RESOLUTION_LABELS[detail.resolutionType] ?? detail.resolutionType,
            },
            ...(canSeeCost
              ? [{
                  label: "Nilai persediaan keluar (AVCO)",
                  value: isDraft ? "Dibekukan saat posting" : formatIDR(detail.totalValue),
                }]
              : []),
            ...(!isDraft && detail.status !== "void"
              ? [{ label: "Sisa klaim", value: formatIDR(data.remaining) }]
              : []),
          ]}
        />
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Alasan & rencana penyelesaian</h2>
        </div>
        <div className="grid gap-x-6 gap-y-3 px-4 py-3 text-[12px] sm:grid-cols-2">
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Kategori alasan</span>
            <span className="font-medium">
              {SUPPLIER_RETURN_REASON_LABELS[detail.reasonCategory] ?? detail.reasonCategory}
            </span>
          </div>
          <div>
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Penyelesaian yang direncanakan</span>
            <span className="font-medium">
              {SUPPLIER_RETURN_RESOLUTION_LABELS[detail.resolutionType] ?? detail.resolutionType}
            </span>
          </div>
          <div className="sm:col-span-2">
            <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Alasan retur</span>
            <p className="leading-5">{detail.reasonDetail}</p>
          </div>
          {detail.resolutionNote ? (
            <div className="sm:col-span-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Catatan penyelesaian</span>
              <p className="leading-5">{detail.resolutionNote}</p>
            </div>
          ) : null}
        </div>
      </section>

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Barang yang diretur</h2>
          {isDraft ? (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Nilai per baris masih kosong — harga pokok dibekukan pada AVCO berjalan saat dokumen diposting.
            </p>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Batch keluar</th>
                <th className="text-right">Qty retur</th>
                {canSeeCost ? <th className="text-right">Harga pokok (AVCO)</th> : null}
                {canSeeCost ? <th className="text-right">Nilai baris</th> : null}
                <th className="text-right">Sudah diganti</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line) => {
                const batch = line.batchId ? data.batchById.get(line.batchId) : undefined;
                return (
                  <tr key={line.id}>
                    <td className="font-medium">
                      {line.productName}
                      {line.packagingId ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          Diretur sebagai {formatQty(line.qtyInput)} {line.packagingName ?? "kemasan"} · isi {formatQty(line.isiSnapshot)} — qty di tabel ini satuan dasar
                        </span>
                      ) : null}
                    </td>
                    <td className="text-[12px] text-muted-foreground">
                      {line.batchId
                        ? `${batch?.batchNumber ?? "(batch)"}${batch?.expiryDate ? ` · ED ${formatDate(batch.expiryDate)}` : ""}`
                        : data.trackBatchById.get(line.productId)
                          ? "Otomatis (FEFO)"
                          : "—"}
                    </td>
                    <td className="num text-right">{formatQty(line.qty)}</td>
                    {canSeeCost ? <td className="num text-right">{isDraft ? "—" : formatIDR(line.unitCost)}</td> : null}
                    {canSeeCost ? <td className="num text-right font-medium">{isDraft ? "—" : formatIDR(line.lineTotal)}</td> : null}
                    <td className="num text-right text-muted-foreground">
                      {d(line.replacedQty).gt(0) ? formatQty(line.replacedQty) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {!isDraft ? (
              <tfoot>
                <tr>
                  <td colSpan={canSeeCost ? 4 : 2} className="text-right font-semibold">Nilai persediaan keluar (AVCO)</td>
                  {canSeeCost ? <td className="num text-right font-semibold">{formatIDR(detail.totalValue)}</td> : null}
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </section>

      {!isDraft && detail.status !== "void" ? (
        <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Penyelesaian & klaim Kredit Pemasok</h2>
          {d(detail.invoiceCreditAmount).gt(0) ? (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Nilai stok keluar memakai AVCO saat posting. Klaim pemasok mengikuti faktur asal; selisih bersih dicatat ke HPP.
            </p>
          ) : null}
          </div>
          <dl className="grid gap-x-6 gap-y-2 px-4 py-3 text-[12px] sm:grid-cols-2">
            {canSeeCost ? <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Nilai persediaan keluar (AVCO)</dt>
              <dd className="num font-medium">{formatIDR(detail.totalValue)}</dd>
            </div> : null}
            {d(detail.invoiceCreditAmount).gt(0) ? (
              <>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Nilai kredit nota faktur (termasuk PPN)</dt>
                  <dd className="num font-medium">{formatIDR(detail.invoiceCreditAmount)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">PPN Masukan dibalik</dt>
                  <dd className="num font-medium">{formatIDR(detail.taxAmount)}</dd>
                </div>
                {canSeeCost ? <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">Selisih faktur terhadap AVCO (dampak HPP)</dt>
                  <dd className="num font-medium">{formatIDR(detail.priceVarianceAmount)}</dd>
                </div> : null}
              </>
            ) : null}
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Langsung memotong utang saat posting</dt>
              <dd className="num font-medium">{formatIDR(detail.payableAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Klaim Kredit Pemasok awal</dt>
              <dd className="num font-medium">{formatIDR(detail.creditAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">Sudah diselesaikan</dt>
              <dd className="num font-medium">{formatIDR(detail.resolvedAmount)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 sm:col-span-2">
              <dt className="font-semibold">Sisa klaim</dt>
              <dd className={`num text-[15px] font-bold ${data.remaining.gt(0) ? "text-tone-amber" : "text-tone-green"}`}>
                {formatIDR(data.remaining)}
              </dd>
            </div>
          </dl>
          {data.postingJournal ? (
            <p className="border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
              Jurnal posting:{" "}
              <Link href={`/app/akuntansi/jurnal/${data.postingJournal.id}`} className="num font-medium text-primary hover:underline">
                {data.postingJournal.number}
              </Link>
              {data.reversalJournal ? (
                <>
                  {" "}· Jurnal pembalik:{" "}
                  <Link href={`/app/akuntansi/jurnal/${data.reversalJournal.id}`} className="num font-medium text-primary hover:underline">
                    {data.reversalJournal.number}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
        </section>
      ) : null}

      {data.resolvable ? (
        <details className="group mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span>
              <span className="block text-[13px] font-semibold">Catat penyelesaian klaim</span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                Pilih cara penyelesaian; klaim bisa dicatat bertahap sesuai kesepakatan pemasok.
              </span>
            </span>
            <span className="flex items-center gap-2">
              <span className="num text-[12px] font-semibold">Sisa {formatIDR(data.remaining)}</span>
              <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </span>
          </summary>
          <div className="border-t border-border p-3 sm:p-4">
            <SupplierReturnResolutionForms
              returnId={detail.id}
              number={detail.number}
              remainingClaim={data.remaining.toString()}
              today={todayISO()}
              openPayables={data.openPayables}
              paymentAccounts={data.paymentAccounts}
              replaceableLines={replaceableLines}
              canSettleMoney={canSettle}
              canReceiveReplacement={canManage}
            />
          </div>
        </details>
      ) : null}

      {detail.resolutions.length > 0 ? (
        <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold">Riwayat penyelesaian klaim</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tanggal</th>
                  <th>Jenis</th>
                  <th>Rincian</th>
                  <th className="text-right">Nominal klaim terpakai</th>
                  <th>Jurnal</th>
                </tr>
              </thead>
              <tbody>
                {detail.resolutions.map((row) => {
                  const line = row.returnLineId ? lineById.get(row.returnLineId) : undefined;
                  return (
                    <tr key={row.id}>
                      <td className="num text-[12px] text-muted-foreground">{formatDate(row.date)}</td>
                      <td className="text-[12px] font-medium">{RESOLUTION_KIND_LABELS[row.kind] ?? row.kind}</td>
                      <td className="text-[12px] text-muted-foreground">
                        {row.kind === "replacement" && line
                          ? `${line.productName} · ${formatQty(row.qty ?? "0")} unit`
                          : row.kind === "refund" && row.accountId
                            ? `Masuk ke ${data.accountNameById.get(row.accountId) ?? "akun kas/bank"}`
                            : row.note ?? "—"}
                      </td>
                      <td className="num text-right font-medium">
                        {d(row.amount).gt(0) ? formatIDR(row.amount) : "—"}
                      </td>
                      <td>
                        {row.journalId ? (
                          <Link
                            href={`/app/akuntansi/jurnal/${row.journalId}`}
                            className="num text-[11px] font-medium text-primary hover:underline"
                          >
                            {data.journalNumberById.get(row.journalId) ?? "Lihat jurnal"}
                          </Link>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </DocumentPage>
  );
}
