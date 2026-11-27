"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  applyQtyEdit,
  formatQtyText,
  parseQtyText,
  type QtyLimits,
} from "@/lib/qty-input";
import { isIncrementalMoneyEdit } from "@/lib/money-input";
import { cn } from "@/lib/utils";

/**
 * G2 (FRM-03) — input kuantitas bersama, pasangan MoneyInput/
 * PercentInput untuk jumlah barang: menutup salinan pola parse &
 * jepit yang hidup di editor baris, opname, keranjang POS, retur,
 * dan form gudang lain (keputusan A-28 ditinjau dengan bukti audit).
 *
 * `value`/`onChange` berbicara string Decimal kanonis yang sama
 * dengan yang selama ini hidup di state form pemanggil — yang
 * berubah hanya tampilannya (formatQty: "2,5", "1.500") dan bahwa
 * parse/jepit kini satu implementasi. `decimals` mengatur langkah
 * desimal per konteks; `min`/`max` menjepit nilai yang diserahkan
 * pada saat ketik, meniru penjepitan onChange form retur POS lama.
 */
export function QtyInput({
  value,
  onChange,
  onValidityChange,
  id,
  className,
  wrapperClassName,
  placeholder = "0",
  disabled,
  decimals,
  min,
  max,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (canonical: string) => void;
  onValidityChange?: (valid: boolean) => void;
  id?: string;
  className?: string;
  /** Lebar pembungkus untuk titik yang dulu menaruh lebar pada
   *  <input> telanjang di dalam flex/tabel (opname, keranjang). */
  wrapperClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  decimals?: number;
  min?: string;
  max?: string;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const limits: QtyLimits = { decimals, min, max };
  const [text, setText] = useState(() => formatQtyText(value, limits));
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  // External reset (e.g. the parent form re-initialised the quantity).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(formatQtyText(value, limits));
      setError(null);
      onValidityChange?.(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function reportValidity(valid: boolean) {
    onValidityChange?.(valid);
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const raw = event.target.value;
    // Kontrak ketik/tempel yang sama dengan MoneyInput (SIS-01).
    const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
    const pasted = inputType
      ? inputType === "insertFromPaste"
      : !isIncrementalMoneyEdit(text, raw);
    const outcome = applyQtyEdit(text, raw, { ...limits, pasted });
    if (outcome.kind === "value") {
      setText(outcome.text);
      setError(null);
      lastEmitted.current = outcome.value;
      onChange(outcome.value);
      reportValidity(true);
      return;
    }
    if (outcome.kind === "pending") {
      // Awalan yang masuk akal ("1,"): tahan teks, jangan serahkan,
      // jangan kedipkan error — blur yang menuntaskan.
      setText(outcome.text);
      reportValidity(false);
      return;
    }
    setText(outcome.text);
    setError(outcome.error);
    reportValidity(false);
  }

  function handleBlur() {
    const parsed = parseQtyText(text, limits);
    if (parsed.ok) {
      setText(formatQtyText(parsed.value, limits));
      setError(null);
      if (parsed.value !== lastEmitted.current) {
        lastEmitted.current = parsed.value;
        onChange(parsed.value);
      }
      reportValidity(true);
    } else if (text.trim() !== "") {
      setError(parsed.error);
      reportValidity(false);
    } else {
      setError(null);
      reportValidity(true);
    }
  }

  return (
    <div className={wrapperClassName}>
      <input
        id={inputId}
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          "num h-11 w-full rounded-md border border-input bg-background px-2.5 text-right text-[13px] outline-none focus:border-ring disabled:opacity-50 lg:h-9",
          error && "border-destructive",
          className,
        )}
      />
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-left text-[11px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
