"use client";

import { useRef, type FormEvent, type ReactNode } from "react";

/**
 * Form filter GET yang menerapkan perubahan otomatis.
 *
 * Pola yang dipakai:
 * - select / checkbox / date: langsung submit saat berubah;
 * - input teks pencarian (name="q"): debounce 450ms;
 * - input teks tanggal: submit saat blur;
 * - Enter tetap men-submit (aksesibilitas keyboard).
 *
 * Tombol submit tetap dirender oleh pemanggil sebagai fallback tanpa
 * JavaScript / navigasi keyboard, tetapi pengguna tidak perlu klik.
 */
export function AutoFilterForm({
  action,
  className,
  children,
  debounceMs = 450,
}: {
  action: string;
  className?: string;
  children: ReactNode;
  debounceMs?: number;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function submit() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    formRef.current?.requestSubmit();
  }

  function scheduleSubmit() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(submit, debounceMs);
  }

  function onChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLSelectElement) {
      submit();
      return;
    }
    if (target instanceof HTMLInputElement) {
      if (target.type === "date" || target.type === "checkbox" || target.type === "radio") {
        submit();
        return;
      }
      if (target.name === "q") {
        scheduleSubmit();
      }
    }
  }

  function onBlur(event: FormEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "text" || target.name === "q") return;
    // Fokus pindah ke kontrol lain di form yang sama bukan alasan
    // submit ganda — select/date berikutnya akan memicu submit sendiri.
    const related = (event.nativeEvent as FocusEvent).relatedTarget;
    if (related instanceof Node && formRef.current?.contains(related)) {
      return;
    }
    submit();
  }

  return (
    <form
      ref={formRef}
      action={action}
      method="get"
      className={className}
      onChange={onChange}
      onBlur={onBlur}
    >
      {children}
    </form>
  );
}
