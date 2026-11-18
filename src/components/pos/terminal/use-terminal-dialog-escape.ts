"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

export function useTerminalDialogEscape(params: {
  holdOpen: boolean;
  resumeOpen: boolean;
  resumeCancel: () => void;
  setHoldOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { holdOpen, resumeOpen, resumeCancel, setHoldOpen } = params;
  useEffect(() => {
    if (!holdOpen && !resumeOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      if (resumeOpen) resumeCancel();
      else setHoldOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // resumeCancel uses current hook state but is intentionally excluded;
    // the listener is rebound whenever either dialog's visibility changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdOpen, resumeOpen]);
}
