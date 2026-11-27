"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  applyPercentEdit,
  formatPercentText,
  parsePercentText,
} from "@/lib/percent-input";
import { isIncrementalMoneyEdit } from "@/lib/money-input";
import { cn } from "@/lib/utils";

/**
 * A-25 U6 — input persen bersama (pasangan MoneyInput untuk tarif).
 *
 * `value`/`onChange` berbicara string Decimal kanonis yang sama
 * dengan yang disimpan server ("4.0000" = 4%) — yang berubah hanya
 * tampilan: "4" / "1,27" dengan akhiran "%" yang selalu terlihat,
 * menggantikan teks mentah "4.0000" yang terpotong kolom di halaman
 * Payroll Indonesia (AUDIT-UI-A25 POLA-04). Kontrak ketik/tempel
 * meniru MoneyInput persis (lihat lib/percent-input).
 */
export function PercentInput({
  value,
  onChange,
  onValidityChange,
  id,
  className,
  placeholder = "0",
  disabled,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (canonical: string) => void;
  onValidityChange?: (valid: boolean) => void;
  id?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const errorId = `${inputId}-error`;
  const [text, setText] = useState(() => formatPercentText(value));
  const [error, setError] = useState<string | null>(null);
  const lastEmitted = useRef(value);

  useEffect(() => {
    if (value !== lastEmitted.current) {
      lastEmitted.current = value;
      setText(formatPercentText(value));
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
    const inputType = (event.nativeEvent as InputEvent | undefined)?.inputType;
    const pasted = inputType
      ? inputType === "insertFromPaste"
      : !isIncrementalMoneyEdit(text, raw);
    const outcome = applyPercentEdit(text, raw, { pasted });
    if (outcome.kind === "value") {
      setText(outcome.text);
      setError(null);
      lastEmitted.current = outcome.value;
      onChange(outcome.value);
      reportValidity(true);
      return;
    }
    if (outcome.kind === "pending") {
      setText(outcome.text);
      reportValidity(false);
      return;
    }
    setText(outcome.text);
    setError(outcome.error);
    reportValidity(false);
  }

  function handleBlur() {
    const parsed = parsePercentText(text);
    if (parsed.ok) {
      setText(formatPercentText(parsed.value));
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
    <div>
      <div className="relative">
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
            "num h-11 w-full rounded-md border border-input bg-background pl-2.5 pr-7 text-right text-[13px] outline-none focus:border-ring disabled:opacity-50 lg:h-9",
            error && "border-destructive",
            className,
          )}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[12px] text-muted-foreground">
          %
        </span>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1 text-left text-[11px] leading-4 text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
