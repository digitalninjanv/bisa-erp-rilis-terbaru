"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  cancelPurchaseOrderAction,
  sendPurchaseOrderAction,
} from "@/server/actions/purchasing";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";

/**
 * Aksi status PO di detail: Kirim PO (draft → sent) & Batalkan PO.
 *
 * A-28 UI-4 (UX-C01): PO Draf juga mendapat "Kirim & terima" —
 * jalan terima langsung dari Draf yang tetap jujur terhadap aturan
 * domain: penerimaan hanya sah pada PO Terkirim, jadi aksi ini
 * menjalankan transisi Kirim yang sama (aksi server yang sama,
 * audit `purchase_order.send` yang sama) sesudah konfirmasi
 * eksplisit yang menyatakan PO akan terkirim, lalu membuka
 * formulir penerimaan yang terisi dari sisa PO — tautan yang sama
 * dengan tombol "Terima barang" pada PO Terkirim. Tidak ada
 * penerimaan yang menembus status secara diam-diam.
 */
export function PurchaseOrderActions({
  id,
  number,
  status,
}: {
  id: string;
  number: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [confirmingSendReceive, setConfirmingSendReceive] = useState(false);

  async function send() {
    setBusy(true);
    const result = await sendPurchaseOrderAction({ id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pesanan pembelian ${number} terkirim. Penerimaan barang kini dapat menautkan PO ini.`);
    router.refresh();
  }

  async function sendAndReceive() {
    setBusy(true);
    const result = await sendPurchaseOrderAction({ id });
    setBusy(false);
    setConfirmingSendReceive(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pesanan pembelian ${number} terkirim. Lanjutkan penerimaan barangnya.`);
    router.push(`/app/gudang/penerimaan?po=${id}`);
  }

  async function cancel() {
    setBusy(true);
    const result = await cancelPurchaseOrderAction({ id });
    setBusy(false);
    setConfirmingCancel(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Pesanan pembelian ${number} dibatalkan.`);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {status === "draft" ? (
        <>
          <button
            type="button"
            onClick={() => setConfirmingSendReceive(true)}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Kirim &amp; terima
          </button>
          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
          >
            Kirim PO
          </button>
        </>
      ) : null}
      {status === "draft" || status === "sent" ? (
        <button
          type="button"
          onClick={() => setConfirmingCancel(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-[12px] font-medium text-destructive hover:bg-muted disabled:opacity-50"
        >
          Batalkan PO
        </button>
      ) : null}
      <ConfirmDialog
        open={confirmingSendReceive}
        title={`Kirim & terima PO ${number}?`}
        description="PO ini akan dikirim ke pemasok terlebih dahulu — status berubah dari Draf menjadi Terkirim dan pengiriman tercatat seperti Kirim PO biasa — lalu formulir penerimaan terbuka terisi dari sisa pesanan untuk Anda periksa dan posting."
        confirmLabel="Kirim & buka penerimaan"
        busy={busy}
        onConfirm={() => void sendAndReceive()}
        onCancel={() => setConfirmingSendReceive(false)}
      />
      <ConfirmDialog
        open={confirmingCancel}
        title={`Batalkan pesanan pembelian ${number}?`}
        description="PO yang sudah memiliki penerimaan tidak dapat dibatalkan — server akan menolaknya. PO yang dibatalkan tidak lagi dapat ditautkan ke penerimaan baru."
        confirmLabel="Batalkan PO"
        danger
        busy={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
