"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { AccountCombobox } from "@/components/akuntansi/account-combobox";
import { DateField } from "@/components/date-field";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";

export type LedgerFilterAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
};

const TYPE_OPTIONS = [
  { value: "", label: "Semua tipe" },
  { value: "asset", label: "Aset" },
  { value: "liability", label: "Liabilitas" },
  { value: "equity", label: "Ekuitas" },
  { value: "revenue", label: "Pendapatan" },
  { value: "cogs", label: "HPP" },
  { value: "expense", label: "Beban" },
];

/**
 * Filter buku besar: pencarian akun (bukan select 140+ opsi), tipe,
 * periode, dan satu tombol terapkan. Nilai awal dikirim server; kunci
 * remount di halaman menjaga state klien tetap sama setelah navigasi.
 */
export function LedgerFilters({
  accounts,
  accountId,
  type,
  from,
  to,
}: {
  accounts: LedgerFilterAccount[];
  accountId: string;
  type: string;
  from: string;
  to: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [typeValue, setTypeValue] = useState(type);
  const [selectedAccount, setSelectedAccount] = useState(accountId);
  const [fromValue, setFromValue] = useState(from);
  const [toValue, setToValue] = useState(to);
  const [fromValid, setFromValid] = useState(true);
  const [toValid, setToValid] = useState(true);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const visibleAccounts = typeValue
    ? accounts.filter((account) => account.type === typeValue)
    : accounts;

  function pushFilters(next: {
    type: string;
    account: string;
    from: string;
    to: string;
  }) {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.account) params.set("account", next.account);
    params.set("from", next.from);
    params.set("to", next.to);
    startTransition(() => {
      router.push(`/app/akuntansi/buku-besar?${params.toString()}`);
    });
  }

  function apply(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fromValid || !toValid || !fromValue || !toValue) {
      setRangeError("Periksa dan lengkapi kedua tanggal.");
      return;
    }
    if (fromValue > toValue) {
      setRangeError("Tanggal mulai harus sama dengan atau sebelum tanggal akhir.");
      return;
    }
    setRangeError(null);
    pushFilters({ type: typeValue, account: selectedAccount, from: fromValue, to: toValue });
  }

  function reset() {
    startTransition(() => {
      router.push("/app/akuntansi/buku-besar");
    });
  }

  return (
    <section aria-label="Filter buku besar" className="rounded-lg border border-border bg-card p-4">
      <form onSubmit={apply} className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(300px,auto)_auto] lg:items-end">
          <div className="min-w-0">
            <span className={labelClass}>Akun buku besar</span>
            <AccountCombobox
              accounts={visibleAccounts}
              value={selectedAccount}
              onChange={setSelectedAccount}
              aria-label="Akun buku besar"
              className="mt-1"
            />
          </div>

          <fieldset className="min-w-0">
            <legend className={labelClass}>Periode</legend>
            <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end gap-2 sm:w-[310px]">
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] text-muted-foreground">Dari</span>
                <DateField
                  value={fromValue}
                  onChange={(value) => {
                    setFromValue(value);
                    setRangeError(null);
                  }}
                  onValidityChange={setFromValid}
                  aria-label="Tanggal mulai"
                />
              </div>
              <span aria-hidden className="pb-2 text-muted-foreground">–</span>
              <div className="min-w-0">
                <span className="mb-1 block text-[11px] text-muted-foreground">Sampai</span>
                <DateField
                  value={toValue}
                  onChange={(value) => {
                    setToValue(value);
                    setRangeError(null);
                  }}
                  onValidityChange={setToValid}
                  aria-label="Tanggal akhir"
                />
              </div>
            </div>
          </fieldset>

          <div className="flex items-center gap-2 lg:pb-0.5">
            <button
              type="submit"
              disabled={pending}
              className="h-9 flex-1 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 lg:flex-none"
            >
              {pending ? "Memuat…" : "Tampilkan"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="h-9 rounded-md px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-60"
            >
              Atur ulang
            </button>
          </div>
        </div>

        <details className="border-t border-border pt-2.5">
          <summary className="group flex cursor-pointer list-none items-center gap-2 text-[12px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
            <span>Filter akun tambahan</span>
            <span className="text-[11px] font-normal">
              {typeValue ? `· ${TYPE_OPTIONS.find((option) => option.value === typeValue)?.label}` : "· Tipe akun"}
            </span>
          </summary>
          <div className="mt-3 max-w-xs">
            <label className={labelClass} htmlFor="ledger-type">Tipe akun</label>
            <select
              id="ledger-type"
              value={typeValue}
              onChange={(event) => {
                const next = event.target.value;
                setTypeValue(next);
                const nextAccounts = next
                  ? accounts.filter((account) => account.type === next)
                  : accounts;
                if (!nextAccounts.some((account) => account.id === selectedAccount)) {
                  setSelectedAccount("");
                }
              }}
              className={`${fieldClass} mt-1`}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </details>

        {rangeError ? (
          <p role="alert" className="text-[11px] leading-4 text-destructive">
            {rangeError}
          </p>
        ) : null}
      </form>
    </section>
  );
}
