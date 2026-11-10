"use client";

import { useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
// A-22 K6: input combobox memakai fieldClass bersama (h-8, teks
// 12px, ring fokus) — sebelumnya h-9/13px, satu-satunya kontrol form
// akuntansi yang tidak mengikuti pola field bersama.
import { fieldClass } from "@/components/akuntansi/field-classes";

export type ComboboxAccount = { id: string; code: string; name: string; type: string };

const TYPE_LABELS: Record<string, string> = {
  asset: "Aset",
  liability: "Kewajiban",
  equity: "Ekuitas",
  revenue: "Pendapatan",
  cogs: "HPP",
  expense: "Beban",
};

/**
 * AK-P3-05(a) — searchable account picker. Same interaction pattern as the
 * warehouse ProductPicker (text input + filtered dropdown), but filtering
 * runs locally because account lists are small and already loaded by the
 * form. Supports ArrowUp/ArrowDown + Enter + Escape.
 */
export function AccountCombobox({
  accounts,
  value,
  onChange,
  id,
  placeholder = "Cari kode atau nama akun…",
  className,
  "aria-label": ariaLabel,
}: {
  accounts: ComboboxAccount[];
  value: string;
  onChange: (accountId: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const selected = accounts.find((account) => account.id === value);
  const selectedLabel = selected ? `${selected.code} — ${selected.name}` : "";
  const [text, setText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = `accounts-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  const query = (text ?? selectedLabel).trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!open || text === null || query === selectedLabel.toLowerCase()) return accounts;
    return accounts.filter(
      (account) =>
        account.code.toLowerCase().includes(query) || account.name.toLowerCase().includes(query),
    );
  }, [accounts, open, text, query, selectedLabel]);

  function choose(account: ComboboxAccount) {
    onChange(account.id);
    setText(null);
    setOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) =>
        filtered.length === 0 ? 0 : (current + delta + filtered.length) % filtered.length,
      );
    } else if (event.key === "Enter") {
      if (open && filtered.length > 0) {
        event.preventDefault();
        choose(filtered[Math.min(highlight, filtered.length - 1)]);
      }
    } else if (event.key === "Escape") {
      setOpen(false);
      setText(null);
    }
  }

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && filtered[highlight] ? `${listId}-${filtered[highlight].id}` : undefined
        }
        aria-label={ariaLabel}
        autoComplete="off"
        value={text ?? selectedLabel}
        placeholder={placeholder}
        onChange={(event) => {
          setText(event.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => {
          setText(selectedLabel);
          setOpen(true);
        }}
        onBlur={() => {
          // Option clicks use onMouseDown so they land before this blur.
          setOpen(false);
          setText(null);
        }}
        onKeyDown={handleKeyDown}
        className={fieldClass}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Daftar akun"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2.5 py-1.5 text-[12px] text-muted-foreground">
              Tidak ada akun yang cocok.
            </li>
          ) : (
            filtered.map((account, index) => (
              <li
                key={account.id}
                id={`${listId}-${account.id}`}
                role="option"
                aria-selected={account.id === value}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(account);
                  }}
                  onMouseEnter={() => setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px]",
                    index === highlight && "bg-muted",
                    account.id === value && "font-medium",
                  )}
                >
                  <span className="num shrink-0 text-muted-foreground">{account.code}</span>
                  <span className="min-w-0 flex-1 truncate">{account.name}</span>
                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {TYPE_LABELS[account.type] ?? account.type}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
