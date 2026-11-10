/**
 * A-28 UI-1 (UX-B01/B03): handler pintasan keyboard GLOBAL terminal
 * POS. Pemetaan tombol murni tinggal di lib/pos/terminal-shortcuts;
 * hook ini hanya mengikatnya ke jendela selama terminal hidup.
 *
 * Pola ref-sama seperti use-barcode-scanner: handler selalu membaca
 * opsi terbaru tanpa memasang ulang listener. Pintasan ditangguhkan
 * (`suspended`) selama dialog terminal (Tahan/Resume) terbuka agar
 * dialog memiliki keyboard-nya sendiri, dan pengulangan tombol
 * (tahan F9) tidak memicu aksi beruntun.
 */
"use client";

import { useEffect, useRef } from "react";
import {
  resolveTerminalShortcut,
  type TerminalShortcutAction,
} from "@/lib/pos/terminal-shortcuts";

export function useTerminalShortcuts(options: {
  suspended: boolean;
  onShortcut: (action: TerminalShortcutAction) => void;
}) {
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const opts = optionsRef.current;
      if (opts.suspended || event.repeat) return;
      const action = resolveTerminalShortcut(event);
      if (!action) return;
      event.preventDefault();
      opts.onShortcut(action);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
