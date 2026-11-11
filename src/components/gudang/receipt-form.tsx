"use client";

import { useEffect, useRef, useState } from "react";
import { newUuid } from "@/lib/uuid";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { receiveStockAction } from "@/server/actions/inventory/penerimaan";
import { listOpenPurchaseOrdersAction } from "@/server/actions/purchasing";
import {
  LineEditor,
  docLineBaseQty,
  docLineReceiptNet,
  type DocLine,
} from "@/components/gudang/line-editor";
import type { PickedPackaging } from "@/components/gudang/product-picker";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { d, formatIDR, formatQty } from "@/lib/money";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { DocumentForm, DocumentFormAdvanced } from "@/components/blocks/document-form";
import { DateField } from "@/components/date-field";
import { PercentInput } from "@/components/percent-input";
import { ReceiptAdvanceField } from "@/components/gudang/receipt-advance-field";
import { requireFilled } from "@/components/use-action-runner";

type OpenPurchaseOrder = {
  id: string;
  number: string;
  date: string;
  status: string;
  lines: {
    productId: string;
    productName: string;
    sku: string;
    trackBatch: boolean;
    trackSerial: boolean;
    qty: string;
    receivedQty: string;
    remainingQty: string;
    unitCost: string;
    // S2: cuplikan kemasan baris PO + opsi kemasan produk.
    packagingId: string | null;
    packagingName: string | null;
    qtyInput: string;
    isiSnapshot: string;
    packagings: PickedPackaging[];
    remainingInputQty: string | null;
    packagingUnitCost: string | null;
  }[];
};

// The six choices the user sees. "Pembelian tunai" is one receipt source
// (purchase) plus a payment account; the other five map 1:1 to D-5 sources.
type SourceChoice =
  | "purchase_credit"
  | "purchase_cash"
  | "opening"
  | "bonus"
  | "customer_return"
  | "other";

const SOURCE_OPTIONS: { value: SourceChoice; label: string; hint: string }[] = [
  {
    value: "purchase_credit",
    label: "Pembelian kredit",
    hint: "Stok bertambah dan menjadi utang pemasok. Tagihan dibayar kemudian dari menu Utang.",
  },
  {
    value: "purchase_cash",
    label: "Pembelian tunai",
    hint: "Stok bertambah dan langsung dibayar dari akun Kas/Bank pilihan — tidak menimbulkan utang.",
  },
  {
    value: "opening",
    label: "Stok awal",
    hint: "Persediaan awal perusahaan; lawan akunnya adalah Modal. Pemasok tidak diperlukan.",
  },
  {
    value: "bonus",
    label: "Bonus barang",
    hint: "Barang gratis dari pemasok; dicatat sebagai pendapatan lain-lain (atau pendapatan penjualan bila akun pendapatan lain-lain belum dipetakan).",
  },
  {
    value: "customer_return",
    label: "Retur pelanggan",
    hint: "Barang yang dikembalikan pelanggan masuk lagi ke stok; lawan akunnya adalah Retur penjualan.",
  },
  {
    value: "other",
    label: "Lainnya",
    hint: "Penerimaan di luar kategori di atas; lawan akunnya adalah Modal dan alasan wajib ditulis di catatan.",
  },
];

function StatRow({
  label,
  value,
  valueClass = "font-medium",
}: { label: string; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={valueClass}>{value}</dd>
    </div>
  );
}

