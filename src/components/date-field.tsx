"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DATE_DISPLAY_PLACEHOLDER,
  groupDateDigits,
  isoToDisplay,
  parseDateText,
} from "@/lib/date-field";
import { cn } from "@/lib/utils";
import { fieldWidths } from "@/components/blocks/field-classes";

/**
 * A-25 U2 — DateField: komponen tanggal bersama (sisa U0). Mengikuti
 * kontrak MoneyInput: nilai yang dipertukarkan selalu ISO
 * `yyyy-mm-dd` ("" = kosong), sedangkan teks yang DILIHAT pengguna
 * selalu format Indonesia `dd/mm/yyyy` — tidak lagi bergantung pada
 * render input tanggal native peramban (mm/dd/yyyy di Chromium).
 *
 * Dua mode pemakaian:
 * - Terkontrol (form klien): `value` + `onChange`, seperti MoneyInput.
 * - Form GET server: `name` + `defaultValue` — komponen merender
 *   input tersembunyi bernama `name` berisi nilai ISO terakhir yang
 *   sah, jadi pengiriman form membawa ISO walau tampilannya dd/mm/yyyy.
 *
 * Ketikan digit dikelompokkan otomatis (06112026 → 06/11/2026);
 * tanggal lengkap yang terbaca langsung diterbitkan; teks belum
 * lengkap tidak menampilkan galat sampai blur (pola "pending"
 * MoneyInput). `onValidityChange` memungkinkan form menahan kirim.
 */
export function DateField({
  value,
  defaultValue,
  onChange,
  onValidityChange,
  name,
  id,
  className,
  placeholder = DATE_DISPLAY_PLACEHOLDER,
  disabled,
  "aria-label": ariaLabel,
}: {
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  onValidityChange?: (valid: boolean) => void;
  name?: string;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const controlled = value !== undefined;
  const initialIso = value ?? defaultValue ?? "";
  const [text, setText] = useState(() => isoToDisplay(initialIso));
  const [iso, setIso] = useState(() =>
    /^\d{4}-\d{2}-\d{2}/.test(initialIso) ? initialIso.slice(0, 10) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef(value ?? defaultValue ?? "");

  // Sinkronisasi nilai eksternal (mode terkontrol / reset form).
  useEffect(() => {
    if (!controlled) return;
    if (value !== lastEmitted.current) {
      lastEmitted.current = value ?? "";
      setText(isoToDisplay(value ?? ""));
      setIso(value ?? "");
      setError(null);
      onValidityChange?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nextIso: string) {
    lastEmitted.current = nextIso;
    setIso(nextIso);
    onChange?.(nextIso);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const grouped = groupDateDigits(event.target.value);
    setText(grouped);
    const parsed = parseDateText(grouped);
    if (parsed.ok) {
      // Kosong atau tanggal lengkap: keduanya keadaan sah.
      setError(null);
      emit(parsed.value);
      onValidityChange?.(true);
    } else {
      // Belum lengkap / belum terbaca: jangan berkedip galat saat
      // mengetik; blur yang memutuskan.
      onValidityChange?.(false);
    }
  }

  function handleBlur() {
    const parsed = parseDateText(text);
    if (parsed.ok) {
      setText(isoToDisplay(parsed.value));
      setError(null);
      if (parsed.value !== lastEmitted.current) emit(parsed.value);
      onValidityChange?.(true);
    } else {
      setError(parsed.error);
      onValidityChange?.(false);
    }
  }

  return (
    <div>
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <input
        id={inputId}
        type="text"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "field-control num h-9 w-full rounded-md border border-input bg-background px-2.5 text-[12px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60",
          error && "border-destructive",
          className,
        )}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-[11px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Varian rentang: dua DateField berdampingan berlabel Dari/Sampai,
 * untuk bar filter daftar (pengganti pasangan input tanggal native
 * yang dulu hidup di halaman jurnal & laporan). Semua prop diteruskan
 * ke masing-masing field — mode form GET (`name` + `defaultValue`)
 * maupun terkontrol (`value` + `onChange`).
 */
export function DateRangeField({
  from,
  to,
  className,
}: {
  from: Omit<React.ComponentProps<typeof DateField>, "aria-label"> & { label?: string };
  to: Omit<React.ComponentProps<typeof DateField>, "aria-label"> & { label?: string };
  className?: string;
}) {
  const { label: fromLabel = "Dari", ...fromProps } = from;
  const { label: toLabel = "Sampai", ...toProps } = to;
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("block", fieldWidths.dateRange)}>
        <DateField aria-label={fromLabel} {...fromProps} />
      </span>
      <span aria-hidden className="text-muted-foreground">–</span>
      <span className={cn("block", fieldWidths.dateRange)}>
        <DateField aria-label={toLabel} {...toProps} />
      </span>
    </div>
  );
}
