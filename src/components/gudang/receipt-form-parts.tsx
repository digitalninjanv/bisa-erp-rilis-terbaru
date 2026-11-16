import type { PickedPackaging } from "@/components/gudang/product-picker";
import { DateField } from "@/components/date-field";
import { PercentInput } from "@/components/percent-input";
import { ReceiptAdvanceField } from "@/components/gudang/receipt-advance-field";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { formatIDR, d } from "@/lib/money";

export type OpenPurchaseOrder = {
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
export type SourceChoice =
  | "purchase_credit"
  | "purchase_cash"
  | "opening"
  | "bonus"
  | "customer_return"
  | "other";

export const SOURCE_OPTIONS: { value: SourceChoice; label: string; hint: string }[] = [
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

export function StatRow({
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

export function linesFromOrder(order: OpenPurchaseOrder) {
  return order.lines.map((line) => ({
    productId: line.productId,
    name: line.productName,
    sku: line.sku,
    qty: (line.packagingId && line.remainingInputQty
      ? line.remainingInputQty
      : line.remainingQty
    ).toString(),
    unitCost: (line.packagingId && line.packagingUnitCost
      ? line.packagingUnitCost
      : line.unitCost
    ).toString(),
    trackBatch: line.trackBatch,
    batchNumber: "",
    expiryDate: "",
    trackSerial: line.trackSerial,
    serialNumbersText: "",
    packagings: line.packagings,
    packagingId: line.packagingId ?? "",
    baseUnitCost: line.unitCost.toString(),
  }));
}

export function ReceiptAdvancedFields({
  supplierInvoiceNumber,
  setSupplierInvoiceNumber,
  supplierInvoiceDate,
  setSupplierInvoiceDate,
  dueDate,
  setDueDate,
  isCashPurchase,
  taxPercent,
  setTaxPercent,
  taxInputMapped,
  taxValue,
  canPrice,
  updateCatalogSalePrices,
  setUpdateCatalogSalePrices,
  supplierId,
  sourceChoice,
  advanceResetKey,
  isPurchase,
  grandTotal,
  setAdvanceApplied,
  setHasAdvanceAvailable,
}: {
  supplierInvoiceNumber: string;
  setSupplierInvoiceNumber: (val: string) => void;
  supplierInvoiceDate: string;
  setSupplierInvoiceDate: (val: string) => void;
  dueDate: string;
  setDueDate: (val: string) => void;
  isCashPurchase: boolean;
  taxPercent: string;
  setTaxPercent: (val: string) => void;
  taxInputMapped: boolean;
  taxValue: ReturnType<typeof d>;
  canPrice: boolean;
  updateCatalogSalePrices: boolean;
  setUpdateCatalogSalePrices: (val: boolean) => void;
  supplierId: string;
  sourceChoice: SourceChoice;
  advanceResetKey: number;
  isPurchase: boolean;
  grandTotal: string;
  setAdvanceApplied: (val: string) => void;
  setHasAdvanceAvailable: (val: boolean) => void;
}) {
  return (
    <div className="space-y-3 pt-1">
      <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
        <label className="space-y-1">
          <span className={labelClass}>No. faktur pemasok (opsional)</span>
          <input
            value={supplierInvoiceNumber}
            onChange={(event) => setSupplierInvoiceNumber(event.target.value)}
            className={fieldClass}
            placeholder="INV/2026/001"
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Nomor faktur/surat jalan dari fisik tagihan pemasok.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Tanggal faktur pemasok</span>
          <DateField
            value={supplierInvoiceDate}
            onChange={setSupplierInvoiceDate}
            aria-label="Tanggal faktur pemasok"
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Tanggal yang tertera pada faktur fisik.
          </span>
        </label>
        {!isCashPurchase ? (
          <label className="space-y-1">
            <span className={labelClass}>Jatuh tempo (opsional)</span>
            <DateField
              value={dueDate}
              onChange={setDueDate}
              aria-label="Jatuh tempo faktur"
            />
            <span className="block text-[10px] leading-4 text-muted-foreground">
              Kosong = tanggal penerimaan + termin pemasok.
            </span>
          </label>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-4 pt-1">
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

        {canPrice ? (
          <div className="flex items-center pt-2">
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={updateCatalogSalePrices}
                onChange={(e) => setUpdateCatalogSalePrices(e.target.checked)}
                className="size-3.5 rounded border-input"
              />
              <span className="text-[11px] text-muted-foreground">
                Perbarui harga jual master produk
              </span>
            </label>
          </div>
        ) : null}
      </div>

      <ReceiptAdvanceField
        key={`${supplierId}:${sourceChoice}:${advanceResetKey}`}
        supplierId={supplierId}
        isPurchase={isPurchase}
        grandTotal={grandTotal}
        onAppliedChange={setAdvanceApplied}
        onAvailableChange={setHasAdvanceAvailable}
      />
    </div>
  );
}

