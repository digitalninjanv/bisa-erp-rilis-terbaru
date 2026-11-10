"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";

/**
 * FIX-GDG Tahap 4 (GDG2-09) — dialog konfirmasi bersama, pengganti
 * window.prompt/window.confirm bawaan peramban. Dialog bawaan tidak
 * bisa menampilkan ringkasan dampak, tidak mengikuti tema, dan buruk
 * diakses; dialog ini mengikuti pola overlay kustom yang sudah dipakai
 * modul (reservasi, modal akuntansi): judul, ringkasan dampak, kolom
 * alasan opsional (wajib untuk pembatalan dokumen), dan tombol
 * batal/konfirmasi yang jelas.
 *
 * Pemakaian: komponen pemanggil memegang state `open` sendiri dan
 * merender dialog ini di samping tombol pemicunya.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Ya, lanjutkan",
  cancelLabel = "Kembali",
  danger = false,
  busy = false,
  reason,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  reason?: {
    label: string;
    placeholder?: string;
    initialValue?: string;
    /** Panjang minimum alasan valid; 0 = alasan opsional. */
    minLength?: number;
  };
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reasonText, setReasonText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Setiap pembukaan mulai dari alasan awal yang dinyatakan pemanggil —
  // penyesuaian state saat render (pola resmi React untuk state yang
  // diturunkan dari perubahan prop), bukan setState di dalam effect.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setReasonText(reason?.initialValue ?? "");
  }

  // Fokus ke kolom alasan bila ada; selain itu ke tombol konfirmasi.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      if (reason) inputRef.current?.focus();
      else confirmRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [open, reason]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const minLength = reason?.minLength ?? 0;
  const reasonValid = !reason || reasonText.trim().length >= minLength;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
          {description ? (
            <div className="mt-1 text-[12px] leading-5 text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {reason ? (
          <div className="px-5 pt-4">
            <label className="space-y-1">
              <span className={labelClass}>{reason.label}</span>
              <input
                ref={inputRef}
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
                placeholder={reason.placeholder}
                className={fieldClass}
              />
            </label>
            {minLength > 0 && reasonText.trim().length < minLength ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Alasan wajib diisi minimal {minLength} karakter.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex justify-end gap-2 px-5 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-8 rounded-md border border-border px-3 text-[12px] transition-colors hover:bg-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onConfirm(reasonText.trim())}
            disabled={busy || !reasonValid}
            className={
              danger
                ? "h-8 rounded-md bg-destructive px-4 text-[12px] font-medium text-white transition-colors hover:bg-destructive/90 disabled:opacity-50"
                : "h-8 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            }
          >
            {busy ? "Memproses…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
