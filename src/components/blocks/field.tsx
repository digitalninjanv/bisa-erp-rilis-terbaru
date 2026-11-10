/**
 * G1 (FRM-04): pembungkus Field bersama (label + kontrol + petunjuk)
 * untuk SELURUH modul. Sebelumnya komponen ini hanya hidup di lingkup
 * Pengaturan (`pengaturan/forms/shared.tsx`) sementara ≥5 berkas di
 * modul lain menyalin definisinya sendiri (product-form,
 * partner-forms, user-access, group-pricing, pos-display). Kini satu
 * rumah di blocks/; berkas Pengaturan me-re-export dari sini agar
 * pemanggil lamanya tidak berubah.
 */
"use client";

import type { ReactNode } from "react";
import { labelClass } from "@/components/blocks/field-classes";

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block space-y-1 ${className ?? ""}`}>
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}
