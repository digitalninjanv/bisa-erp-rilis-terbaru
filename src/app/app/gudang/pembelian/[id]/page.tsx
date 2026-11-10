import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getPurchaseOrderDetail } from "@/server/purchasing";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateLong } from "@/lib/format";
import { DocumentMetaRows, DocumentPage } from "@/components/blocks/document-page";
import { EmptyState } from "@/components/blocks/empty-state";
import { StatusBadge, statusLabel } from "@/components/blocks/status-badge";
import {
  PURCHASE_ORDER_FLOW_STAGES,
  documentFlowSteps,
} from "@/lib/document-flow";
import { PurchaseOrderActions } from "@/components/gudang/purchase-order-actions";

export const metadata = { title: "Detail pesanan pembelian" };
export const dynamic = "force-dynamic";

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, (tx) =>
    getPurchaseOrderDetail(tx, ctx.company.id, id),
  );

  if (!data) notFound();
  const { order, lines, receipts } = data;
  const totalOrderedQty = lines.reduce((acc, line) => acc + Number(line.qty), 0);

  // A-25 U3: detail PO memakai DocumentPage bersama — StatusSteps
  // dari status nyata (Draf → Terkirim → Diterima; partial/received
  // berbagi tahap Diterima), aksi alur berikutnya (Terima barang /
  // Kirim PO di dalam PurchaseOrderActions) sebagai primer di rel
  // aksi, meta dokumen di rel kanan.
  // A-28 UI-4 (UX-C01): banner di bawah kepala menjelaskan langkah
  // berikutnya pada SETIAP status — termasuk bahwa Draf kini punya
  // jalan "Kirim & terima" (kirim eksplisit berkonfirmasi, lalu form
  // penerimaan), menutup kejutan administratif versi audit.
  const nextStep =
    order.status === "draft"
      ? "Langkah berikutnya: kirim PO ke pemasok dengan Kirim PO, atau pakai Kirim & terima untuk mengirim sekaligus membuka formulir penerimaan yang terisi dari pesanan ini."
      : order.status === "sent"
        ? "Langkah berikutnya: terima barang lewat tombol Terima barang — formulir penerimaan terbuka terisi dari sisa pesanan."
        : order.status === "partial"
          ? "Langkah berikutnya: terima sisa barang yang belum datang lewat tombol Terima barang; progres tiap baris terlihat pada tabel di bawah."
          : order.status === "received"
            ? "Semua baris sudah diterima penuh — PO ini selesai. Penerimaan terkaitnya tercatat pada tabel di bawah."
            : order.status === "cancelled"
              ? "PO ini dibatalkan dan tidak lagi dapat ditautkan ke penerimaan baru."
              : null;
  return (
    <DocumentPage
      backHref="/app/gudang/pembelian"
      backLabel="Kembali ke daftar PO"
      eyebrow="Gudang · Pesanan pembelian"
      number={order.number}
      title={`Pemasok: ${order.supplierName ?? "—"}`}
      status={order.status}
      steps={documentFlowSteps(
        order.status,
        PURCHASE_ORDER_FLOW_STAGES,
        statusLabel(order.status),
      )}
      banners={
        nextStep ? (
          <div className="border-t border-border bg-muted/40 px-5 py-2 text-[11px] text-muted-foreground">
            {nextStep}
          </div>
        ) : null
      }
      actions={
        <>
          <Link
            href={`/app/gudang/pembelian/${order.id}/cetak`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted"
          >
            Cetak PO
          </Link>
          {/* FIX-GDG Tahap 4 (GDG2-15): terima barang langsung dari
              detail PO — sebelumnya petugas disuruh pindah ke
              halaman Penerimaan lalu memilih pemasok & PO manual. */}
          {(order.status === "sent" || order.status === "partial") &&
          can(ctx, "inventory.manage") ? (
            <Link
              href={`/app/gudang/penerimaan?po=${order.id}`}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              Terima barang
            </Link>
          ) : null}
          {can(ctx, "inventory.manage") ? (
            <PurchaseOrderActions id={order.id} number={order.number} status={order.status} />
          ) : null}
        </>
      }
      meta={
        <DocumentMetaRows
          rows={[
            { label: "Pemasok", value: order.supplierName ?? "—" },
            { label: "Tanggal PO", value: formatDateLong(order.date) },
            {
              label: "Perkiraan tiba",
              value: order.expectedDate ? formatDate(order.expectedDate) : "—",
            },
            { label: "Total nilai PO", value: formatIDR(order.total) },
            { label: "Total dipesan", value: `${formatQty(totalOrderedQty)} unit` },
          ]}
        />
      }
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Baris pesanan</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produk</th>
                <th className="text-right">Dipesan</th>
                <th className="text-right">Diterima</th>
                <th className="text-right">Sisa</th>
                <th>Progres</th>
                <th className="text-right">Harga beli</th>
                <th className="text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const qty = Number(line.qty);
                const received = Number(line.receivedQty);
                const remaining = Math.max(0, qty - received);
                const progress = qty > 0 ? Math.min(100, Math.round((received / qty) * 100)) : 0;
                return (
                  <tr key={line.id}>
                    <td>
                      <p className="font-medium">{line.productName}</p>
                      <p className="num text-[10px] text-muted-foreground">{line.sku}</p>
                      {line.packagingId ? (
                        <p className="text-[10px] text-muted-foreground">
                          Dipesan sebagai {formatQty(line.qtyInput)} {line.packagingName ?? "kemasan"} · isi {formatQty(line.isiSnapshot)} — qty & harga di tabel ini satuan dasar
                        </p>
                      ) : null}
                    </td>
                    <td className="num text-right">
                      {formatQty(line.qty)}{line.unitName ? ` ${line.unitName}` : ""}
                    </td>
                    <td className="num text-right">{formatQty(line.receivedQty)}</td>
                    <td className="num text-right">{formatQty(remaining)}</td>
                    <td className="min-w-[110px]">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="num text-[10px] text-muted-foreground">{progress}%</span>
                    </td>
                    <td className="num text-right">{formatIDR(line.unitCost)}</td>
                    <td className="num text-right font-medium">{formatIDR(line.lineTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="text-right font-semibold">Total nilai PO</td>
                <td className="num text-right font-semibold">{formatIDR(order.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {order.notes ? (
          <p className="border-t border-border px-4 py-3 text-[12px]">
            <span className="text-muted-foreground">Catatan: </span>
            {order.notes}
          </p>
        ) : null}
      </section>

      <section className="mt-3 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Penerimaan terhadap PO ini</h2>
        </div>
        {receipts.length === 0 ? (
          <div className="p-3">
            {/* G3 (UX4-07): teks polos dalam kartu → EmptyState
                compact; panduan tindak lanjut menjadi deskripsinya. */}
            <EmptyState
              size="compact"
              title="Belum ada penerimaan yang menautkan PO ini."
              description={
                order.status === "sent" || order.status === "partial"
                  ? "Gunakan tombol Terima barang di atas — form penerimaan terbuka dengan PO ini sudah tertaut dan baris terisi dari sisa pesanan."
                  : order.status === "draft"
                    ? "Gunakan Kirim & terima di atas — PO terkirim lebih dahulu, lalu form penerimaan terbuka dengan baris yang sama."
                    : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nomor penerimaan</th>
                  <th>Tanggal</th>
                  <th>Gudang</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th className="text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {receipts.map((receipt) => (
                  <tr key={receipt.id}>
                    <td className="num font-medium">{receipt.number}</td>
                    <td className="num text-[12px] text-muted-foreground">{formatDate(receipt.date)}</td>
                    <td className="text-[12px]">{receipt.warehouseName ?? "—"}</td>
                    <td className="num text-right">{formatIDR(receipt.total)}</td>
                    <td>
                      <StatusBadge
                        status={receipt.status}
                        label={receipt.status === "void" ? "Dibatalkan" : undefined}
                      />
                    </td>
                    <td>
                      <Link
                        href={`/app/gudang/penerimaan/${receipt.id}/cetak`}
                        className="text-[11px] font-medium text-primary hover:underline"
                      >
                        Cetak GRN
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </DocumentPage>
  );
}
