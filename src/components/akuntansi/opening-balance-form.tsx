"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/format";
import {
  createOpeningBalanceAction,
  voidOpeningBalanceAction,
} from "@/server/actions/accounting/saldo-awal";
import { DateField } from "@/components/date-field";
import { MoneyInput } from "@/components/money-input";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { Modal } from "@/components/blocks/modal";

type Party = { id: string; name: string };

/**
 * T4-5b (D-14): form sederhana mencatat dokumen saldo awal hutang/
 * piutang — utang/piutang lama yang diakui tanpa dokumen pembelian/
 * penjualan di sistem. Domain membuat jurnal pembukanya (Dr/Cr
 * ekuitas); form ini hanya mengumpulkan input.
 */
export function OpeningBalanceForm({
  kind,
  parties,
}: {
  kind: "payable" | "receivable";
  parties: Party[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  // A-28 Tahap 4 (H-PGT-01/02): nominal MoneyInput & tanggal
  // DateField bersama; nilai yang dipertukarkan tetap string
  // kanonis/ISO yang sama seperti field mentah sebelumnya.
  const [amountValid, setAmountValid] = useState(true);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const isPayable = kind === "payable";
  const partyLabel = isPayable ? "Pemasok" : "Pelanggan";

  async function submit() {
    if (!partyId) {
      toast.error(`Pilih ${partyLabel.toLowerCase()} terlebih dahulu.`);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      toast.error("Pilih tanggal dokumen.");
      return;
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      toast.error("Tanggal jatuh tempo tidak valid.");
      return;
    }
    if (!amountValid) {
      toast.error("Jumlah saldo awal belum terbaca — periksa kembali nominalnya.");
      return;
    }
    if (!(Number(amount) > 0)) {
      toast.error("Jumlah saldo awal harus lebih dari nol.");
      return;
    }
    setBusy(true);
    const result = await createOpeningBalanceAction({
      kind,
      partyId,
      date,
      dueDate: dueDate || null,
      amount,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Saldo awal ${result.data.number} tercatat beserta jurnal pembukanya.`);
    setOpen(false);
    setAmount("");
    setReference("");
    setNotes("");
    setDueDate("");
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] font-medium transition-colors hover:bg-muted"
      >
        <Plus className="size-3" />
        Tambah Saldo Awal
      </button>

      {open ? (
        <Modal
          title={`Saldo awal ${isPayable ? "utang" : "piutang"}`}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
          submitLabel="Simpan saldo awal"
          busyLabel="Memproses…"
        >
            <p className="mb-3 text-[11px] text-muted-foreground">
              {isPayable
                ? "Utang lama ke pemasok tanpa penerimaan barang di sistem. Jurnal pembuka: Dr Ekuitas / Cr Utang."
                : "Piutang lama dari pelanggan tanpa penjualan di sistem. Jurnal pembuka: Dr Piutang / Cr Ekuitas."}
            </p>
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className={labelClass}>{partyLabel}</span>
                <select value={partyId} onChange={(event) => setPartyId(event.target.value)} className={fieldClass}>
                  {parties.map((party) => (
                    <option key={party.id} value={party.id}>{party.name}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Tanggal dokumen</span>
                <DateField value={date} onChange={setDate} aria-label="Tanggal dokumen" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Jatuh tempo (opsional)</span>
                <DateField value={dueDate} onChange={setDueDate} aria-label="Jatuh tempo (opsional)" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Jumlah</span>
                <MoneyInput value={amount} onChange={setAmount} onValidityChange={setAmountValid} aria-label="Jumlah" className="h-9 px-2.5 text-[12px]" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Referensi (nomor faktur lama)</span>
                <input value={reference} onChange={(event) => setReference(event.target.value)} className={fieldClass} placeholder="Opsional" />
              </label>
              <label className="block space-y-1">
                <span className={labelClass}>Catatan</span>
                <input value={notes} onChange={(event) => setNotes(event.target.value)} className={fieldClass} placeholder="Opsional" />
              </label>
            </div>
        </Modal>
      ) : null}
    </>
  );
}

/** Void dokumen saldo awal — hanya tampil untuk yang belum terbayar. */
export function OpeningBalanceVoidButton({
  openingId,
  number,
  open: controlledOpen,
  onOpenChange,
}: {
  openingId: string;
  number: string;
  /** G3 (UX4-01): mode terkendali — lihat WriteOffButton. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = onOpenChange ?? setInternalOpen;

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidOpeningBalanceAction({ openingId, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Saldo awal dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {onOpenChange ? null : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy ? "…" : "Void"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan saldo awal ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan saldo awal"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

