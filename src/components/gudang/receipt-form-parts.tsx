import type { PickedPackaging } from "@/components/gudang/product-picker";

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

