"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageCheck, ScanBarcode } from "lucide-react";
import { toast } from "sonner";
import { d, formatQty } from "@/lib/money";
import { receiveTransferAction } from "@/server/actions/reservations";
import { searchInventoryProductsAction } from "@/server/actions/inventory/produk";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { DateField } from "@/components/date-field";
import { QtyInput } from "@/components/qty-input";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";

export type TransferReceiveLine = {
  productId: string;
  productName: string;
  sku: string | null;
  shippedQty: string;
  /** S3: bentuk masukan berkemasan kiriman ("10 Dus") — info saja;
   * penerimaan tetap dicatat dalam satuan dasar. */
  shippedInputLabel?: string | null;
  receivedQty: string;
  trackSerial: boolean;
  /** Nomor seri yang sedang dalam perjalanan atas dokumen ini. */
  inTransitSerials: string[];
  /** Ringkasan batch kiriman, mis. "B-01 (×5), B-02 (×3)". */
  batchSummary?: string;
};

/**
 * FIX-GDG Tahap 4 (butir a; domain FIX-GDG Tahap 2 GDG1-07) — formulir
 * penerimaan transfer SEBAGIAN + penutupan selisih beralasan.
 *
 * Domain & aksi sudah menerima `lines`/`closeRemainder`/
 * `differenceReason` sejak Tahap 2, tetapi satu-satunya layar yang ada
 * adalah tombol "Terima di Tujuan" yang menerima SELURUH sisa kirim —
 * penerima tidak bisa memeriksa isi, mencatat penerimaan sebagian,
 * atau menutup barang hilang/rusak di jalan sebagai selisih perjalanan
 * beralasan. Formulir ini adalah layarnya, di halaman detail transfer.
 *
 * Catatan kontrak domain: baris yang TIDAK dikirim dianggap diterima
 * penuh — jadi formulir ini selalu mengirim SEMUA baris bersisa dengan
 * qty eksplisitnya (termasuk 0 untuk yang ditahan di perjalanan).
 *
 * A-24 T3: kolom per baris kini Diminta · Terkonfirmasi · Selisih
 * berstatus warna (pola G2) dan simpan berselisih melewati dialog
 * ringkasan selisih; kotak pindai di atas tabel menambah terkonfirmasi
 * per pindaian produk / menandai seri (pola G1). Domain tidak berubah.
 */
