import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

export type ReceiptDifference = {
  name: string;
  requested: string;
  received: string;
  status: string;
};

export function ReceiptConfirmations({
  confirmOpen,
  cancelOpen,
  busy,
  orderNumber,
  differences,
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
  onConfirmDifference: () => void;
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
            <p>Isi penerimaan berbeda dari sisa pesanan:</p>
            <ul className="list-disc space-y-1 pl-4">
              {differences.map((row) => (
                <li key={row.name}>
                  <span className="font-medium text-foreground">{row.name}</span> — diminta {row.requested}, diterima {row.received}, {row.status}
                </li>
              ))}
            </ul>
            <p>
              Kekurangan berarti penerimaan SEBAGIAN: PO tetap terbuka untuk sisa yang belum tiba. Kelebihan di atas sisa PO ditolak server. Baris di luar PO diterima sebagai penerimaan tanpa tautan pesanan.
            </p>
          </div>
        }
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
