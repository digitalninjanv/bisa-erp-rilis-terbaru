"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  applyMoneyEdit,
  formatMoneyText,
  isIncrementalMoneyEdit,
  parseMoneyText,
} from "@/lib/money-input";
import { cn } from "@/lib/utils";

/**
 * AK-P3-05(b) — shared id-ID money input.
 *
 * `value`/`onChange` speak the canonical Decimal string ("" = empty).
 * The field displays thousand separators while typing; unreadable text
 * shows an Indonesian error under the field instead of silently becoming
 * NaN, and `onValidityChange` lets the parent form block submit.
 */
export function MoneyInput({
  value,
  onChange,
  onValidityChange,
  onBlur,
  id,
  className,
  placeholder = "0",
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (canonical: string) => void;
  onValidityChange?: (valid: boolean) => void;
  /** Dipanggil setelah isi field diselesaikan (blur) — dipakai form
   * jurnal untuk mengisi baris penyeimbang tanpa mengganggu ketikan. */
  onBlur?: () => void;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const [text, setText] = useState(() => formatMoneyText(value));
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  // External reset (e.g. the parent form re-initialised the amount).
  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(formatMoneyText(value));
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
    // A-23 SIS-01: typing and pasting follow different contracts (see
    // lib/money-input). Real browsers label the change via inputType;
    // without it (test doubles, some IMEs) the single-character-edit
    // heuristic decides — a multi-character jump is a paste.
    const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
    const pasted = inputType
      ? inputType === "insertFromPaste"
      : !isIncrementalMoneyEdit(text, raw);
    const outcome = applyMoneyEdit(text, raw, { pasted });
    if (outcome.kind === "value") {
      setText(outcome.text);
      setError(null);
      lastEmitted.current = outcome.value;
      onChange(outcome.value);
      reportValidity(true);
      return;
    }
    if (outcome.kind === "pending") {
      // Plausible mid-typing prefix ("1.500," or "1,"): keep the text,
      // do not emit, and do not flash an error yet — blur settles it.
      setText(outcome.text);
      reportValidity(false);
      return;
    }
    setText(outcome.text);
    setError(outcome.error);
    reportValidity(false);
  }

  function handleBlur() {
    const parsed = parseMoneyText(text);
    if (parsed.ok) {
      setText(formatMoneyText(parsed.value));
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
    onBlur?.();
  }

  return (
    <div>
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
          "num h-9 w-full rounded-md border border-input bg-background px-2.5 text-right text-[13px] outline-none focus:border-ring disabled:opacity-50",
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
