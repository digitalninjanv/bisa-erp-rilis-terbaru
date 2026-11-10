"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookmarkPlus, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/format";
import {
  createReservationAction,
  receiveTransferAction,
  releaseReservationAction,
} from "@/server/actions/reservations";
import { labelClass, fieldClass } from "@/components/blocks/field-classes";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";
import { DateField } from "@/components/date-field";
import { QtyInput } from "@/components/qty-input";

export type ReservationProductOption = { id: string; sku: string; name: string };
export type ReservationWarehouseOption = { id: string; name: string };

export function ReservationForm({
  products,
  warehouses,
}: {
  products: ReservationProductOption[];
  warehouses: ReservationWarehouseOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? "");
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const [expiresDate, setExpiresDate] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!warehouseId || !productId) return toast.error("Pilih gudang dan produk.");
    if (!qty || Number(qty) <= 0) return toast.error("Qty reservasi harus lebih dari nol.");
    setBusy(true);
    const result = await createReservationAction({
      warehouseId,
      productId,
      qty,
      date: todayISO(),
      expiresAt: expiresDate ? new Date(`${expiresDate}T23:59:59`).toISOString() : null,
      reason: reason.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Reservasi ${result.data.number} dibuat — stok tersedia berkurang sebesar qty reservasi.`);
    setOpen(false);
    setReason("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={products.length === 0 || warehouses.length === 0}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <BookmarkPlus className="size-3.5" /> Reservasi Baru
      </button>
      {open ? (
        <Modal
          title="Reservasi stok baru"
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Buat reservasi"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">Reservasi mengurangi stok TERSEDIA untuk penjualan (POS &amp; checkout) tanpa mengubah stok fisik/ledger, sampai dirilis atau kedaluwarsa.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Gudang</span>
                <select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)} className={fieldClass}>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>
                      {warehouse.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Qty</span>
                {/* G2 (FRM-03): QtyInput bersama menggantikan type="number" mentah. */}
                <QtyInput value={qty} onChange={setQty} min="0" aria-label="Qty reservasi" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="space-y-1 sm:col-span-2">
                <span className={labelClass}>Produk</span>
                <select value={productId} onChange={(event) => setProductId(event.target.value)} className={fieldClass}>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.sku} · {product.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Berlaku sampai (opsional)</span>
                {/* A-25 U3: tanggal form memakai DateField bersama
                    (tampilan dd/mm/yyyy; nilai state tetap ISO). */}
                <DateField value={expiresDate} onChange={setExpiresDate} aria-label="Berlaku sampai" />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Alasan</span>
                <input value={reason} onChange={(event) => setReason(event.target.value)} className={fieldClass} placeholder="Pesanan pelanggan X" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

/**
 * A-25 U3: aksi baris reservasi kini SATU menu ⋯ (RowMenu bersama,
 * pola product-row-actions) — sebelumnya dua tombol permanen
 * "Rilis" + "Batalkan" di setiap baris (POLA-07). "Batalkan" adalah
 * aksi destruktif (danger, terpisah di bawah garis menu). Logika
 * aksi tidak berubah: tanpa dialog konfirmasi tambahan, sama seperti
 * tombol lamanya; server tetap penegak status aktif.
 */
export function ReservationReleaseButtons({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function act(cancelled: boolean) {
    setBusy(true);
    const result = await releaseReservationAction({ reservationId: id, cancelled });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(cancelled ? `Reservasi ${number} dibatalkan.` : `Reservasi ${number} dirilis — stok tersedia kembali.`);
    router.refresh();
  }

  return (
    <div className="flex justify-end">
      <RowMenu
        label={`Aksi untuk reservasi ${number}`}
        items={[
          { key: "release", label: "Rilis", disabled: busy },
          { key: "cancel", label: "Batalkan", danger: true, disabled: busy },
        ]}
        onAction={(key) => {
          if (key === "release") void act(false);
          if (key === "cancel") void act(true);
        }}
      />
    </div>
  );
}

export function ReceiveTransferButton({ documentId, number }: { documentId: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function receive() {
    setBusy(true);
    const result = await receiveTransferAction({ documentId, date: todayISO() });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Transfer ${number} diterima — stok tujuan bertambah.`);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={receive}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1 rounded bg-primary px-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    >
      <PackageCheck className="size-3.5" /> {busy ? "Menerima…" : "Terima di Tujuan"}
    </button>
  );
}

