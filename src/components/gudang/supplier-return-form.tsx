"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createSupplierReturnAction,
  postSupplierReturnAction,
  supplierReturnProductInfoAction,
} from "@/server/actions/supplier-returns";
import { ProductPicker, type PickedPackaging } from "@/components/gudang/product-picker";
import { d, formatIDR, formatQty } from "@/lib/money";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { DocumentForm } from "@/components/blocks/document-form";
import { DateField } from "@/components/date-field";
import { QtyInput } from "@/components/qty-input";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

type LabelOption = { value: string; label: string };

type BatchOption = { id: string; batchNumber: string | null; expiryDate: string | null; qty: string };

type ReturnLine = {
  key: number;
  productId: string;
  name: string;
  sku: string;
  qty: string;
  trackBatch: boolean;
  batchId: string;
  stock: number | null;
  batches: BatchOption[];
  /** Harga pokok master produk saat dipilih — HANYA untuk perkiraan
   * nilai retur hidup di rel ringkasan. Nilai posting tetap dibekukan
   * domain dari AVCO berjalan; field ini tidak dikirim ke server.
   * null = harga pokok tidak terlihat bagi petugas (tanpa
   * inventory.cost, R3 K-3) — perkiraan nilai disembunyikan. */
  unitCost: string | null;
  /** Satuan kemasan (S2): kemasan aktif produk + pilihan baris ini.
   * qty baris dinyatakan dalam kemasan terpilih; kosong = satuan dasar. */
  packagings: PickedPackaging[];
  packagingId: string;
};

/** Qty baris retur dalam SATUAN DASAR (qty masukan × isi kemasan). */
function returnLineBaseQty(line: ReturnLine) {
  const pack = line.packagings.find((row) => row.id === line.packagingId);
  const qty = displayDecimal(line.qty);
  return pack ? qty.mul(d(pack.isi)) : qty;
}

/** Perkiraan nilai satu baris; null bila harga pokok tidak terlihat. */
function lineEstimatedValue(line: ReturnLine) {
  return line.unitCost === null
    ? null
    : returnLineBaseQty(line).mul(displayDecimal(line.unitCost));
}

/** Parse aman untuk tampilan hidup: ketikan qty yang belum terbaca
 * angka dinilai 0 di ringkasan (validasi kirim tetap jalan asal). */
function displayDecimal(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? d(parsed) : d(0);
}

/**
 * RET-2: formulir Retur Pembelian (RTB). Nilai barang tidak diisi di
 * sini — domain membekukannya pada AVCO berjalan saat posting, jadi
 * formulir hanya menangkap barang, jumlah, alasan, dan rencana
 * penyelesaian. Label kategori & jenis penyelesaian diteruskan dari
 * domain lewat props halaman server (satu sumber string).
 *
 * A-25 U3 (GDG-01): urutan form mengikuti urutan kerja — (1) pemasok &
 * gudang asal, (2) PILIHAN BARANG yang diretur (dulu paling bawah),
 * (3) alasan & rencana penyelesaian, (4) catatan — dibingkai
 * DocumentForm dengan perkiraan nilai retur hidup di rel ringkasan.
 */
