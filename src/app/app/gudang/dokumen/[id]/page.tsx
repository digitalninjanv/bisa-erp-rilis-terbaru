import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getStockDocumentDetail } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { canSeeInventoryCost } from "@/lib/inventory-cost";
import { d, formatIDR, formatQty } from "@/lib/money";
import { formatCountBreakdown } from "@/lib/packaging";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { DocumentJournals } from "@/components/blocks/document-journals";
import {
  DocumentMetaRows,
  DocumentPage,
} from "@/components/blocks/document-page";
import { statusLabel } from "@/components/blocks/status-badge";
import {
  documentFlowSteps,
  STOCK_POSTED_FLOW_STAGES,
  STOCK_TRANSFER_FLOW_STAGES,
  type FlowStage,
} from "@/lib/document-flow";
import { StockDocumentVoidButton } from "@/components/gudang/void-buttons";
import {
  AdjustmentApproveButton,
  AdjustmentCancelButton,
  AdjustmentRejectButton,
} from "@/components/gudang/approval-buttons";
import {
  TransferReceiveForm,
  type TransferReceiveLine,
} from "@/components/gudang/transfer-receive-form";

export const metadata = { title: "Detail Dokumen Stok" };
export const dynamic = "force-dynamic";

const TYPE_META: Record<string, { label: string; backHref: string; backLabel: string }> = {
  opname: { label: "Opname (stok opname)", backHref: "/app/gudang/opname?tab=riwayat", backLabel: "Riwayat opname" },
  transfer: { label: "Transfer antar gudang", backHref: "/app/gudang/transfer", backLabel: "Riwayat transfer" },
  adjustment: { label: "Penyesuaian stok", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
  damaged: { label: "Hapus buku — rusak", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
  expired: { label: "Hapus buku — kedaluwarsa", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
  lost: { label: "Hapus buku — hilang", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
  quarantine: { label: "Hapus buku — karantina", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
  purchase_return: { label: "Retur pembelian", backHref: "/app/gudang/penyesuaian", backLabel: "Riwayat penyesuaian" },
};

const ADJUSTMENT_FAMILY = new Set([
  "adjustment",
  "damaged",
  "expired",
  "lost",
  "quarantine",
  "purchase_return",
]);

/** Penyesuaian menunggu persetujuan lebih dulu sebelum terposting. */
const ADJUSTMENT_FLOW_STAGES: FlowStage[] = [
  { key: "pending", label: "Menunggu persetujuan", statuses: ["pending"] },
  { key: "posted", label: "Terposting", statuses: ["posted"] },
];

const REASON_LABELS: Record<string, string> = {
  damaged: "Rusak",
  expired: "Kedaluwarsa",
  lost: "Hilang",
  theft: "Pencurian",
  breakage: "Pecah",
  other: "Lainnya",
};

/**
 * FIX-GDG Tahap 4 (GDG2-02) — halaman detail generik dokumen stok
 * (opname, penyesuaian/keluarga hapus-buku, transfer). Baca-saja
 * kecuali: persetujuan penyesuaian tertunda, pembatalan dokumen
 * terposting, dan formulir penerimaan transfer (butir a tahap ini).
 * Nomor dokumen di daftar riwayat menaut ke sini.
 *
 * A-25 U3: dirangkai ulang ke DocumentPage bersama — penanda tahap
 * dari status nyata (transfer: perjalanan → diterima; penyesuaian:
 * menunggu → terposting; opname: terposting), meta di rel kanan,
 * jurnal di slot jurnal. GDG-04: dokumen transfer yang TIDAK lagi
 * in_transit kini menjelaskan keadaan kolom Terkirim/Diterima/Sisa
 * lewat spanduk konteks — angka sisa tidak lagi menggantung.
 */
export default async function StockDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");
  const canSeeCost = canSeeInventoryCost(ctx);

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) =>
    getStockDocumentDetail(tx, ctx.company.id, id),
  );
  if (!data) notFound();
  const { doc, lines, movements, serials, journals } = data;
  const meta = TYPE_META[doc.type] ?? {
    label: doc.type,
    backHref: "/app/gudang/riwayat",
    backLabel: "Riwayat stok",
  };
  const manage = can(ctx, "inventory.manage");

  // Batch per produk dari gerakan dokumen ini (batch hidup di ledger).
  const batchesByProduct = new Map<string, string[]>();
  for (const movement of movements) {
    if (!movement.batchNumber) continue;
    const list = batchesByProduct.get(movement.productId) ?? [];
    const label = `${movement.batchNumber}${movement.expiryDate ? ` (kedaluwarsa ${formatDate(movement.expiryDate)})` : ""}`;
    if (!list.includes(label)) list.push(label);
    batchesByProduct.set(movement.productId, list);
  }
  const serialsByProduct = new Map<string, string[]>();
  for (const row of serials) {
    const list = serialsByProduct.get(row.productId) ?? [];
    list.push(row.serialNumber);
    serialsByProduct.set(row.productId, list);
  }

  // Baris formulir penerimaan transfer: seri yang masih dalam
  // perjalanan atas dokumen ini + ringkasan batch kiriman.
  const receiveLines: TransferReceiveLine[] = lines.map((line) => {
    const shippedOut = movements
      .filter((movement) => movement.productId === line.productId && movement.movementType === "transfer_out" && movement.batchNumber)
      .map((movement) => `${movement.batchNumber} (×${formatQty(Math.abs(Number(movement.qty)))})`);
    return {
      productId: line.productId,
      productName: line.productName,
      sku: line.sku,
      shippedQty: line.qty,
      shippedInputLabel:
        line.packagingId && line.packagingName
          ? `${formatQty(line.qtyInput)} ${line.packagingName}`
          : null,
      receivedQty: line.receivedQty,
      trackSerial: line.trackSerial,
      inTransitSerials: serials
        .filter(
          (row) => row.productId === line.productId && row.kind === "transfer_out" && row.status === "in_transit",
        )
        .map((row) => row.serialNumber),
      batchSummary: shippedOut.length > 0 ? [...new Set(shippedOut)].join(", ") : undefined,
    };
  });

  const showReceiveForm =
    doc.type === "transfer" && doc.status === "in_transit" && manage;

  const stages =
    doc.type === "transfer"
      ? STOCK_TRANSFER_FLOW_STAGES
      : ADJUSTMENT_FAMILY.has(doc.type)
        ? ADJUSTMENT_FLOW_STAGES
        : STOCK_POSTED_FLOW_STAGES;

  const metaRows: { label: string; value: React.ReactNode }[] = [
    { label: "Tanggal dokumen", value: formatDate(doc.date) },
    {
      label: doc.type === "transfer" ? "Gudang asal" : "Gudang",
      value: doc.warehouseName ?? "—",
    },
  ];
  if (doc.type === "transfer") {
    metaRows.push({ label: "Gudang tujuan", value: doc.toWarehouseName ?? "—" });
  }
  if (doc.supplierName) metaRows.push({ label: "Pemasok", value: doc.supplierName });
  if (doc.reason) {
    metaRows.push({ label: "Alasan dokumen", value: REASON_LABELS[doc.reason] ?? doc.reason });
  }
  if (canSeeCost) metaRows.push({ label: "Nilai dokumen", value: formatIDR(doc.total) });
  metaRows.push({ label: "Dibuat", value: formatDateTime(doc.createdAt) });
  if (doc.postedAt) metaRows.push({ label: "Terposting", value: formatDateTime(doc.postedAt) });
  if (doc.approvedAt) metaRows.push({ label: "Disahkan", value: formatDateTime(doc.approvedAt) });
  if (doc.rejectionReason) metaRows.push({ label: "Alasan penolakan", value: doc.rejectionReason });
  if (doc.receivedAt) metaRows.push({ label: "Terakhir diterima", value: formatDateTime(doc.receivedAt) });
  if (doc.differenceReason) metaRows.push({ label: "Alasan selisih perjalanan", value: doc.differenceReason });
  if (doc.notes) metaRows.push({ label: "Catatan", value: doc.notes });

  const banners = (
    <>
      {doc.status === "pending" && ADJUSTMENT_FAMILY.has(doc.type) && manage ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-[12px] text-muted-foreground">Menunggu persetujuan:</span>
          <AdjustmentApproveButton id={doc.id} number={doc.number} />
          <AdjustmentRejectButton id={doc.id} number={doc.number} />
          <AdjustmentCancelButton id={doc.id} number={doc.number} />
        </div>
      ) : null}
      {doc.type === "transfer" && doc.status === "in_transit" ? (
        <p className="border-t border-border px-5 py-3 text-[12px] leading-5 text-muted-foreground">
          Barang masih dalam perjalanan. Kolom <strong>Sisa</strong> adalah jumlah yang belum
          diterima di gudang tujuan
          {showReceiveForm
            ? " — terima barangnya lewat formulir penerimaan di bawah tabel baris."
            : " — penerimaan dicatat oleh peran berizin kelola."}
        </p>
      ) : null}
      {doc.type === "transfer" && doc.status === "posted" ? (
        <p className="border-t border-border px-5 py-3 text-[12px] leading-5 text-muted-foreground">
          Transfer selesai — penerimaan terakhir {doc.receivedAt ? formatDateTime(doc.receivedAt) : "tercatat"}.
          Bila kolom Sisa tidak nol, selisihnya diselesaikan saat penerimaan terakhir
          {doc.differenceReason ? " dengan alasan yang tercatat di rel detail" : ""}.
        </p>
      ) : null}
    </>
  );

  return (
    <DocumentPage
      backHref={meta.backHref}
      backLabel={meta.backLabel}
      eyebrow={meta.label}
      number={doc.number}
      status={doc.status}
      steps={documentFlowSteps(doc.status, stages, statusLabel(doc.status))}
      actions={
        <>
          {doc.type === "transfer" && doc.status !== "void" ? (
            <Link
              href={`/app/gudang/transfer/${doc.id}/cetak`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Cetak surat jalan
            </Link>
          ) : null}
          {doc.status === "posted" || doc.status === "in_transit" ? (
            manage ? <StockDocumentVoidButton id={doc.id} number={doc.number} /> : null
          ) : null}
        </>
      }
      banners={banners}
      meta={<DocumentMetaRows rows={metaRows} />}
      journals={<DocumentJournals journals={journals} />}
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Baris dokumen</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th>Batch / Seri</th>
                {doc.type === "opname" ? (
                  <>
                    <th className="text-right">Sistem</th>
                    <th className="text-right">Fisik</th>
                    <th className="text-right">Selisih</th>
                  </>
                ) : doc.type === "transfer" ? (
                  <>
                    <th className="text-right">Terkirim</th>
                    <th className="text-right">Diterima</th>
                    <th className="text-right">Sisa</th>
                  </>
                ) : (
                  <th className="text-right">Qty</th>
                )}
                {canSeeCost ? <th className="text-right">Biaya satuan</th> : null}
                {canSeeCost ? <th className="text-right">Nilai</th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const batches = batchesByProduct.get(line.productId) ?? [];
                const lineSerials = serialsByProduct.get(line.productId) ?? [];
                return (
                  <tr key={line.id}>
                    <td>
                      <p className="font-medium">{line.productName}</p>
                      <p className="num text-[11px] text-muted-foreground">{line.sku ?? ""}</p>
                      {line.reason ? (
                        <p className="text-[11px] text-muted-foreground">
                          {REASON_LABELS[line.reason] ?? line.reason}
                        </p>
                      ) : null}
                    </td>
                    <td className="text-[12px]">
                      {batches.length > 0 ? <p className="num">{batches.join(", ")}</p> : null}
                      {lineSerials.length > 0 ? <p className="num">{lineSerials.join(", ")}</p> : null}
                      {batches.length === 0 && lineSerials.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : null}
                    </td>
                    {doc.type === "opname" ? (
                      <>
                        <td className="num text-right">{formatQty(line.systemQty ?? "0")}</td>
                        <td className="num text-right font-medium">
                          {formatQty(d(line.systemQty ?? "0").plus(d(line.qty)))}
                          {/* S3: rincian hitungan campuran sebagaimana
                              dihitung petugas (cuplikan baris). */}
                          {line.countBreakdown && line.countBreakdown.length > 0 ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {formatCountBreakdown(line.countBreakdown)}
                            </span>
                          ) : null}
                        </td>
                        <td className={`num text-right font-medium ${d(line.qty).isZero() ? "" : "text-tone-amber"}`}>
                          {d(line.qty).gt(0) ? "+" : ""}
                          {formatQty(line.qty)}
                        </td>
                      </>
                    ) : doc.type === "transfer" ? (
                      <>
                        <td className="num text-right">
                          {formatQty(line.qty)}
                          {/* S3: bentuk masukan berkemasan baris. */}
                          {line.packagingId && line.packagingName ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {formatQty(line.qtyInput)} {line.packagingName}
                            </span>
                          ) : null}
                        </td>
                        <td className="num text-right font-medium">{formatQty(line.receivedQty)}</td>
                        <td className="num text-right">
                          {formatQty(d(line.qty).minus(d(line.receivedQty)))}
                        </td>
                      </>
                    ) : (
                      <td className="num text-right font-medium">
                        {formatQty(line.qty)}
                        {line.packagingId && line.packagingName ? (
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            dari {formatQty(line.qtyInput)} {line.packagingName}
                          </span>
                        ) : null}
                      </td>
                    )}
                    {canSeeCost ? <td className="num text-right">{formatIDR(line.unitCost)}</td> : null}
                    {canSeeCost ? <td className="num text-right font-medium">{formatIDR(line.lineTotal)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted/40">
                <td
                  colSpan={canSeeCost ? (doc.type === "opname" || doc.type === "transfer" ? 5 : 3) : (doc.type === "opname" || doc.type === "transfer" ? 3 : 1)}
                  className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  Total dokumen
                </td>
                {canSeeCost ? <td className="num px-3 py-2 text-right font-semibold">{formatIDR(doc.total)}</td> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {showReceiveForm ? (
        <div className="mt-3">
          <TransferReceiveForm
            documentId={doc.id}
            number={doc.number}
            lines={receiveLines}
            today={todayISO()}
          />
        </div>
      ) : null}
    </DocumentPage>
  );
}
