/**
 * G1 (FRM-04): pembungkus Field bersama (label + kontrol + petunjuk +
 * error) untuk SELURUH modul. Sebelumnya komponen ini hanya hidup di
 * lingkup Pengaturan (`pengaturan/forms/shared.tsx`) sementara ≥5
 * berkas di modul lain menyalin definisinya sendiri (product-form,
 * partner-forms, user-access, group-pricing, pos-display). Kini satu
 * rumah di blocks/; berkas Pengaturan me-re-export dari sini agar
 * pemanggil lamanya tidak berubah.
 *
 * Standar form (2026-11-27):
 * - label selalu terlihat, bukan placeholder;
 * - field wajib ditandai visual + teks pembaca layar;
 * - hint/error berada di bawah kontrol dan terhubung lewat
 *   `aria-describedby` bila kontrol adalah satu elemen tunggal;
 * - error memakai `role="alert"` agar langsung diumumkan.
 */
"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactElement,
  type ReactNode,
} from "react";
import { labelClass } from "@/components/blocks/field-classes";

export function Field({
  label,
  children,
  className,
  required,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  // Untuk kontrol tunggal, teruskan atribut aksesibilitas langsung ke
  // input/select/textarea. Field majemuk (mis. input + tombol) tetap
  // dirender apa adanya; teks hint/error tetap terlihat.
  const onlyChild = Children.count(children) === 1 ? Children.only(children) : null;
  const control =
    onlyChild && isValidElement(onlyChild)
      ? cloneElement(onlyChild as ReactElement<Record<string, unknown>>, {
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          "aria-required": required ? true : undefined,
        })
      : children;

  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className={labelClass}>
        {label}
        {required ? (
          <>
            <span className="ml-0.5 font-bold text-rose-500" aria-hidden="true">*</span>
            <span className="sr-only"> (wajib diisi)</span>
          </>
        ) : null}
      </span>
      {control}
      {hint ? (
        <span id={hintId} className="block text-[11px] leading-4 text-muted-foreground">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="block text-[11px] font-medium leading-4 text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}
