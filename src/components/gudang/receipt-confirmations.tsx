import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { formatIDR } from "@/lib/money";

export type ReceiptDifference = {
  name: string;
  requested: string;
  received: string;
  status: string;
};

export type ReceiptPriceDifference = {
  name: string;
  expectedUnitCost: string;
  receivedUnitCost: string;
  differenceUnitCost: string;
  differenceAmount: string;
};

export function ReceiptConfirmations({
  confirmOpen,
  cancelOpen,
  busy,
  orderNumber,
  differences,
  priceDifferences,
  onConfirmDifference,
  onCancelDifference,
  onDiscard,
  onContinue,
}: {
  confirmOpen: boolean;
  cancelOpen: boolean;
  busy: boolean;
  orderNumber?: string;
  differences: ReceiptDifference[];
  priceDifferences: ReceiptPriceDifference[];
  onConfirmDifference: (reason: string) => void;
  onCancelDifference: () => void;
  onDiscard: () => void;
  onContinue: () => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={confirmOpen}
        title={orderNumber ? `Ringkasan selisih — ${orderNumber}` : "Ringkasan selisih"}
        confirmLabel="Ya, posting penerimaan"
        busy={busy}
        onCancel={onCancelDifference}
        onConfirm={onConfirmDifference}
        description={
          <div className="space-y-2">
            <p>Periksa selisih terhadap sisa pesanan sebelum posting.</p>
            {differences.length > 0 ? (
              <div>
                <p className="mb-1 font-medium text-foreground">Jumlah</p>
                <ul className="list-disc space-y-1 pl-4">
                  {differences.map((row) => (
                    <li key={row.name}>
                      <span className="font-medium text-foreground">{row.name}</span> — PO {row.requested}, diterima {row.received}, {row.status}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {priceDifferences.length > 0 ? (
              <div>
                <p className="mb-1 font-medium text-foreground">Harga per satuan dasar</p>
                <ul className="list-disc space-y-1 pl-4">
                  {priceDifferences.map((row) => (
                    <li key={row.name}>
                      <span className="font-medium text-foreground">{row.name}</span> — PO {formatIDR(row.expectedUnitCost)}, diterima {formatIDR(row.receivedUnitCost)}, selisih {formatIDR(row.differenceUnitCost)}/unit ({formatIDR(row.differenceAmount)} untuk qty diterima).
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Harga diterima dihitung setelah diskon baris dan tidak memasukkan PPN Masukan yang dapat dikreditkan.</p>
              </div>
            ) : null}
            {differences.length > 0 ? (
              <p>Kekurangan berarti penerimaan sebagian; PO tetap terbuka untuk sisa yang belum tiba.</p>
            ) : null}
          </div>
        }
        reason={priceDifferences.length > 0 ? {
          label: "Alasan selisih harga (wajib)",
          placeholder: "Contoh: pemasok mengubah harga pada faktur 12345",
          minLength: 5,
        } : undefined}
      />

      <ConfirmDialog
        open={cancelOpen}
        title="Batalkan penerimaan?"
        confirmLabel="Ya, buang draf"
        cancelLabel="Lanjutkan mengisi"
        danger
        onCancel={onContinue}
        onConfirm={onDiscard}
        description="Perubahan dan baris barang yang sudah Anda masukkan belum disimpan dan akan hilang."
      />
    </>
  );
}