export function SupplierReturnForm({
  suppliers,
  warehouses,
  defaultWarehouseId,
  today,
  reasonOptions,
  resolutionOptions,
}: {
  suppliers: { id: string; name: string }[];
  warehouses: { id: string; name: string }[];
  defaultWarehouseId?: string;
  today: string;
  reasonOptions: LabelOption[];
  resolutionOptions: LabelOption[];
}) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  // GDG3-06: kunci idempotensi per pembukaan form (lihat receipt-form).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  const [date, setDate] = useState(today);
  const [reasonCategory, setReasonCategory] = useState(reasonOptions[0]?.value ?? "damaged");
  const [reasonDetail, setReasonDetail] = useState("");
  const [resolutionType, setResolutionType] = useState(resolutionOptions[0]?.value ?? "replacement");
  const [resolutionNote, setResolutionNote] = useState("");
  const [lines, setLines] = useState<ReturnLine[]>([]);
  const [busy, setBusy] = useState<"" | "draft" | "post">("");
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const infoSeq = useRef(0);
  const lineKey = useRef(0);

  function handleCancelClick() {
    if (lines.length > 0 || reasonDetail.trim().length > 0) {
      setConfirmCancelOpen(true);
    } else {
      router.back();
    }
  }

  async function loadInfo(line: ReturnLine, forWarehouseId: string): Promise<ReturnLine> {
    const result = await supplierReturnProductInfoAction({
      warehouseId: forWarehouseId,
      productId: line.productId,
    });
    if (!result.ok) return { ...line, stock: 0, batches: [] };
    return { ...line, stock: result.data.stock, batches: result.data.batches };
  }

  // Gudang berganti: stok & batch semua baris diambil ulang untuk gudang
  // baru, dan pilihan batch direset (batch terikat gudang).
  useEffect(() => {
    if (!warehouseId) return;
    const current = ++infoSeq.current;
    setLines((currentLines) => {
      if (currentLines.length === 0) return currentLines;
      void (async () => {
        const refreshed = await Promise.all(
          currentLines.map((line) => loadInfo({ ...line, batchId: "", stock: null, batches: [] }, warehouseId)),
        );
        if (current !== infoSeq.current) return;
        setLines(refreshed);
      })();
      return currentLines.map((line) => ({ ...line, batchId: "", stock: null, batches: [] }));
    });
  }, [warehouseId]);

  async function addProduct(product: { id: string; name: string; sku: string; trackBatch?: boolean; costPrice?: string | null; packagings?: PickedPackaging[]; scannedPackagingId?: string | null }) {
    const trackBatch = product.trackBatch ?? false;
    if (!trackBatch && lines.some((line) => line.productId === product.id)) {
      toast.info(`${product.name} sudah ada di daftar — ubah jumlahnya di barisnya.`);
      return;
    }
    if (!warehouseId) {
      toast.error("Pilih gudang asal barang terlebih dahulu.");
      return;
    }
    const packagings = product.packagings ?? [];
    const line: ReturnLine = {
      key: ++lineKey.current,
      productId: product.id,
      name: product.name,
      sku: product.sku,
      qty: "1",
      trackBatch,
      batchId: "",
      stock: null,
      batches: [],
      unitCost: product.costPrice ?? null,
      packagings,
      // Pindai barcode dus memilih kemasan itu untuk baris retur ini.
      packagingId:
        packagings.find((row) => row.id === product.scannedPackagingId)?.id ?? "",
    };
    setLines((current) => [...current, line]);
    const loaded = await loadInfo(line, warehouseId);
    setLines((current) =>
      current.map((row) => (row.key === line.key ? { ...row, stock: loaded.stock, batches: loaded.batches } : row)),
    );
  }

  function update(index: number, patch: Partial<ReturnLine>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  async function submit(mode: "draft" | "post") {
    if (!supplierId) {
      toast.error("Pilih pemasok tujuan retur.");
      return;
    }
    if (!warehouseId) {
      toast.error("Pilih gudang asal barang.");
      return;
    }
    if (reasonDetail.trim().length < 3) {
      toast.error("Isi alasan retur dengan jelas — kategori saja tidak cukup. Ceritakan kondisi barangnya.");
      return;
    }
    if (lines.length === 0) {
      toast.error("Tambahkan minimal satu barang yang diretur.");
      return;
    }
    const badQty = lines.find((line) => !(Number(line.qty) > 0));
    if (badQty) {
      toast.error(`Jumlah retur ${badQty.name} harus lebih dari 0.`);
      return;
    }
    const seen = new Set<string>();
    for (const line of lines) {
      const identity = `${line.productId}|${line.batchId}`;
      if (seen.has(identity)) {
        toast.error(`${line.name} muncul dua kali untuk batch yang sama — gabungkan jumlahnya.`);
        return;
      }
      seen.add(identity);
    }
    setBusy(mode);
    const created = await createSupplierReturnAction({
      supplierId,
      warehouseId,
      idempotencyKey,
      date,
      reasonCategory: reasonCategory as "damaged" | "expired" | "wrong_item" | "over_delivery" | "quality" | "other",
      reasonDetail: reasonDetail.trim(),
      resolutionType: resolutionType as
        | "replacement"
        | "next_purchase_credit"
        | "purchase_advance"
        | "refund"
        | "other",
      resolutionNote: resolutionNote.trim() ? resolutionNote.trim() : undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        batchId: line.batchId || null,
        // S2: qty dinyatakan dalam kemasan terpilih (domain mengonversi).
        packagingId: line.packagingId || null,
      })),
    });
    if (!created.ok) {
      setBusy("");
      toast.error(created.message);
      return;
    }
    if (mode === "draft") {
      toast.success(`Draf retur ${created.data.number} tersimpan. Posting dari halaman detail bila sudah yakin.`);
      router.push(`/app/gudang/retur-pembelian/${created.data.id}`);
      router.refresh();
      return;
    }
    const posted = await postSupplierReturnAction({ returnId: created.data.id });
    setBusy("");
    if (!posted.ok) {
      toast.error(`Draf ${created.data.number} tersimpan, tetapi posting gagal: ${posted.message}`);
      router.push(`/app/gudang/retur-pembelian/${created.data.id}`);
      router.refresh();
      return;
    }
    toast.success(
      `Retur ${posted.data.number} terposting. Nilai ${formatIDR(posted.data.totalValue)} — memotong utang ${formatIDR(posted.data.payableAmount)}, klaim kredit ${formatIDR(posted.data.creditAmount)}.${
        resolutionType === "purchase_advance"
          ? d(posted.data.creditAmount).gt(0)
            ? ` Sisa kredit ${formatIDR(posted.data.creditAmount)} menjadi uang muka pembelian berikutnya.`
            : " Tidak ada sisa kredit — seluruh nilai retur memotong utang terbuka."
          : ""
      }`,
    );
    router.push(`/app/gudang/retur-pembelian/${created.data.id}`);
    router.refresh();
  }

  // GDG-01: nilai retur HIDUP selama pengisian — perkiraan dari
  // harga pokok master produk terpilih × qty retur (Decimal dari
  // lib/money, sama seperti total editor baris gudang). Murni
  // tampilan: nilai resmi tetap dibekukan domain dari AVCO saat
  // posting, dan perkiraan ini tidak dikirim ke server.
  // K-3: bila ada baris yang harga pokoknya tidak terlihat, perkiraan
  // total tidak ditampilkan (angka sebagian menyesatkan) — sama seperti
  // total opname. Baris individualnya pun tampil "—".
  const hasHiddenCost = lines.some((line) => line.unitCost === null);
  const estimatedTotal = lines.reduce(
    (acc, line) =>
      line.unitCost === null
        ? acc
        : acc.plus(returnLineBaseQty(line).mul(displayDecimal(line.unitCost))),
    d(0),
  );
  const estimatedQty = lines.reduce((acc, line) => acc.plus(returnLineBaseQty(line)), d(0));
  const supplierName = suppliers.find((row) => row.id === supplierId)?.name;
  const warehouseName = warehouses.find((row) => row.id === warehouseId)?.name;

  return (
    <DocumentForm
      header={
        <div className="p-4">
          <p className="mb-2 text-[12px] font-semibold">1 · Pemasok & gudang asal</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1">
              <span className={labelClass}>Pemasok tujuan retur</span>
              <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} className={fieldClass}>
                {suppliers.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Gudang asal barang</span>
              <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={fieldClass}>
                {warehouses.map((row) => (
                  <option key={row.id} value={row.id}>{row.name}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Tanggal retur</span>
              <DateField value={date} onChange={setDate} className={fieldClass} />
            </label>
          </div>
        </div>
      }
      summary={
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <p className="text-[11px] font-semibold text-muted-foreground">Perkiraan nilai retur</p>
          <p className="num mt-1 text-[16px] font-semibold">{hasHiddenCost ? "—" : formatIDR(estimatedTotal)}</p>
          <dl className="mt-2 space-y-1 text-[11px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Pemasok</dt>
              <dd className="min-w-0 text-right font-medium">{supplierName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Gudang asal</dt>
              <dd className="min-w-0 text-right font-medium">{warehouseName ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Jenis barang</dt>
              <dd className="num font-medium">{formatQty(lines.length)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total qty retur</dt>
              <dd className="num font-medium">{formatQty(estimatedQty)}</dd>
            </div>
          </dl>
          <p className="mt-2 border-t border-border pt-2 text-[11px] leading-5 text-muted-foreground">
            Perkiraan dari harga pokok produk saat ini. Nilai resmi dibekukan dari harga pokok
            rata-rata (AVCO) berjalan saat dokumen diposting.
          </p>
        </div>
      }
      guide={
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Pilih pemasok dan gudang asal dulu — stok & batch baris mengikuti gudang yang dipilih.</li>
          <li>Posting mengeluarkan stok dan menilai barang pada AVCO hari itu; draf belum menggerakkan apa pun.</li>
          <li>Nilai retur memotong utang pemasok lebih dulu; sisanya menjadi klaim Kredit Pemasok.</li>
          <li>Pilihan “Jadikan uang muka pembelian berikutnya” memindahkan sisa kredit ke Gudang → Uang muka, lalu dipotong otomatis pada penerimaan berikutnya.</li>
          <li>Produk terlacak batch dapat dipilih batchnya, atau biarkan Otomatis (FEFO).</li>
        </ul>
      }
      actions={
        <>
          <ConfirmDialog
            open={confirmCancelOpen}
            title="Buang draf retur pembelian?"
            description="Data barang dan alasan yang sudah dimasukkan akan hilang dan tidak tersimpan."
            confirmLabel="Ya, buang draf"
            cancelLabel="Lanjutkan mengisi"
            danger
            onConfirm={() => {
              setConfirmCancelOpen(false);
              router.back();
            }}
            onCancel={() => setConfirmCancelOpen(false)}
          />
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={handleCancelClick}
              disabled={busy !== ""}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              Batal / Tutup
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submit("draft")}
                disabled={busy !== ""}
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
              >
                {busy === "draft" ? "Menyimpan…" : "Simpan sebagai Draf"}
              </button>
              <button
                type="button"
                onClick={() => submit("post")}
                disabled={busy !== ""}
                className="inline-flex h-8 items-center rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy === "post" ? "Memposting…" : "Simpan & Posting"}
              </button>
            </div>
          </div>
        </>
      }
    >
      <div>
        {/* (2) GDG-01: pilihan barang NAIK ke atas — petugas memilih
            barang dulu, baru menulis alasan & rencana. */}
        <div className="p-4">
          <p className="mb-2 text-[12px] font-semibold">2 · Barang yang diretur</p>
          <div className="space-y-2">
            <ProductPicker onPick={addProduct} placeholder="Cari produk yang diretur…" />
            {lines.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[11px] text-muted-foreground">
                Belum ada baris. Cari dan pilih produk di atas. Nilai retur dihitung otomatis dari harga pokok rata-rata (AVCO) saat dokumen diposting.
              </p>
            ) : (
              <>
                {/* Desktop: tabel baris dengan kolom angka rata kanan agar
                    qty, stok, dan nilai terbaca satu garis. */}
                <div className="hidden overflow-hidden rounded-lg border border-border md:block">
                  <table className="w-full table-fixed text-[12px]">
                    <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-semibold">Produk</th>
                        <th scope="col" className="w-[180px] px-3 py-2 text-left font-semibold">Batch</th>
                        <th scope="col" className="w-[80px] px-3 py-2 text-right font-semibold">Stok</th>
                        <th scope="col" className="w-[110px] px-3 py-2 text-right font-semibold">Qty retur</th>
                        <th scope="col" className="w-[130px] px-3 py-2 text-right font-semibold">Nilai perkiraan</th>
                        <th scope="col" className="w-[44px] px-2 py-2">
                          <span className="sr-only">Aksi</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/70">
                      {lines.map((line, index) => {
                        const value = lineEstimatedValue(line);
                        return (
                          <tr key={line.key} className="align-middle transition-colors hover:bg-muted/20">
                            <td className="px-3 py-2.5">
                              <p className="truncate font-medium">{line.name}</p>
                              <p className="num text-[10px] text-muted-foreground">{line.sku}</p>
                              {line.packagings.length > 0 ? (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  <select
                                    value={line.packagingId}
                                    onChange={(event) => update(index, { packagingId: event.target.value })}
                                    aria-label={`Satuan baris ${line.name}`}
                                    className="h-7 rounded-md border border-input bg-background px-1.5 text-[11px]"
                                  >
                                    <option value="">Satuan dasar</option>
                                    {line.packagings.map((pack) => (
                                      <option key={pack.id} value={pack.id}>
                                        {pack.name} · isi {formatQty(pack.isi)}
                                      </option>
                                    ))}
                                  </select>
                                  {line.packagingId ? (
                                    <span className="text-[10px] text-muted-foreground">
                                      = {formatQty(returnLineBaseQty(line))} satuan dasar
                                    </span>
                                  ) : null}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-3 py-2.5">
                              {line.trackBatch ? (
                                <select
                                  value={line.batchId}
                                  onChange={(event) => update(index, { batchId: event.target.value })}
                                  aria-label={`Batch ${line.name}`}
                                  className="h-8 w-full rounded-md border border-input bg-background px-1.5 text-[11px]"
                                >
                                  <option value="">Otomatis (FEFO)</option>
                                  {line.batches.map((batch) => (
                                    <option key={batch.id} value={batch.id}>
                                      {batch.batchNumber ?? "(tanpa nomor)"}
                                      {batch.expiryDate ? ` · ED ${batch.expiryDate}` : ""} · sisa {formatQty(batch.qty)}
                                    </option>
                                  ))}
                                </select>
                              ) : (
                                <span className="text-[11px] text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="num px-3 py-2.5 text-right text-muted-foreground">
                              {line.stock === null ? "…" : formatQty(line.stock)}
                            </td>
                            <td className="px-3 py-2.5">
                              {/* G2 (FRM-03): QtyInput bersama. */}
                              <QtyInput
                                value={line.qty}
                                onChange={(value) => update(index, { qty: value })}
                                placeholder="0"
                                aria-label={`Qty retur ${line.name}`}
                                wrapperClassName="ml-auto w-24"
                                className="h-8 w-full px-2 text-[12px]"
                              />
                            </td>
                            <td className="num px-3 py-2.5 text-right font-medium">
                              {value === null ? "—" : formatIDR(value)}
                            </td>
                            <td className="px-2 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                                className="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                aria-label={`Hapus ${line.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Mobile: satu kartu per baris — tidak perlu menggeser tabel. */}
                <div className="space-y-2 md:hidden">
                  {lines.map((line, index) => {
                    const value = lineEstimatedValue(line);
                    return (
                      <div key={line.key} className="rounded-lg border border-border bg-card p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-medium">{line.name}</p>
                            <p className="num text-[10px] text-muted-foreground">{line.sku}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`Hapus ${line.name}`}
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        </div>

                        {line.packagings.length > 0 ? (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <select
                              value={line.packagingId}
                              onChange={(event) => update(index, { packagingId: event.target.value })}
                              aria-label={`Satuan baris ${line.name}`}
                              className="h-8 rounded-md border border-input bg-background px-1.5 text-[11px]"
                            >
                              <option value="">Satuan dasar</option>
                              {line.packagings.map((pack) => (
                                <option key={pack.id} value={pack.id}>
                                  {pack.name} · isi {formatQty(pack.isi)}
                                </option>
                              ))}
                            </select>
                            {line.packagingId ? (
                              <span className="text-[10px] text-muted-foreground">
                                = {formatQty(returnLineBaseQty(line))} satuan dasar
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {line.trackBatch ? (
                          <label className="mt-2 block space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Batch
                            </span>
                            <select
                              value={line.batchId}
                              onChange={(event) => update(index, { batchId: event.target.value })}
                              aria-label={`Batch ${line.name}`}
                              className="h-8 w-full rounded-md border border-input bg-background px-1.5 text-[11px]"
                            >
                              <option value="">Otomatis (FEFO — batch terlama dulu)</option>
                              {line.batches.map((batch) => (
                                <option key={batch.id} value={batch.id}>
                                  {batch.batchNumber ?? "(tanpa nomor)"}
                                  {batch.expiryDate ? ` · ED ${batch.expiryDate}` : ""} · sisa {formatQty(batch.qty)}
                                </option>
                              ))}
                            </select>
                          </label>
                        ) : null}

                        <div className="mt-2 grid grid-cols-2 items-end gap-3">
                          <div className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Stok di gudang
                            </span>
                            <span className="num block py-1.5 text-[12px] text-muted-foreground">
                              {line.stock === null ? "…" : formatQty(line.stock)}
                            </span>
                          </div>
                          <label className="block space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                              Qty retur
                            </span>
                            <QtyInput
                              value={line.qty}
                              onChange={(value) => update(index, { qty: value })}
                              placeholder="0"
                              aria-label={`Qty retur ${line.name}`}
                              wrapperClassName="w-full"
                              className="h-8 px-2 text-[12px]"
                            />
                          </label>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/70 pt-2">
                          <span className="text-[11px] text-muted-foreground">Nilai perkiraan</span>
                          <span className="num text-[12px] font-semibold">
                            {value === null ? "—" : formatIDR(value)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* (3) Alasan & rencana penyelesaian. */}
        <div className="space-y-3 border-t border-border p-4">
          <p className="text-[12px] font-semibold">3 · Alasan & rencana penyelesaian</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={labelClass}>Kategori alasan</span>
              <select value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)} className={fieldClass}>
                {reasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Penyelesaian yang direncanakan</span>
              <select value={resolutionType} onChange={(event) => setResolutionType(event.target.value)} className={fieldClass}>
                {resolutionOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </div>
          {resolutionType === "purchase_advance" ? (
            <p className="rounded-md border border-tone-teal/25 bg-tone-teal-soft px-3 py-2 text-[11px] leading-5 text-tone-teal">
              Saat diposting, nilai retur memotong utang terbuka pemasok lebih dulu. Sisa kreditnya otomatis
              menjadi <strong>Uang Muka Pembelian</strong> dan dapat dipotong pada penerimaan berikutnya.
            </p>
          ) : resolutionType === "next_purchase_credit" ? (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
              Sisa kredit tetap tercatat sebagai klaim pemasok dan dipotong saat pembelian berikutnya.
            </p>
          ) : null}
          <label className="block space-y-1">
            <span className={labelClass}>Alasan retur (wajib, tulis dengan jelas)</span>
            <textarea
              value={reasonDetail}
              onChange={(event) => setReasonDetail(event.target.value)}
              rows={2}
              maxLength={500}
              className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
              placeholder="cth. 20 karton susu UHT pecah & bocor saat dibongkar, batch B-114 sudah kedaluwarsa, atau warna tidak sesuai contoh…"
            />
          </label>
        </div>

        {/* (4) Catatan. */}
        <div className="border-t border-border p-4">
          <p className="mb-2 text-[12px] font-semibold">4 · Catatan</p>
          <label className="block space-y-1">
            <span className={labelClass}>Catatan penyelesaian (opsional)</span>
            <input
              value={resolutionNote}
              onChange={(event) => setResolutionNote(event.target.value)}
              maxLength={500}
              className={fieldClass}
              placeholder="cth. Pemasok janji kirim pengganti Jumat ini / potong di invoice berikutnya…"
            />
          </label>
        </div>
      </div>
    </DocumentForm>
  );
}