export function TransferReceiveForm({
  documentId,
  number,
  lines,
  today,
}: {
  documentId: string;
  number: string;
  lines: TransferReceiveLine[];
  today: string;
}) {
  const router = useRouter();
  const remainingOf = (line: TransferReceiveLine) =>
    d(line.shippedQty).minus(d(line.receivedQty));
  const openLines = lines.filter((line) => remainingOf(line).gt(0));

  const [qtyByProduct, setQtyByProduct] = useState<Record<string, string>>(() =>
    Object.fromEntries(openLines.map((line) => [line.productId, remainingOf(line).toString()])),
  );
  const [serialsByProduct, setSerialsByProduct] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(openLines.map((line) => [line.productId, [...line.inTransitSerials]])),
  );
  const [date, setDate] = useState(today);
  const [closeRemainder, setCloseRemainder] = useState(false);
  const [differenceReason, setDifferenceReason] = useState("");
  const [busy, setBusy] = useState(false);
  // A-24 T3 (G2): gerbang ringkasan selisih sebelum simpan.
  const [confirmOpen, setConfirmOpen] = useState(false);
  // A-24 T3 (G1): pindai produk/seri di dalam dokumen.
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  function toggleSerial(productId: string, serialNumber: string, checked: boolean) {
    setSerialsByProduct((current) => {
      const selected = new Set(current[productId] ?? []);
      if (checked) selected.add(serialNumber);
      else selected.delete(serialNumber);
      return { ...current, [productId]: [...selected] };
    });
  }

  /** Qty terkonfirmasi baris saat ini (seri: jumlah seri terpilih). */
  function confirmedOf(line: TransferReceiveLine) {
    if (line.trackSerial) return d((serialsByProduct[line.productId] ?? []).length);
    return d(qtyByProduct[line.productId] || 0);
  }

  /** Baris berselisih saat ini: terkonfirmasi ≠ diminta (sisa kirim). */
  const diffLines = openLines
    .map((line) => ({
      line,
      remaining: remainingOf(line),
      confirmed: confirmedOf(line),
    }))
    .filter((row) => !row.confirmed.eq(row.remaining));

  /**
   * Gerbang G2: validasi dasar berjalan dulu; bila ada selisih ≠ 0,
   * ringkasan selisih WAJIB terbaca lewat ConfirmDialog sebelum
   * simpan; bila semua baris pas, simpan langsung tanpa dialog.
   */
  function submit() {
    for (const line of openLines) {
      const received = confirmedOf(line);
      if (!received.isFinite() || received.isNegative()) {
        toast.error(`Qty diterima untuk ${line.productName} tidak valid.`);
        return;
      }
      if (received.gt(remainingOf(line))) {
        toast.error(
          `Qty diterima untuk ${line.productName} melebihi sisa kirim (${formatQty(remainingOf(line))}).`,
        );
        return;
      }
    }
    if (diffLines.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void doSubmit();
  }

  /**
   * A-24 T3 (G1): pindai di dalam dokumen — memindai nomor seri
   * menandai seri itu diterima; memindai barcode/SKU produk menambah
   * terkonfirmasi +1 pada barisnya (dibatasi sisa kirim).
   */
  async function handleScan(rawCode: string) {
    const code = rawCode.trim();
    if (!code) return;
    for (const line of openLines) {
      if (line.inTransitSerials.includes(code)) {
        toggleSerial(line.productId, code, true);
        setScanMessage(`Seri ${code} ditandai diterima (${line.productName}).`);
        return;
      }
    }
    const search = await searchInventoryProductsAction(code);
    const exact = search.ok
      ? (search.data.find((row) => row.barcode === code) ??
        search.data.find((row) => row.sku === code))
      : undefined;
    if (!exact) {
      setScanMessage(`Kode "${code}" tidak dikenal.`);
      return;
    }
    const line = openLines.find((row) => row.productId === exact.id);
    if (!line) {
      setScanMessage(`${exact.name} tidak ada di kiriman ini.`);
      return;
    }
    if (line.trackSerial) {
      setScanMessage(
        `${line.productName} dilacak per seri — pindai nomor serinya atau centang serinya di baris.`,
      );
      return;
    }
    const remaining = remainingOf(line);
    const next = confirmedOf(line).plus(1);
    if (next.gt(remaining)) {
      setScanMessage(`${line.productName} sudah terkonfirmasi penuh (${formatQty(remaining)}).`);
      return;
    }
    setQtyByProduct((current) => ({ ...current, [line.productId]: next.toString() }));
    setScanMessage(`${line.productName}: terkonfirmasi ${formatQty(next)} dari ${formatQty(remaining)}.`);
  }

  async function doSubmit() {
    const payloadLines: { productId: string; receivedQty: string; serialNumbers?: string[] }[] = [];
    let totalReceived = d(0);
    let leftoverAfter = d(0);
    for (const line of openLines) {
      const remaining = remainingOf(line);
      let received: ReturnType<typeof d>;
      let serialNumbers: string[] | undefined;
      if (line.trackSerial) {
        serialNumbers = serialsByProduct[line.productId] ?? [];
        received = d(serialNumbers.length);
      } else {
        received = d(qtyByProduct[line.productId] || 0);
      }
      if (!received.isFinite() || received.isNegative()) {
        toast.error(`Qty diterima untuk ${line.productName} tidak valid.`);
        return;
      }
      if (received.gt(remaining)) {
        toast.error(
          `Qty diterima untuk ${line.productName} melebihi sisa kirim (${formatQty(remaining)}).`,
        );
        return;
      }
      totalReceived = totalReceived.plus(received);
      leftoverAfter = leftoverAfter.plus(remaining.minus(received));
      payloadLines.push({
        productId: line.productId,
        receivedQty: received.toString(),
        ...(serialNumbers ? { serialNumbers } : {}),
      });
    }
    if (totalReceived.lte(0) && !(closeRemainder && leftoverAfter.gt(0))) {
      toast.error("Belum ada qty yang diterima pada penerimaan ini.");
      return;
    }
    if (closeRemainder && leftoverAfter.gt(0) && differenceReason.trim().length < 3) {
      toast.error("Alasan selisih perjalanan wajib diisi (minimal 3 karakter) saat sisa kirim ditutup sebagai selisih.");
      return;
    }
    setBusy(true);
    const result = await receiveTransferAction({
      documentId,
      date,
      lines: payloadLines,
      closeRemainder,
      differenceReason: differenceReason.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(
      closeRemainder && leftoverAfter.gt(0)
        ? `Transfer ${number} diterima; sisa kirim ditutup sebagai selisih perjalanan.`
        : `Penerimaan transfer ${number} tersimpan — stok tujuan bertambah sesuai qty diterima.`,
    );
    router.refresh();
  }

  if (openLines.length === 0) return null;

  return (
    <section className="mt-4 rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Terima di gudang tujuan</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Periksa isi kiriman terhadap fisik yang tiba, isi qty yang benar-benar diterima per
          baris. Sisa yang tidak diterima tetap Dalam Perjalanan dan dapat diterima lagi, atau
          ditutup sebagai selisih perjalanan dengan alasan.
        </p>
      </div>
      <div className="space-y-3 p-4">
        {/* A-24 T3 (G1): pindai produk/seri langsung di dokumen —
            setiap pindaian menambah terkonfirmasi barisnya. */}
        <div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <ScanBarcode className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={scanRef}
                placeholder="Pindai barcode produk / nomor seri untuk menandai diterima…"
                aria-label="Pindai produk atau nomor seri"
                autoComplete="off"
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const value = event.currentTarget.value;
                  event.currentTarget.value = "";
                  void handleScan(value);
                }}
                className="num h-9 w-full rounded-md border border-input bg-background pl-9 pr-2 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
              />
            </div>
          </div>
          {scanMessage ? (
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground" role="status">
              {scanMessage}
            </p>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-[12px]">
            <thead className="bg-muted/60 text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left">Produk</th>
                <th className="px-2 py-1.5 text-right">Terkirim</th>
                <th className="px-2 py-1.5 text-right">Sudah diterima</th>
                <th className="px-2 py-1.5 text-right">Diminta</th>
                <th className="px-2 py-1.5 text-right">Terkonfirmasi</th>
                <th className="px-2 py-1.5 text-right">Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {openLines.map((line) => {
                const remaining = remainingOf(line);
                return (
                  <tr key={line.productId}>
                    <td className="px-2 py-1.5">
                      <p className="max-w-[260px] truncate font-medium">{line.productName}</p>
                      <p className="num text-[10px] text-muted-foreground">{line.sku ?? ""}</p>
                      {line.batchSummary ? (
                        <p className="num text-[10px] text-muted-foreground">Batch: {line.batchSummary}</p>
                      ) : null}
                      {line.trackSerial ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {line.inTransitSerials.map((serialNumber) => {
                            const checked = (serialsByProduct[line.productId] ?? []).includes(serialNumber);
                            return (
                              <label
                                key={serialNumber}
                                className={`inline-flex cursor-pointer items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                                  checked ? "border-primary bg-primary/10" : "border-border text-muted-foreground"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(event) => toggleSerial(line.productId, serialNumber, event.target.checked)}
                                  className="size-3"
                                />
                                <span className="num">{serialNumber}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : null}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-muted-foreground">
                      {formatQty(line.shippedQty)}
                      {line.shippedInputLabel ? (
                        <span className="block text-[10px]">dari {line.shippedInputLabel}</span>
                      ) : null}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-muted-foreground">{formatQty(line.receivedQty)}</td>
                    <td className="num px-2 py-1.5 text-right font-medium">{formatQty(remaining)}</td>
                    <td className="px-2 py-1.5">
                      {line.trackSerial ? (
                        <p className="num text-right text-[12px]">
                          {(serialsByProduct[line.productId] ?? []).length} seri dipilih
                        </p>
                      ) : (
                        <QtyInput
                          value={qtyByProduct[line.productId] ?? ""}
                          onChange={(value) =>
                            setQtyByProduct((current) => ({ ...current, [line.productId]: value }))
                          }
                          aria-label={`Qty diterima ${line.productName}`}
                          wrapperClassName="w-20"
                          className="w-full rounded px-1.5 text-[12px] focus:ring-2 focus:ring-ring/20"
                        />
                      )}
                    </td>
                    <td className="num px-2 py-1.5 text-right">
                      {(() => {
                        // A-24 T3 (G2): selisih hidup per baris —
                        // Pas (hijau), Kurang (kuning), Lebih (merah).
                        const diff = remaining.minus(confirmedOf(line));
                        if (diff.eq(0)) {
                          return (
                            <span className="rounded-full bg-tone-green-soft px-2 py-0.5 text-[10px] font-semibold text-tone-green">
                              Pas
                            </span>
                          );
                        }
                        return diff.gt(0) ? (
                          <span className="rounded-full bg-tone-amber-soft px-2 py-0.5 text-[10px] font-semibold text-tone-amber">
                            Kurang {formatQty(diff)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-tone-red-soft px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            Lebih {formatQty(diff.negated())}
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className={labelClass}>Tanggal terima</span>
            <DateField value={date} onChange={setDate} aria-label="Tanggal terima" />
          </label>
          <label className="flex items-end gap-2 pb-1 text-[12px] leading-5 sm:col-span-2">
            <input
              type="checkbox"
              checked={closeRemainder}
              onChange={(event) => setCloseRemainder(event.target.checked)}
              className="mb-0.5 size-4"
            />
            <span>
              Tutup seluruh sisa kirim sesudah penerimaan ini sebagai{" "}
              <span className="font-medium">selisih perjalanan</span> (barang hilang/rusak di
              jalan — dicatat sebagai beban susut persediaan beralasan, bukan stok tujuan).
            </span>
          </label>
        </div>
        {closeRemainder ? (
          <label className="block space-y-1">
            <span className={labelClass}>Alasan selisih perjalanan (wajib)</span>
            <input
              value={differenceReason}
              onChange={(event) => setDifferenceReason(event.target.value)}
              placeholder="Contoh: 2 karton rusak terkena air selama pengiriman, berita acara terlampir"
              className={fieldClass}
            />
          </label>
        ) : null}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => submit()}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            <PackageCheck className="size-3.5" /> {busy ? "Menerima…" : "Simpan penerimaan"}
          </button>
        </div>
      </div>

      {/* A-24 T3 (G2): ringkasan selisih — validasi berselisih tidak
          bisa terlewat tanpa ringkasan ini terbaca. */}
      <ConfirmDialog
        open={confirmOpen}
        title={`Ringkasan selisih — ${number}`}
        confirmLabel="Ya, simpan penerimaan"
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void doSubmit();
        }}
        description={
          <div className="space-y-2">
            <p>
              {diffLines.length} baris belum diterima persis sejumlah yang diminta:
            </p>
            <ul className="list-disc space-y-1 pl-4">
              {diffLines.map(({ line, remaining, confirmed }) => {
                const diff = remaining.minus(confirmed);
                return (
                  <li key={line.productId}>
                    <span className="font-medium text-foreground">{line.productName}</span> —
                    diminta {formatQty(remaining)}, terkonfirmasi {formatQty(confirmed)},{" "}
                    {diff.gt(0)
                      ? `kurang ${formatQty(diff)}`
                      : `lebih ${formatQty(diff.negated())}`}
                  </li>
                );
              })}
            </ul>
            <p>
              {closeRemainder
                ? "Sisa yang kurang akan DITUTUP sebagai selisih perjalanan beralasan (beban susut persediaan) — pastikan alasan selisih perjalanan terisi di form."
                : "Sisa yang kurang tetap Dalam Perjalanan dan dapat diterima lagi pada penerimaan berikutnya; stok tujuan bertambah hanya sejumlah yang terkonfirmasi."}
            </p>
          </div>
        }
      />
    </section>
  );
}
