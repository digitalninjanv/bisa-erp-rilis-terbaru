"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowRightLeft, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import {
  createBankTransferAction,
  voidBankTransferAction,
} from "@/server/actions/accounting/beban-transfer";
import { d } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { AccountCombobox, type ComboboxAccount } from "./account-combobox";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";

type Account = { id: string; code: string; name: string; balance: number };

export function BankTransferForm({ accounts, today }: { accounts: Account[]; today: string }) {
  const router = useRouter();
  // A-21 (R3-04): satu kunci idempotensi per sesi form — submit ulang
  // (klik ganda / retry jaringan) mengembalikan dokumen pertama.
  // Diperbarui sesudah submit berhasil agar dokumen berikutnya baru.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  // Rekening kas/bank selalu akun aset — combobox menampilkan label tipenya.
  const comboboxAccounts: ComboboxAccount[] = accounts.map((row) => ({ ...row, type: "asset" }));
  const [fromAccountId, setFrom] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setTo] = useState(accounts[1]?.id ?? accounts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [amount, setAmount] = useState("");
  const [amountValid, setAmountValid] = useState(true);
  const [fee, setFee] = useState("0");
  const [feeValid, setFeeValid] = useState(true);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (fromAccountId === toAccountId) {
      toast.error("Rekening asal dan tujuan harus berbeda.");
      return;
    }
    if (!amountValid || !feeValid) {
      toast.error("Ada nominal yang tidak terbaca. Periksa bidang yang ditandai.");
      return;
    }
    if (!d(amount || "0").gt(0)) {
      toast.error("Nominal transfer harus lebih dari nol.");
      return;
    }
    setBusy(true);
    const result = await createBankTransferAction({
      date,
      fromAccountId,
      toAccountId,
      amount,
      fee: fee || "0",
      reference: reference || undefined,
      description: description || undefined,
      idempotencyKey,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Transfer ${result.data.number} tersimpan.`);
    showPostingWarnings(result.data.warnings);
    setIdempotencyKey(crypto.randomUUID());
    setAmount("");
    setFee("0");
    setReference("");
    setDescription("");
    router.refresh();
  }

  if (accounts.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        Butuh minimal dua akun kas/bank untuk melakukan transfer.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Transfer antar rekening</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Pindahkan dana kas ke bank atau antar bank. Biaya administrasi otomatis dicatat sebagai
          beban bank.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="space-y-3 p-4"
      >
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-end">
          <label className="space-y-1">
            <span className={labelClass}>Dari rekening</span>
            <AccountCombobox
              accounts={comboboxAccounts}
              value={fromAccountId}
              onChange={setFrom}
              aria-label="Rekening asal transfer"
            />
          </label>
          <div
            aria-hidden
            className="hidden h-9 w-9 items-center justify-center rounded-full border border-border bg-muted/30 text-muted-foreground sm:flex"
          >
            <ArrowRight className="size-3.5" />
          </div>
          <label className="space-y-1">
            <span className={labelClass}>Ke rekening</span>
            <AccountCombobox
              accounts={comboboxAccounts}
              value={toAccountId}
              onChange={setTo}
              aria-label="Rekening tujuan transfer"
            />
          </label>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1">
            <span className={labelClass}>Nominal</span>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              onValidityChange={setAmountValid}
              aria-label="Nominal transfer"
              className="h-9 text-[12px]"
            />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Tanggal</span>
            <DateField value={date} onChange={setDate} aria-label="Tanggal transfer" />
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Biaya transfer</span>
            <MoneyInput
              value={fee}
              onChange={setFee}
              onValidityChange={setFeeValid}
              aria-label="Biaya transfer"
              className="h-9 text-[12px]"
            />
          </label>
        </div>

        <details className="group">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            Referensi & catatan (opsional)
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={labelClass}>Referensi</span>
              <input
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className={fieldClass}
                placeholder="Nomor transaksi bank"
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Catatan</span>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className={fieldClass}
                placeholder="Contoh: setoran penjualan harian"
              />
            </label>
          </div>
        </details>

        <div className="flex justify-end border-t border-border pt-3">
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:w-auto"
          >
            <ArrowRightLeft className="size-3.5" /> {busy ? "Menyimpan…" : "Posting transfer"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function BankTransferVoidButton({
  id,
  number,
  asMenu = false,
}: {
  id: string;
  number: string;
  /** G3 (UX4-01): tampil sebagai menu ⋯ berisi satu item destruktif
   * (pola ReceiptRowActions) — dipakai daftar agar tak ada tombol
   * "Batalkan" permanen per baris. */
  asMenu?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function remove(reason: string) {
    setBusy(true);
    const result = await voidBankTransferAction({ id, reason });
    setBusy(false);
    setOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Transfer dibatalkan dan jurnal pembalik dibuat.");
    router.refresh();
  }

  return (
    <>
      {asMenu ? (
        <RowMenu
          label={`Aksi untuk transfer ${number}`}
          items={[{ key: "void", label: "Batalkan transfer", danger: true, disabled: busy }]}
          onAction={(key) => {
            if (key === "void") setOpen(true);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className="inline-flex h-8 items-center rounded border border-border px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {busy ? "…" : "Batalkan"}
        </button>
      )}
      <ConfirmDialog
        open={open}
        title={`Batalkan transfer ${number}?`}
        description="Jurnal pembalik akan dibuat. Dokumen tetap tersimpan berstatus Dibatalkan."
        confirmLabel="Batalkan transfer"
        danger
        busy={busy}
        reason={{ label: "Alasan pembatalan", initialValue: "Salah input", minLength: 3 }}
        onConfirm={(reason) => void remove(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