export function ReceiptForm({
  warehouses,
  suppliers,
  paymentAccounts,
  defaultWarehouseId,
  today,
  taxRate = "0",
  taxInputMapped = false,
  initialPurchaseOrder = null,
  canPrice = false,
}: {
  warehouses: { id: string; name: string }[];
  suppliers: { id: string; name: string }[];
  paymentAccounts: { id: string; code: string; name: string }[];
  defaultWarehouseId?: string;
  today: string;
  /** Tarif PPN efektif perusahaan (persen); "0"/absen bila PPN nonaktif. */
  taxRate?: string;
  /** Akun PPN Masukan sudah dipetakan di Pengaturan. */
  taxInputMapped?: boolean;
  /** FIX-GDG Tahap 4 (GDG2-15): PO yang ditautkan dari halaman detail
   *  PO ("Terima barang") — form terbuka dengan pemasok & PO terpilih
   *  dan baris terisi dari sisa PO begitu daftar PO terbuka termuat. */
  initialPurchaseOrder?: { id: string; supplierId: string } | null;
  /** Izin ubah harga jual master (inventory.price). */
  canPrice?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(initialPurchaseOrder));
  // GDG3-06: satu kunci idempotensi per pembukaan form — submit ulang
  // (klik ganda / retry jaringan) mengembalikan dokumen pertama.
  // Diperbarui sesudah submit berhasil agar dokumen berikutnya baru.
  const [idempotencyKey, setIdempotencyKey] = useState(() => newUuid());
  const [sourceChoice, setSourceChoice] = useState<SourceChoice>("purchase_credit");
  const [warehouseId, setWarehouseId] = useState(defaultWarehouseId || warehouses[0]?.id || "");
  const [supplierId, setSupplierId] = useState(
    initialPurchaseOrder?.supplierId ?? suppliers[0]?.id ?? "",
  );
  const [paymentAccountId, setPaymentAccountId] = useState(paymentAccounts[0]?.id ?? "");
  // PPN dalam persen (0 = non-PPN). Harga baris diperlakukan DPP;
  // nominal PPN dihitung otomatis dan ditambahkan ke total.
  const [taxPercent, setTaxPercent] = useState(() =>
    d(taxRate || "0").gt(0) ? String(d(taxRate || "0").toNumber()) : "0",
  );
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [date, setDate] = useState(today);
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DocLine[]>([]);
  const [busy, setBusy] = useState(false);
  // G7/D-6: optional link to an open PO of the selected supplier. The
  // fetched list is tagged with its supplier so a stale list is never
  // offered after the supplier changes; changing supplier/source resets
  // the link in the change handlers below.
  const [purchaseOrderId, setPurchaseOrderId] = useState(initialPurchaseOrder?.id ?? "");
  const [openOrders, setOpenOrders] = useState<{ supplierId: string; orders: OpenPurchaseOrder[] }>({
    supplierId: "",
    orders: [],
  });
  // Nilai uang muka yang dipakai; field-nya mengurus saldo pemasok.
  const [advanceApplied, setAdvanceApplied] = useState("0");
  const [advanceResetKey, setAdvanceResetKey] = useState(0);
  const [updateCatalogSalePrices, setUpdateCatalogSalePrices] = useState(false);

  const isPurchase = sourceChoice === "purchase_credit" || sourceChoice === "purchase_cash";
  const isCashPurchase = sourceChoice === "purchase_cash";
  const activeHint = SOURCE_OPTIONS.find((option) => option.value === sourceChoice)?.hint;
  const activeSourceLabel = SOURCE_OPTIONS.find((option) => option.value === sourceChoice)?.label;
  const visibleOpenOrders = openOrders.supplierId === supplierId ? openOrders.orders : [];
  // A-24 T3 (pola G2): panduan diminta · terkonfirmasi · selisih saat
  // penerimaan tertaut PO — sisa PO adalah "diminta"-nya.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const isDirty = lines.length > 0 || notes.trim() !== "";
  function handleCancel() {
    if (isDirty) {
      setCancelConfirmOpen(true);
    } else {
      setOpen(false);
    }
  }
  const pickedOrder = visibleOpenOrders.find((order) => order.id === purchaseOrderId) ?? null;
  const expectedByProduct: Record<string, string> | undefined = pickedOrder
    ? Object.fromEntries(pickedOrder.lines.map((line) => [line.productId, line.remainingQty]))
    : undefined;
  const receiptDiffs = pickedOrder
    ? [
        ...pickedOrder.lines
          .map((orderLine) => {
            const line = lines.find((row) => row.productId === orderLine.productId);
            // S2: konfirmasi selalu dibandingkan dalam SATUAN DASAR.
            const confirmed = line ? docLineBaseQty(line) : d(0);
            return {
              name: orderLine.productName,
              expected: d(orderLine.remainingQty),
              confirmed,
            };
          })
          .filter((row) => !row.confirmed.eq(row.expected)),
        ...lines
          .filter(
            (line) => !pickedOrder.lines.some((orderLine) => orderLine.productId === line.productId),
          )
          .map((line) => ({ name: line.name, expected: d(0), confirmed: docLineBaseQty(line) })),
      ]
    : [];

  useEffect(() => {
    if (!isPurchase || !supplierId) return;
    let cancelled = false;
    listOpenPurchaseOrdersAction({ supplierId }).then((result) => {
      if (cancelled) return;
      const orders = result.ok ? (result.data as OpenPurchaseOrder[]) : [];
      setOpenOrders({ supplierId, orders });
      // GDG2-15: PO dari tautan "Terima barang" di detail PO diisi
      // otomatis SEKALI di sini (konteks async sesudah daftar terbuka
      // termuat — jalur data yang sama dengan memilih PO manual).
      if (initialPurchaseOrder && !autoPickedOrder.current) {
        const order = orders.find((row) => row.id === initialPurchaseOrder.id);
        if (order) {
          autoPickedOrder.current = true;
          setLines(linesFromOrder(order));
          toast.info(
            `Baris diisi dari sisa ${order.number}. Sesuaikan qty bila pengiriman sebagian.`,
          );
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // initialPurchaseOrder & linesFromOrder stabil untuk masa hidup
    // form (prop tautan awal + fungsi murni).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId, isPurchase]);

  function linesFromOrder(order: OpenPurchaseOrder): DocLine[] {
    // Start the lines from what the PO still owes; the cashier may trim
    // quantities for a partial delivery, and the server enforces the cap.
    // S2: baris PO berkemasan diisi awal dalam kemasan & harga per
    // kemasan yang sama dengan PO-nya (sisa dinyatakan ulang per
    // kemasan di server); petugas tetap bebas mengganti satuannya.
    return order.lines.map((line) => ({
      productId: line.productId,
      name: line.productName,
      sku: line.sku,
      qty: (line.packagingId && line.remainingInputQty
        ? d(line.remainingInputQty)
        : d(line.remainingQty)
      ).toString(),
      unitCost: (line.packagingId && line.packagingUnitCost
        ? d(line.packagingUnitCost)
        : d(line.unitCost)
      ).toString(),
      trackBatch: line.trackBatch,
      batchNumber: "",
      expiryDate: "",
      trackSerial: line.trackSerial,
      serialNumbersText: "",
      packagings: line.packagings,
      packagingId: line.packagingId ?? "",
      baseUnitCost: d(line.unitCost).toString(),
    }));
  }

  function pickPurchaseOrder(orderId: string) {
    setPurchaseOrderId(orderId);
    const order = visibleOpenOrders.find((row) => row.id === orderId);
    if (!order) return;
    setLines(linesFromOrder(order));
    toast.info(`Baris diisi dari sisa ${order.number}. Sesuaikan qty bila pengiriman sebagian.`);
  }

  // GDG2-15: penanda pengisian otomatis PO tautan awal (di effect
  // pemuat daftar PO terbuka di atas) — hanya sekali seumur form.
  const autoPickedOrder = useRef(false);

  function validateBasics() {
    if (!warehouseId) {
      toast.error("Pilih gudang tujuan.");
      return false;
    }
    if (isPurchase && !supplierId) {
      toast.error("Pilih pemasok untuk penerimaan pembelian.");
      return false;
    }
    if (isCashPurchase && !paymentAccountId) {
      toast.error("Pilih akun Kas/Bank untuk pembelian tunai.");
      return false;
    }
    if (sourceChoice === "other" && !requireFilled(notes, "Alasan wajib ditulis di catatan untuk sumber Lainnya.")) {
      return false;
    }
    if (lines.length === 0) {
      toast.error("Tambahkan minimal satu produk.");
      return false;
    }
    const missingBatch = lines.find((line) => line.trackBatch && !line.batchNumber?.trim());
    if (missingBatch) {
      toast.error(`Nomor batch wajib diisi untuk ${missingBatch.name} karena produk ini dilacak per batch.`);
      return false;
    }
    const parseSerials = (text?: string) =>
      (text ?? "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
    const badSerial = lines.find(
      (line) =>
        line.trackSerial &&
        parseSerials(line.serialNumbersText).length !== docLineBaseQty(line).toNumber(),
    );
    if (badSerial) {
      toast.error(
        `Jumlah nomor seri untuk ${badSerial.name} harus persis qty satuan dasar (${formatQty(docLineBaseQty(badSerial))}).`,
      );
      return false;
    }
    return true;
  }

  /**
   * Gerbang G2: penerimaan tertaut PO yang berselisih dari sisa PO
   * melewati ringkasan selisih dulu; semua pas (atau tanpa PO) →
   * posting langsung seperti sebelumnya.
   */
  function submit() {
    if (!validateBasics()) return;
    if (pickedOrder && receiptDiffs.length > 0) {
      setConfirmOpen(true);
      return;
    }
    void doSubmit();
  }

  async function doSubmit() {
    const parseSerials = (text?: string) =>
      (text ?? "")
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter(Boolean);
    setBusy(true);
    const result = await receiveStockAction({
      warehouseId,
      idempotencyKey,
      source: isPurchase ? "purchase" : sourceChoice,
      supplierId: supplierId || undefined,
      purchaseOrderId: isPurchase && purchaseOrderId ? purchaseOrderId : undefined,
      paymentAccountId: isCashPurchase ? paymentAccountId : undefined,
      supplierInvoiceNumber:
        isPurchase && supplierInvoiceNumber.trim() ? supplierInvoiceNumber.trim() : undefined,
      // PPN dalam persen; 0 berarti non-PPN. Kolom yang dikosongkan
      // dikirim sebagai "0" agar schema angka tidak menolak string kosong.
      taxPercent:
        isPurchase && taxInputMapped
          ? taxPercent.trim() === ""
            ? "0"
            : taxPercent
          : undefined,
      advanceAmount:
        isPurchase && d(advanceApplied).gt(0) ? advanceApplied : undefined,
      updateCatalogSalePrices: isPurchase && canPrice ? updateCatalogSalePrices : false,
      date,
      notes: notes || undefined,
      lines: lines.map((line) => ({
        productId: line.productId,
        qty: line.qty,
        unitCost: line.unitCost,
        discountType:
          isPurchase && line.discountValue ? (line.discountType ?? "percent") : undefined,
        discountValue: isPurchase && line.discountValue ? line.discountValue : undefined,
        salePrice: isPurchase && canPrice && line.salePrice ? line.salePrice : undefined,
        // S2: baris berkemasan — qty & harga per kemasan apa adanya.
        packagingId: line.packagingId || undefined,
        batchNumber: line.trackBatch ? line.batchNumber?.trim() || undefined : undefined,
        expiryDate: line.trackBatch && line.expiryDate ? line.expiryDate : undefined,
        serialNumbers: line.trackSerial ? parseSerials(line.serialNumbersText) : undefined,
      })),
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Penerimaan barang tersimpan dan stok diperbarui.");
    setIdempotencyKey(newUuid());
    setLines([]);
    setNotes("");
    setSupplierInvoiceNumber("");
    setPurchaseOrderId("");
    setTaxPercent(d(taxRate || "0").gt(0) ? String(d(taxRate || "0").toNumber()) : "0");
    setAdvanceApplied("0");
    setAdvanceResetKey((value) => value + 1);
    setOpen(false);
    router.refresh();
  }

  // A-25 U3: form penerimaan memakai DocumentForm bersama — kepala
  // inti (sumber, gudang, tanggal, pemasok, tautan PO) di kartu
  // kepala; nomor invoice pemasok & opsi PPN terlipat di Opsi
  // lanjutan; total hidup di rel ringkasan. Kontrak e2e dijaga:
  // label "Sumber penerimaan", tombol "Posting penerimaan", dan teks
  // toast sukses tidak berubah.
  const total = lines.reduce((acc, line) => acc.plus(docLineReceiptNet(line)), d(0));
  const taxValue = d(taxPercent || "0").gt(0)
    ? total.mul(d(taxPercent || "0")).div(100).toDecimalPlaces(2)
    : d(0);
  const grandTotal = total.plus(taxValue);
  // Total qty ringkasan selalu SATUAN DASAR; total nilai memakai
  // qty × harga sebagaimana dimasukkan (jumlah faktur yang sama).
  const totalQty = lines.reduce((acc, line) => acc.plus(docLineBaseQty(line)), d(0));
  const warehouseName = warehouses.find((row) => row.id === warehouseId)?.name;

  return (
    <div>
      {/* A-28 UI-5 (UX-A02): pita formulir tidak lagi menggandakan
          judul halaman — pola SectionTitle bare A-25 (POLA-02): yang
          tersisa hanya baris aksinya (tombol buka/tutup form, kontrak
          e2e "Penerimaan baru"). Penjelasan sumber penerimaan hidup
          di deskripsi PageHeader halaman. */}
      {open ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5">
          <p className="min-w-0 text-[10px] text-muted-foreground">
            Catat barang masuk; stok dan jurnal dibuat saat diposting.
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="size-3.5" /> Penerimaan baru
          </button>
        </div>
      )}

      {open ? (
        <>
          <DocumentForm
            className="mt-3"
            header={
              <div>
                <div className="flex items-start justify-between gap-2 border-b border-border px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold">Penerimaan baru</p>
                    <p className="text-[10px] text-muted-foreground">
                      Lengkapi dokumen, lalu posting untuk menambah stok dan jurnal.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Tutup formulir"
                    className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <div className="space-y-3 p-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1">
                    <span className={labelClass}>Sumber penerimaan</span>
                    <select
                      value={sourceChoice}
                      onChange={(event) => {
                        const next = event.target.value as SourceChoice;
                        const nextIsPurchase =
                          next === "purchase_credit" || next === "purchase_cash";
                        setSourceChoice(next);
                        setPurchaseOrderId("");
                        setAdvanceApplied("0");
                        // Diskon hanya berlaku untuk pembelian; jangan
                        // biarkan nilai tersembunyi ikut terhitung saat
                        // sumber berganti ke stok awal/bonus/retur.
                        if (!nextIsPurchase) {
                          setLines((current) =>
                            current.map((line) =>
                              line.discountValue
                                ? { ...line, discountValue: "" }
                                : line,
                            ),
                          );
                        }
                      }}
                      className={fieldClass}
                    >
                      <optgroup label="Pembelian">
                        {SOURCE_OPTIONS.filter((option) => option.value.startsWith("purchase")).map(
                          (option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ),
                        )}
                      </optgroup>
                      <optgroup label="Penerimaan lain">
                        {SOURCE_OPTIONS.filter((option) => !option.value.startsWith("purchase")).map(
                          (option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ),
                        )}
                      </optgroup>
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Gudang tujuan</span>
                    <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={fieldClass}>
                      {warehouses.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className={labelClass}>Tanggal</span>
                    <DateField value={date} onChange={setDate} className={fieldClass} />
                  </label>
                </div>

                {activeHint ? (
                  <p className="text-[10px] leading-4 text-muted-foreground">{activeHint}</p>
                ) : null}
                {isPurchase ? (
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Retur barang ke pemasok?{" "}
                    <Link
                      href="/app/gudang/retur-pembelian"
                      className="font-medium text-primary hover:underline"
                    >
                      Buat retur pembelian
                    </Link>
                  </p>
                ) : null}

                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="space-y-1">
                    <span className={labelClass}>
                      Pemasok {isPurchase ? "" : "(opsional)"}
                    </span>
                    <select
                      value={supplierId}
                      onChange={(event) => {
                        setSupplierId(event.target.value);
                        setPurchaseOrderId("");
                        setAdvanceApplied("0");
                      }}
                      className={fieldClass}
                    >
                      {!isPurchase ? <option value="">— Tanpa pemasok —</option> : null}
                      {suppliers.map((row) => (
                        <option key={row.id} value={row.id}>{row.name}</option>
                      ))}
                    </select>
                  </label>

                  {isPurchase ? (
                    <label className="space-y-1">
                      <span className={labelClass}>No. invoice (opsional)</span>
                      <input
                        value={supplierInvoiceNumber}
                        onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
                        className={fieldClass}
                        placeholder="INV/2026/XI/001"
                      />
                    </label>
                  ) : null}

                  {isPurchase ? (
                    <label className="space-y-1">
                      <span className={labelClass}>PPN (%)</span>
                      <div className="max-w-36">
                        <PercentInput
                          value={taxPercent}
                          onChange={setTaxPercent}
                          disabled={!taxInputMapped}
                          aria-label="PPN (%)"
                        />
                      </div>
                      <span className="block text-[10px] text-muted-foreground">
                        {!taxInputMapped
                          ? "Akun PPN Masukan belum dipetakan"
                          : d(taxPercent || "0").gt(0)
                            ? `PPN ${taxPercent}% = ${formatIDR(taxValue)}`
                            : "Isi 0 bila tanpa PPN"}
                      </span>
                    </label>
                  ) : null}

                  {isPurchase && canPrice ? (
                    <div className="flex items-center pt-5">
                      <label className="inline-flex cursor-pointer items-center gap-2">
                        <input type="checkbox" checked={updateCatalogSalePrices} onChange={(e) => setUpdateCatalogSalePrices(e.target.checked)} className="size-3.5 rounded border-input" />
                        <span className="text-[11px] text-muted-foreground">Perbarui harga jual master produk</span>
                      </label>
                    </div>
                  ) : null}
                </div>

                {isCashPurchase ? (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="space-y-1">
                      <span className={labelClass}>Dibayar dari akun</span>
                      <select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)} className={fieldClass}>
                        {paymentAccounts.map((row) => (
                          <option key={row.id} value={row.id}>{row.code} — {row.name}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                <ReceiptAdvanceField
                  key={`${supplierId}:${sourceChoice}:${advanceResetKey}`}
                  supplierId={supplierId}
                  isPurchase={isPurchase}
                  grandTotal={grandTotal.toString()}
                  onAppliedChange={setAdvanceApplied}
                />

                {isPurchase && supplierId ? (
                  <DocumentFormAdvanced>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="space-y-1">
                        <span className={labelClass}>Tautkan pesanan pembelian (opsional)</span>
                        <select
                          value={purchaseOrderId}
                          onChange={(event) => pickPurchaseOrder(event.target.value)}
                          className={fieldClass}
                        >
                          <option value="">— Tanpa tautan PO —</option>
                          {visibleOpenOrders.map((order) => (
                            <option key={order.id} value={order.id}>
                              {order.number} · {order.lines.length} produk belum diterima penuh
                            </option>
                          ))}
                        </select>
                      </label>
                      {purchaseOrderId ? (
                        <p className="self-end pb-1 text-[10px] leading-4 text-muted-foreground">
                          Baris terisi dari sisa PO; qty melebihi sisa akan ditolak server.
                        </p>
                      ) : null}
                    </div>
                  </DocumentFormAdvanced>
                ) : null}
                </div>
              </div>
            }
            summary={
              <div className="rounded-lg border border-border bg-card px-4 py-3">
                <p className="text-[11px] font-semibold text-muted-foreground">Ringkasan penerimaan</p>
                <p className="num mt-1 text-[16px] font-semibold">
                  {formatIDR(grandTotal)}
                </p>
                <dl className="mt-2 space-y-1 text-[11px]">
                  {taxValue.gt(0) ? (
                    <StatRow label={`PPN (${taxPercent}%)`} value={formatIDR(taxValue)} valueClass="num text-right font-medium" />
                  ) : null}
                  {d(advanceApplied).gt(0) ? (
                    <>
                      <StatRow label="Uang muka" value={formatIDR(advanceApplied)} valueClass="num text-right font-medium" />
                      <StatRow label="Sisa tagihan" value={formatIDR(grandTotal.minus(d(advanceApplied)))} valueClass="num text-right font-medium" />
                    </>
                  ) : null}
                  <StatRow label="Sumber" value={activeSourceLabel ?? "—"} valueClass="min-w-0 text-right font-medium" />
                  <StatRow label="Gudang" value={warehouseName ?? "—"} valueClass="min-w-0 text-right font-medium" />
                  <StatRow label="Baris produk" value={formatQty(lines.length)} valueClass="num font-medium" />
                  <StatRow label="Total qty" value={formatQty(totalQty)} valueClass="num font-medium" />
                  {pickedOrder ? <StatRow label="PO tertaut" value={pickedOrder.number} valueClass="num font-medium" /> : null}
                  {pickedOrder ? (
                    <StatRow
                      label="Selisih vs sisa PO"
                      value={receiptDiffs.length > 0 ? `${formatQty(receiptDiffs.length)} baris berselisih` : "Pas"}
                      valueClass={`font-medium ${receiptDiffs.length > 0 ? "text-tone-amber" : "text-tone-green"}`}
                    />
                  ) : null}
                </dl>
              </div>
            }
            guide={
              <ul className="list-disc space-y-0.5 pl-4">
                <li>Akun lawan mengikuti sumber: pembelian kredit menjadi utang pemasok, tunai dibayar dari Kas/Bank, stok awal dari Modal.</li>
                <li>Produk terlacak batch wajib nomor batch; produk berseri wajib nomor seri sejumlah qty.</li>
                <li>Penerimaan tertaut PO tidak boleh melebihi sisa pesanan — kelebihan ditolak server.</li>
                <li>Selisih dari sisa PO diringkas untuk konfirmasi sebelum posting.</li>
              </ul>
            }
            actions={
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">
                  Total{" "}
                  <span className="num font-semibold text-foreground">
                    {formatIDR(grandTotal)}
                  </span>
                  <span className="ml-2">{lines.length} baris</span>
                </p>
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="inline-flex h-8 items-center rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="h-8 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy ? "Menyimpan…" : "Posting penerimaan"}
                </button>
                </div>
              </div>
            }
          >
            <div className="space-y-3 p-4">
              <LineEditor
                lines={lines}
                onChange={setLines}
                mode="receipt"
                warehouseId={warehouseId}
                expectedByProduct={expectedByProduct}
                allowSalePrice={isPurchase && canPrice}
                showDiscount={isPurchase}
              />

              <label className="block space-y-1">
                <span className={labelClass}>
                  {sourceChoice === "other" ? "Alasan (wajib)" : "Catatan"}
                </span>
                <input
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className={fieldClass}
                  placeholder={
                    sourceChoice === "other"
                      ? "Alasan penerimaan ini…"
                      : "Keterangan pengiriman, kondisi barang…"
                  }
                />
              </label>
            </div>
          </DocumentForm>

          {/* A-24 T3 (G2): ringkasan selisih terhadap sisa PO. */}
          <ConfirmDialog
            open={confirmOpen}
            title={pickedOrder ? `Ringkasan selisih — ${pickedOrder.number}` : "Ringkasan selisih"}
            confirmLabel="Ya, posting penerimaan"
            busy={busy}
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => {
              setConfirmOpen(false);
              void doSubmit();
            }}
            description={
              <div className="space-y-2">
                <p>Isi penerimaan berbeda dari sisa pesanan:</p>
                <ul className="list-disc space-y-1 pl-4">
                  {receiptDiffs.map((row) => {
                    const diff = row.confirmed.minus(row.expected);
                    return (
                      <li key={row.name}>
                        <span className="font-medium text-foreground">{row.name}</span> — diminta {formatQty(row.expected)}, diterima {formatQty(row.confirmed)}, {diff.eq(0) ? "pas" : diff.lt(0) ? `kurang ${formatQty(diff.negated())}` : row.expected.eq(0) ? "baris di luar PO" : `lebih ${formatQty(diff)}`}
                      </li>
                    );
                  })}
                </ul>
                <p>
                  Kekurangan berarti penerimaan SEBAGIAN: PO tetap terbuka untuk sisa yang belum tiba. Kelebihan di atas sisa PO ditolak server. Baris di luar PO diterima sebagai penerimaan tanpa tautan pesanan.
                </p>
              </div>
            }
          />

          <ConfirmDialog
            open={cancelConfirmOpen}
            title="Batalkan penerimaan?"
            confirmLabel="Ya, buang draf"
            cancelLabel="Lanjutkan mengisi"
            danger
            onCancel={() => setCancelConfirmOpen(false)}
            onConfirm={() => {
              setCancelConfirmOpen(false);
              setOpen(false);
            }}
            description="Perubahan dan baris barang yang sudah Anda masukkan belum disimpan dan akan hilang."
          />
        </>
      ) : null}
    </div>
  );
}
