import Link from "next/link";
import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getSettings, getStockDocumentDetail } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { formatQty } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import { applySignatureLabels, paperSpec, toPrintSettings } from "@/components/print/types";

export const metadata = { title: "Surat Jalan Transfer" };
export const dynamic = "force-dynamic";

const TRANSFER_STATUS_LABELS: Record<string, string> = {
  draft: "Draf",
  pending: "Menunggu persetujuan",
  in_transit: "Dalam perjalanan",
  posted: "Selesai",
  received: "Sudah diterima",
  rejected: "Ditolak",
  void: "Dibatalkan",
};

/**
 * FIX-GDG Tahap 4 (GDG2-05b) — surat jalan sederhana untuk transfer
 * antar gudang. Sebelumnya pengiriman tidak punya dokumen pengantar
 * sama sekali (GRN ada, surat jalan tidak): kurir/pengirim membawa
 * barang tanpa daftar isi bermaterai tanda terima. Isi kiriman diambil
 * dari baris dokumen + irisan batch gerakan transfer_out-nya; status
 * penerimaan (diterima sebagian / selisih) dinyatakan apa adanya.
 */
export default async function TransferDeliveryNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const ctx = await requirePermissionPage("inventory.view");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [detail, settings] = await Promise.all([
      getStockDocumentDetail(tx, ctx.company.id, id),
      getSettings(tx, ctx.company.id),
    ]);
    if (!detail || detail.doc.type !== "transfer") return null;
    return { detail, settings };
  });

  if (!data) notFound();
  const { detail, settings } = data;
  const { doc, lines, movements, serials } = detail;
  const printSettings = toPrintSettings(settings, "transfer");
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(doc.number) : null;

  // Batch kiriman per produk dari gerakan transfer keluar.
  const batchesByProduct = new Map<string, string[]>();
  for (const movement of movements) {
    if (movement.movementType !== "transfer_out" || !movement.batchNumber) continue;
    const list = batchesByProduct.get(movement.productId) ?? [];
    const label = `${movement.batchNumber} (×${formatQty(Math.abs(Number(movement.qty)))}${movement.expiryDate ? `, kedaluwarsa ${formatDate(movement.expiryDate)}` : ""})`;
    if (!list.includes(label)) list.push(label);
    batchesByProduct.set(movement.productId, list);
  }

  // Nomor seri yang bergerak pada dokumen ini — sudah dimuat detail
  // dokumen, kini ikut tercetak agar penerima dapat mencocokkan unit.
  const serialsByProduct = new Map<string, string[]>();
  for (const row of serials) {
    const list = serialsByProduct.get(row.productId) ?? [];
    if (!list.includes(row.serialNumber)) list.push(row.serialNumber);
    serialsByProduct.set(row.productId, list);
  }
  const statusLabel = TRANSFER_STATUS_LABELS[doc.status] ?? doc.status;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Surat Jalan Transfer
          </p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-lg font-semibold">{doc.number}</h1>
            <StatusBadge status={doc.status} label={statusLabel} />
          </div>
          <p className="text-[12px] text-muted-foreground">
            {doc.warehouseName ?? "—"} → {doc.toWarehouseName ?? "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/app/gudang/dokumen/${doc.id}`}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted"
          >
            Kembali ke detail
          </Link>
          <ReceiptPrint auto={query.autoprint === "1"} />
        </div>
      </div>

      <div className="print-area rounded-lg border border-border bg-white p-6 text-black shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.documentPaper}>
          <PrintHeader
            settings={printSettings}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            address={settings?.address}
            phone={settings?.phone}
            taxId={settings?.taxId}
            variant="document"
            title="Surat Jalan Transfer Antar Gudang"
            number={doc.number}
            dateLabel={formatDate(doc.date)}
          />

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
            <div>
              <span className="block text-black/60">Gudang asal</span>
              <span className="font-medium">{doc.warehouseName ?? "—"}</span>
            </div>
            <div>
              <span className="block text-black/60">Gudang tujuan</span>
              <span className="font-medium">{doc.toWarehouseName ?? "—"}</span>
            </div>
            <div>
              <span className="block text-black/60">Status</span>
              <span className="font-medium">{statusLabel}</span>
            </div>
            {doc.receivedAt ? (
              <div>
                <span className="block text-black/60">Diterima pada</span>
                <span className="font-medium">{formatDate(doc.receivedAt)}</span>
              </div>
            ) : null}
            <div>
              <span className="block text-black/60">Jumlah item</span>
              <span className="num font-medium">{lines.length} produk</span>
            </div>
            {doc.differenceReason ? (
              <div className="col-span-2">
                <span className="block text-black/60">Selisih perjalanan</span>
                <span className="font-medium">{doc.differenceReason}</span>
              </div>
            ) : null}
            {doc.notes ? (
              <div className="col-span-2">
                <span className="block text-black/60">Catatan</span>
                <span className="font-medium">{doc.notes}</span>
              </div>
            ) : null}
          </div>

          <table className="mt-4 w-full text-[12px]">
            <thead>
              <tr className="border-y border-black/60 text-left">
                <th className="w-8 py-1.5 pr-2 font-semibold">No</th>
                <th className="py-1.5 pr-2 font-semibold">Produk</th>
                <th className="w-24 py-1.5 pr-2 text-right font-semibold">Terkirim</th>
                <th className="w-24 py-1.5 pr-2 text-right font-semibold">Diterima</th>
                <th className="w-24 py-1.5 text-right font-semibold">Sisa</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const batches = batchesByProduct.get(line.productId) ?? [];
                const lineSerials = serialsByProduct.get(line.productId) ?? [];
                const remaining = Number(line.qty) - Number(line.receivedQty);
                return (
                  <tr key={line.id} className="border-b border-black/15 align-top">
                    <td className="num py-1.5 pr-2">{index + 1}</td>
                    <td className="py-1.5 pr-2">
                      <p className="font-medium">{line.productName}</p>
                      <p className="num text-[10px] text-black/60">{line.sku ?? ""}</p>
                      {batches.length > 0 ? (
                        <p className="num text-[10px] text-black/60">Batch: {batches.join(", ")}</p>
                      ) : null}
                      {lineSerials.length > 0 ? (
                        <p className="num text-[10px] text-black/60">Seri: {lineSerials.join(", ")}</p>
                      ) : null}
                    </td>
                    <td className="num py-1.5 pr-2 text-right">
                      {/* S3: kiriman berkemasan dicetak dua bentuk —
                          satuan masukan dulu, satuan dasar menyusul. */}
                      {line.packagingId && line.packagingName
                        ? `${formatQty(line.qtyInput)} ${line.packagingName} (${formatQty(line.qty)}${line.unitName ? ` ${line.unitName}` : ""})`
                        : formatQty(line.qty)}
                    </td>
                    <td className="num py-1.5 pr-2 text-right">{formatQty(line.receivedQty)}</td>
                    <td className="num py-1.5 text-right">{remaining > 0 ? formatQty(remaining) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="mt-3 text-[11px] leading-5">
            Penerima wajib memeriksa isi kiriman terhadap fisik yang tiba sebelum menandatangani.
            Selisih dicatat pada form penerimaan transfer di sistem beserta alasannya.
          </p>

          {/* Kondisi fisik tidak disimpan sebagai data dokumen; area ini
              disediakan untuk diisi penerima saat serah-terima. */}
          <div className="mt-3 break-inside-avoid border border-black/30 px-3 py-2 text-[11px]">
            <p className="font-semibold">Kondisi barang saat diterima</p>
            <p className="mt-1.5 leading-5">
              ☐ Baik &nbsp; ☐ Rusak &nbsp; ☐ Basah &nbsp;·&nbsp; Catatan: {" "}
              <span className="inline-block w-48 border-b border-dotted border-black/50 align-bottom" />
            </p>
          </div>

          {doc.status === "void" ? (
            <p className="mt-3 border-y-2 border-double border-black py-1.5 text-center text-[13px] font-bold uppercase tracking-widest text-black">
              Dokumen dibatalkan — tidak berlaku
            </p>
          ) : null}

          <PrintFooter
            settings={printSettings}
            documentNumber={doc.number}
            variant="document"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.documentPaper).qrMm}
            signatures={applySignatureLabels(printSettings, "transfer", [
              { label: "Pengirim (gudang asal)", name: doc.warehouseName ?? "Petugas gudang" },
              { label: "Penerima (gudang tujuan)", name: doc.toWarehouseName ?? "Petugas gudang" },
            ])}
          />
        </PrintShell>
      </div>
    </div>
  );
}
