"use client";

import { useEffect, type Dispatch, type SetStateAction } from "react";

export function focusPosTenderedInput(mobile: boolean) {
  const id = mobile ? "pos-tendered-input-mobile" : "pos-tendered-input";
  const element = document.getElementById(id) as HTMLInputElement | null;
  element?.focus();
  element?.select();
}

/**
 * Escape keluar dari mode layar penuh POS. Dialog yang sedang terbuka
 * menangani Escape-nya sendiri, jadi handler ini ditangguhkan.
 */
export function useExitFullscreenOnEscape(params: {
  fullscreen: boolean;
  suspended: boolean;
  setFullscreenOverride: Dispatch<SetStateAction<boolean | null>>;
}) {
  const { fullscreen, suspended, setFullscreenOverride } = params;
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || suspended) return;
      event.preventDefault();
      setFullscreenOverride(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, suspended, setFullscreenOverride]);
}

export function useCloseMobileCartOnDesktop(
  setMobileCartOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMobileCartOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, [setMobileCartOpen]);
}
