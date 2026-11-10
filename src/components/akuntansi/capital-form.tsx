"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PiggyBank, Plus } from "lucide-react";
import { toast } from "sonner";
import { createCapitalAction } from "@/server/actions/accounting/akun-pemetaan";
import { d } from "@/lib/money";
import { AccountCombobox, type ComboboxAccount } from "./account-combobox";
import { MoneyInput } from "@/components/money-input";
import { DateField } from "@/components/date-field";
import { useActionRunner } from "@/components/use-action-runner";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";

type Account = { id: string; code: string; name: string };

export function CapitalForm({
  cashAccounts,
  equityAccounts,
  today,
}: {
  cashAccounts: Account[];
  equityAccounts: Account[];
  today: string;
}) {
  const router = useRouter();
  const cashCombobox: ComboboxAccount[] = cashAccounts.map((row) => ({ ...row, type: "asset" }));
  const equityCombobox: ComboboxAccount[] = equityAccounts.map((row) => ({ ...row, type: "equity" }));
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [accountId, setAccountId] = useState(cashAccounts[0]?.id ?? "");
  const [equityAccountId, setEquityAccountId] = useState(equityAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [amountValid, setAmountValid] = useState(true);
  const [description, setDescription] = useState("");
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();

  async function submit() {
    if (!amountValid) {
      toast.error("Nominal modal tidak terbaca. Periksa bidang nominal.");
      return;
    }
    if (!d(amount || "0").gt(0)) {
      toast.error("Nominal modal harus lebih dari nol.");
      return;
    }
    if (description.trim().length < 3) {
      toast.error("Keterangan wajib diisi.");
      return;
    }
    const data = await run(createCapitalAction({
      date,
      accountId,
      equityAccountId: equityAccountId || undefined,
      amount,
      description,
    }));
    if (data === null) return;
    toast.success(`Setoran modal ${data.number} diposting.`);
    setAmount("");
    setDescription("");
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Setoran modal</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Dana pemilik masuk ke kas/bank dan menambah ekuitas.</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" /> {open ? "Tutup" : "Modal baru"}
        </button>
      </div>
      {open ? (
        <div className="space-y-3 border-t border-border p-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1">
              <span className={labelClass}>Tanggal</span>
              <DateField value={date} onChange={setDate} aria-label="Tanggal" />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Nominal</span>
              <MoneyInput
                value={amount}
                onChange={setAmount}
                onValidityChange={setAmountValid}
                aria-label="Nominal setoran modal"
                className="h-9 text-[12px]"
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Masuk ke</span>
              <AccountCombobox
                accounts={cashCombobox}
                value={accountId}
                onChange={setAccountId}
                aria-label="Akun kas atau bank tujuan modal"
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Akun ekuitas</span>
              <AccountCombobox
                accounts={equityCombobox}
                value={equityAccountId}
                onChange={setEquityAccountId}
                aria-label="Akun ekuitas modal"
              />
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className={labelClass}>Keterangan</span>
              <input value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} placeholder="Setoran modal awal pemilik" />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <PiggyBank className="size-3.5" /> {busy ? "Menyimpan…" : "Posting modal"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

