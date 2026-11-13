"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AccountCombobox } from "@/components/akuntansi/account-combobox";
import { DateRangeField } from "@/components/date-field";
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
    pushFilters({ type: typeValue, account: selectedAccount, from: fromValue, to: toValue });
  }

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = setTimeout(() => {
      pushFilters({ type: typeValue, account: selectedAccount, from: fromValue, to: toValue });
    }, 350);
    return () => clearTimeout(timer);
    // pushFilters stabil secara perilaku; dependency nilai filter saja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeValue, selectedAccount, fromValue, toValue]);

  function reset() {
    startTransition(() => {
      router.push("/app/akuntansi/buku-besar");
    });
  }

  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-2.5">
      <div className="min-w-[260px] flex-1">
        <span className={labelClass}>Akun</span>
        <AccountCombobox
          accounts={visibleAccounts}
          value={selectedAccount}
          onChange={setSelectedAccount}
          aria-label="Akun buku besar"
          className="mt-1"
        />
      </div>

      <div className="w-[150px]">
        <label className={labelClass} htmlFor="ledger-type">
          Tipe akun
        </label>
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

      <div>
        <span className={labelClass}>Periode</span>
        <DateRangeField
          className="mt-1"
          from={{ value: fromValue, onChange: setFromValue }}
          to={{ value: toValue, onChange: setToValue }}
        />
      </div>

      <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto">
        <button
          type="submit"
          disabled={pending}
          className="h-9 flex-1 rounded-md bg-primary px-4 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 sm:flex-none"
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
    </form>
  );
}
