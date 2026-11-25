"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
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
  const nativeRef = useRef<HTMLInputElement>(null);
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

  function handleNativeChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setText(isoToDisplay(next));
    setError(null);
    emit(next);
    onValidityChange?.(true);
  }

  function openCalendar() {
    const input = nativeRef.current;
    if (!input) return;
    const picker = input as HTMLInputElement & { showPicker?: () => void };
    try {
      if (picker.showPicker) {
        picker.showPicker();
        return;
      }
    } catch {
      // Browser dapat menolak showPicker di luar gesture; fallback click.
    }
    input.click();
  }

  return (
    <div>
      {name ? <input type="hidden" name={name} value={iso} /> : null}
      <div className="relative">
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
            "field-control num h-11 w-full rounded-md border border-input bg-background px-2.5 pr-11 text-[13px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-60",
            error && "border-destructive",
            className,
          )}
        />
        <button
          type="button"
          onClick={openCalendar}
          disabled={disabled}
          aria-label={ariaLabel ? `Pilih ${ariaLabel} dari kalender` : "Pilih tanggal dari kalender"}
          title="Buka kalender"
          className="absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        >
          <CalendarDays className="size-3.5" />
        </button>
        {/* Native input transparan di atas ikon kalender: klik area ikon
            membuka pemilih tanggal bawaan browser di semua platform,
            sementara input teks tetap bisa diketik manual. */}
        <input
          ref={nativeRef}
          type="date"
          value={iso}
          onChange={handleNativeChange}
          tabIndex={-1}
          aria-hidden="true"
          className="absolute inset-y-0 right-0 w-11 cursor-pointer opacity-0"
        />
      </div>
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
