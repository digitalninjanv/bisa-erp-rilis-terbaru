"use client";

import { useEffect, useState } from "react";
import type { CustomFieldDefinition, CustomFieldValues } from "@/lib/custom-fields";
import { inputClass } from "@/components/blocks/field-classes";
import { DateField } from "@/components/date-field";

/**
 * Renders the inputs for a company's custom fields (T5-2, D-16) inside
 * the product and partner forms. Values are plain strings keyed by the
 * definition key; the server validates and normalizes them on save
 * (numbers become canonical Decimal strings, dates must be real).
 */
export function CustomFieldInputs({
  definitions,
  values,
  onChange,
}: {
  definitions: CustomFieldDefinition[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  // T5R-6: a stored select value can go stale when an admin edits the
  // definition's options. Left alone it trapped the form: the select
  // LOOKED empty (no matching <option>) while the state still held the
  // stale value, and saving then failed server validation on a field
  // the user could not see. Instead the stale value is cleared from
  // state as soon as it is detected and a visible hint names it, so
  // the user consciously picks a replacement.
  const [staleValues, setStaleValues] = useState<Record<string, string>>({});

  useEffect(() => {
    // The correction writes to the PARENT's form state, so it cannot
    // happen during render; deferring it one tick also keeps it out of
    // this component's synchronous render cascade.
    const timer = setTimeout(() => {
      for (const field of definitions) {
        if (field.type !== "select") continue;
        const value = values[field.key] ?? "";
        if (value && !(field.options ?? []).includes(value)) {
          setStaleValues((prev) =>
            prev[field.key] === value ? prev : { ...prev, [field.key]: value },
          );
          onChange(field.key, "");
        }
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [definitions, values, onChange]);

  if (definitions.length === 0) return null;
  return (
    <>
      {definitions.map((field) => {
        const rawValue = values[field.key] ?? "";
        const isStale =
          field.type === "select" &&
          rawValue !== "" &&
          !(field.options ?? []).includes(rawValue);
        const staleHint = isStale
          ? rawValue
          : rawValue === ""
            ? staleValues[field.key]
            : undefined;
        return (
        <label key={field.key} className="block space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {field.label}
            {field.required ? <span className="text-destructive"> *</span> : null}
          </span>
          {field.type === "select" ? (
            <>
              <select
                value={isStale ? "" : rawValue}
                onChange={(event) => onChange(field.key, event.target.value)}
                className={inputClass}
                aria-label={field.label}
              >
                <option value="">—</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
              {staleHint ? (
                <span className="block text-[10px] leading-4 text-tone-amber">
                  Nilai sebelumnya &ldquo;{staleHint}&rdquo; tidak lagi tersedia — pilih nilai
                  baru.
                </span>
              ) : null}
            </>
          ) : field.type === "date" ? (
            <DateField
              value={values[field.key] ?? ""}
              onChange={(value) => onChange(field.key, value)}
              className={inputClass}
              aria-label={field.label}
            />
          ) : (
            <input
              value={values[field.key] ?? ""}
              onChange={(event) => onChange(field.key, event.target.value)}
              inputMode={field.type === "number" ? "decimal" : undefined}
              className={`${inputClass} ${field.type === "number" ? "num text-right" : ""}`}
              aria-label={field.label}
            />
          )}
        </label>
        );
      })}
    </>
  );
}

/**
 * Read-only rows for detail views: only fields that are still defined
 * AND have a stored value are shown — orphan values of deleted
 * definitions are ignored here (they remain stored on the row).
 */
export function CustomFieldValueList({
  definitions,
  values,
}: {
  definitions: CustomFieldDefinition[];
  values: CustomFieldValues | null | undefined;
}) {
  const visible = definitions.filter((field) => {
    const value = values?.[field.key];
    return value !== undefined && value !== "";
  });
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map((field) => (
        <div key={field.key} className="flex items-center justify-between gap-2">
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="num truncate font-medium">{values?.[field.key]}</dd>
        </div>
      ))}
    </>
  );
}

