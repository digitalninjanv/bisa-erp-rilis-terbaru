"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/errors";

/**
 * G2 (FRM-05) — rumah bersama untuk pola submit form klien.
 *
 * Pola dominan repo selama ini ditulis tangan per form (audit
 * menghitung 78 berkas memeriksa `result.ok` sendiri dan 63 berkas
 * mendeklarasikan busy sendiri): setel busy → jalankan aksi →
 * lepas busy → `toast.error(result.message)` bila gagal → lanjut
 * bila sukses. Perilaku hari ini seragam oleh konvensi; modul ini
 * membuatnya seragam oleh kode, agar form baru tidak menyimpang
 * diam-diam. Adopsi bertahap: hanya titik yang polanya identik
 * lurus yang bermigrasi; sisanya tercatat sebagai adopsi lanjutan.
 */

/**
 * Inti tanpa-hook: jalankan satu aksi server dan tampilkan error
 * kegagalannya sebagai toast (persis pola dominan). Mengembalikan
 * data aksi bila sukses, atau `null` bila gagal — pemanggil
 * membedakan dengan `=== null` karena data sukses boleh `undefined`
 * (aksi tanpa payload) tetapi tidak pernah `null` pada pola repo.
 */
export async function runActionResult<T>(action: Promise<ActionResult<T>>): Promise<T | null> {
  const result = await action;
  if (!result.ok) {
    toast.error(result.message);
    return null;
  }
  return result.data;
}

/**
 * Pasangan hook untuk form: mengelola state `busy` di sekeliling
 * `runActionResult`. Satu runner per komponen form — beberapa aksi
 * berurutan dalam satu submit berbagi busy yang sama, sama seperti
 * pola tangan sebelumnya. Pengecualian dari aksi (di luar kontrak
 * ActionResult) tetap terlempar ke pemanggil; busy selalu dilepas.
 */
export function useActionRunner() {
  const [busy, setBusy] = useState(false);

  const run = useCallback(async <T,>(action: Promise<ActionResult<T>>): Promise<T | null> => {
    setBusy(true);
    try {
      return await runActionResult(action);
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, run };
}

/**
 * Validasi wajib-isi sisi klien yang selama ini ditulis racikan
 * per form (`if (!x.trim()) { toast.error("…wajib diisi."); return; }`
 * di 11 titik audit). Mengembalikan true bila terisi; bila kosong,
 * toast ditampilkan di sini dan pemanggil cukup `return`.
 * Mendukung auto-scroll dan auto-focus ke elemen yang bermasalah (UI-009).
 */
export function requireFilled(
  value: string,
  message: string,
  element?: HTMLElement | string | null,
): boolean {
  if (value.trim()) return true;
  toast.error(message);
  if (typeof window !== "undefined") {
    setTimeout(() => {
      let target: HTMLElement | null = null;
      if (typeof element === "string") {
        target = document.querySelector<HTMLElement>(element);
      } else if (element) {
        target = element;
      } else {
        target = document.querySelector<HTMLElement>(
          "[aria-invalid='true'], input:invalid, select:invalid, textarea:invalid, [data-invalid='true']",
        );
      }
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.focus();
      }
    }, 50);
  }
  return false;
}

/**
 * UI-009: Auto-scroll dan auto-focus ke kontrol form yang tidak valid pertama kali.
 */
export function scrollToFirstError(container?: HTMLElement | string | null): void {
  if (typeof window === "undefined") return;
  setTimeout(() => {
    const root =
      typeof container === "string"
        ? document.querySelector(container)
        : container ?? document;
    const target = root?.querySelector<HTMLElement>(
      "[aria-invalid='true'], input:invalid, select:invalid, textarea:invalid, [data-invalid='true'], .border-destructive",
    );
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus();
    }
  }, 50);
}
