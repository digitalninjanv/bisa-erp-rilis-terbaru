import { useEffect } from "react";

export interface FormShortcutsOptions {
  onSubmit?: () => void | Promise<void>;
  onCancel?: () => void;
  disabled?: boolean;
}

export type KeyboardEventLike = {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
};

/**
 * Logika murni evaluasi pintasan keyboard form.
 * Mengembalikan true bila pintasan cocok dan tertangani.
 */
export function handleFormKeyboardShortcut(
  event: KeyboardEventLike,
  { onSubmit, onCancel, disabled = false }: FormShortcutsOptions,
): boolean {
  if (disabled) return false;

  // Ctrl+Enter atau Cmd+Enter: Simpan / Submit
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault?.();
    onSubmit?.();
    return true;
  }

  // Escape: Batal
  if (event.key === "Escape") {
    onCancel?.();
    return true;
  }

  return false;
}

/**
 * Enterprise Form Keyboard Ergonomics:
 * Mendukung pintasan `Ctrl+Enter` / `Cmd+Enter` untuk simpan/submit cepat,
 * dan `Esc` untuk membatalkan/menutup form dialog.
 */
export function useFormShortcuts(options: FormShortcutsOptions) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    function handleKeyDown(event: KeyboardEvent) {
      handleFormKeyboardShortcut(event, options);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [options]);
}

