/**
 * A-26 Q7 (P-10/D-12): rumah bersama chrome modal form (backdrop
 * `fixed inset-0 z-[80]`, panel max-w-xl, footer Batal/Simpan).
 * Implementasi dipindah apa adanya dari
 * `pengaturan/forms/shared.tsx` — berkas itu kini me-re-export dari
 * sini agar pemanggil Pengaturan tidak berubah; duplikat lokal di
 * `gudang/partner-forms.tsx` dihapus dan memakai komponen ini.
 *
 * G1 (FRM-01): perilaku tutup diseragamkan dengan ConfirmDialog —
 * tombol Escape dan klik pada latar menutup dialog (keduanya
 * dinonaktifkan selama `busy`), agar tidak ada lagi perbedaan
 * perilaku tutup antar-form yang dulu hidup di overlay racikan.
 * Lapisan resmi: Modal z-[80]; ConfirmDialog z-[90] selalu di atasnya
 * karena dialog konfirmasi bisa dibuka dari dalam modal.
 */
"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  busy,
  wide,
  submitLabel = "Simpan",
  busyLabel = "Menyimpan…",
  submitDisabled = false,
  footer,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Wajib kecuali `footer` kustom diberikan. */
  onSubmit?: () => void;
  busy: boolean;
  /** Panel lebar (mis. editor peran berdampingan): max-w-2xl. */
  wide?: boolean;
  /** Label tombol utama bila aksinya bukan menyimpan biasa
      (mis. "Posting kasbon", "Buat pembalik") — G1/FRM-01. */
  submitLabel?: string;
  busyLabel?: string;
  /** Nonaktifkan tombol utama di luar keadaan busy (mis. menunggu
      pratinjau dihitung) — G1/FRM-01. */
  submitDisabled?: boolean;
  /** Baris aksi kustom menggantikan footer Batal/Simpan bawaan —
      hanya untuk alur bertahap yang memang tidak berbentuk
      Batal/Simpan (mis. wizard pratinjau→terapkan ubah massal).
      Chrome dialog (latar, Escape, panel) tetap Modal bersama. */
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  // Auto-focus input pertama saat terbuka dan pulihkan fokus saat modal ditutup (UI-001)
  useEffect(() => {
    previouslyFocusedElementRef.current = document.activeElement as HTMLElement | null;

    const timer = window.setTimeout(() => {
      if (!panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 40);

    return () => {
      window.clearTimeout(timer);
      if (previouslyFocusedElementRef.current && typeof previouslyFocusedElementRef.current.focus === "function") {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, []);

  // Keyboard navigation & Focus trap (UI-001, UI-006)
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        onClose();
        return;
      }

      if (event.key === "Tab" && panelRef.current) {
        const focusables = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (event.shiftKey) {
          if (document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-xl"} rounded-xl border border-border bg-card shadow-xl`}
      >
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-[14px] font-semibold">{title}</h2>
        </div>
        <div className="p-5">{children}</div>
        {footer ?? (
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3 text-[12px] hover:bg-muted">Batal</button>
            <button type="button" onClick={onSubmit} disabled={busy || submitDisabled} className="h-8 rounded-md bg-primary px-4 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {busy ? busyLabel : submitLabel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
