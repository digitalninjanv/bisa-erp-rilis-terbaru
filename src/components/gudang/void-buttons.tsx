"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import {
  voidReceiptAction,
  voidStockDocumentAction,
} from "@/server/actions/inventory/penerimaan";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu, type RowMenuItem } from "@/components/blocks/row-menu";

/**
 * Void buttons for posted warehouse documents (GD-P1-5). FIX-GDG
 * Tahap 4 (GDG2-09): alasan tidak lagi dikumpulkan lewat window.prompt
 * bawaan peramban, melainkan dialog bersama yang menampilkan dampak
 * pembatalan sebelum petugas menekan tombolnya. Server menegakkan
 * aturan sebenarnya (status, penjaga stok, jurnal pembalik); tombol ini
 * hanya mengumpulkan alasan wajibnya.
 */
export function ReceiptVoidButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidReceiptAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Penerimaan dibatalkan, stok dikeluarkan kembali, dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        Batalkan
      </button>
      <ConfirmDialog
        open={open}
        title={`Batalkan penerimaan ${number}?`}
        description="Stok yang masuk lewat penerimaan ini akan dikeluarkan kembali dan jurnal pembalik dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan penerimaan"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/**
 * A-28 UI-5 (UX-A05): aksi baris daftar Penerimaan mengikuti pola
 * A-25 — aksi utama terlihat berlabel (Cetak GRN), pembatalan masuk
 * menu ⋯ sebagai aksi destruktif terpisah di dasar (sebelumnya
 * tautan teks + tombol "Batalkan" terbuka sejajar). Dialog &
 * aturan domainnya persis ReceiptVoidButton (yang tetap dipakai
 * halaman detail): alasan wajib, server menegakkan sisanya.
 * Menu hanya dirender bila pembatalan memang tersedia, agar tidak
 * ada tombol menu kosong pada baris yang sudah void.
 */
export function ReceiptRowActions({
  id,
  number,
  canVoid,
  extraItems,
}: {
  id: string;
  number: string;
  canVoid: boolean;
  extraItems?: RowMenuItem[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidReceiptAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Penerimaan dibatalkan, stok dikeluarkan kembali, dan jurnal pembalik dibuat.");
    router.refresh();
  }

  const menuItems: RowMenuItem[] = [
    ...(extraItems ?? []),
    ...(canVoid ? [{ key: "void", label: "Batalkan penerimaan", danger: true, disabled: busy }] : []),
  ];

  return (
    <div className="flex items-center justify-end gap-1.5">
      <Link
        href={`/app/gudang/penerimaan/${id}/cetak`}
        className="inline-flex h-8 items-center gap-1.5 rounded border border-border bg-card px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Printer className="size-3.5" />
        Cetak GRN
      </Link>
      {menuItems.length > 0 ? (
        <>
          <RowMenu
            label={`Aksi lain untuk penerimaan ${number}`}
            items={menuItems}
            onAction={(key) => {
              if (key === "void") setOpen(true);
            }}
          />
          {canVoid ? (
            <ConfirmDialog
              open={open}
              title={`Batalkan penerimaan ${number}?`}
              description="Stok yang masuk lewat penerimaan ini akan dikeluarkan kembali dan jurnal pembalik dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
              confirmLabel="Batalkan penerimaan"
              danger
              busy={busy}
              reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
              onConfirm={(reason) => void remove(reason)}
              onCancel={() => setOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function StockDocumentVoidButton({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidStockDocumentAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Dokumen dibatalkan, stok dikembalikan, dan jurnal pembalik dibuat bila ada.");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={busy}
        className="inline-flex h-8 items-center rounded border border-border px-2 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
      >
        Batalkan
      </button>
      <ConfirmDialog
        open={open}
        title={`Batalkan dokumen ${number}?`}
        description="Stok dikembalikan ke keadaan sebelum dokumen ini dan jurnal pembalik dibuat bila dokumen ini pernah menjurnal. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan dokumen"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

/**
 * G3 (UX4-01): pasangan daftar dari StockDocumentVoidButton, meniru
 * ReceiptRowActions — di DAFTAR opname/penyesuaian/transfer,
 * pembatalan dokumen terposting masuk menu ⋯ sebagai satu-satunya
 * item destruktif; tombol "Batalkan" terbuka tidak lagi permanen di
 * setiap baris. Dialog, alasan wajib, dan aturan domainnya persis
 * tombol versi halaman detail (dokumen/[id] tetap memakai
 * StockDocumentVoidButton). Pemanggil hanya merender komponen ini
 * pada baris yang memang boleh dibatalkan (status posted/in_transit
 * + izin), jadi tidak ada menu kosong.
 */
export function StockDocumentRowActions({ id, number }: { id: string; number: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidStockDocumentAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Dokumen dibatalkan, stok dikembalikan, dan jurnal pembalik dibuat bila ada.");
    router.refresh();
  }

  return (
    <>
      <RowMenu
        label={`Aksi lain untuk dokumen ${number}`}
        items={[{ key: "void", label: "Batalkan dokumen", danger: true, disabled: busy }]}
        onAction={(key) => {
          if (key === "void") setOpen(true);
        }}
      />
      <ConfirmDialog
        open={open}
        title={`Batalkan dokumen ${number}?`}
        description="Stok dikembalikan ke keadaan sebelum dokumen ini dan jurnal pembalik dibuat bila dokumen ini pernah menjurnal. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan dokumen"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
