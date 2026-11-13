import Link from "next/link";
import { Search } from "lucide-react";
import { AutoFilterForm } from "@/components/blocks/auto-filter-form";

export function SearchForm({
  action,
  q,
  placeholder = "Cari...",
  hidden = {},
  children,
}: {
  action: string;
  q?: string;
  placeholder?: string;
  hidden?: Record<string, string | undefined>;
  children?: React.ReactNode;
}) {
  return (
    <AutoFilterForm action={action} className="flex flex-wrap items-center gap-2">
      {Object.entries(hidden).map(([key, value]) =>
        value ? <input key={key} type="hidden" name={key} value={value} /> : null,
      )}
      <div className="relative min-w-[190px] flex-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          aria-label="Kata kunci pencarian"
          className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-2.5 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
        />
      </div>
      {children}
      <button
        type="submit"
        className="h-8 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium transition-colors hover:bg-muted"
      >
        Cari
      </button>
    </AutoFilterForm>
  );
}

export function FilterChips({
  options,
  value,
  basePath,
  param = "filter",
  q,
  params = {},
}: {
  options: { label: string; value: string }[];
  value?: string;
  basePath: string;
  param?: string;
  q?: string;
  // A-22 K6: parameter lain yang harus dipertahankan saat chip
  // berganti (mis. tab piutang/utang) — sebelumnya chip hanya bisa
  // membawa q, jadi halaman bertab tidak bisa memakai komponen ini.
  params?: Record<string, string | undefined>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((option) => {
        const search = new URLSearchParams();
        Object.entries(params).forEach(([key, val]) => {
          if (val) search.set(key, val);
        });
        if (q) search.set("q", q);
        if (option.value) search.set(param, option.value);
        const href = search.toString() ? `${basePath}?${search}` : basePath;
        const active = (value ?? "") === option.value;
        return (
          <Link
            key={option.value}
            href={href}
            className={
              active
                ? "inline-flex h-8 items-center rounded-full bg-foreground px-3 text-[11px] font-medium text-background"
                : "inline-flex h-8 items-center rounded-full border border-border bg-card px-3 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
            }
          >
            {option.label}
          </Link>
        );
      })}
    </div>
  );
}
