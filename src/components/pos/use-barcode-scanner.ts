"use client";

import { useEffect, useRef } from "react";
import {
  burstExpired,
  burstScanCode,
  createBurstState,
  feedBurstChar,
  resetBurst,
  type BurstState,
} from "@/lib/barcode-burst";

/**
 * FIX-POS Tahap 4 (POS2-03): penangkap scanner barcode GLOBAL untuk
 * terminal POS. Scanner wedge mengetik ke elemen yang sedang fokus —
 * sebelum perbaikan ini hasil pindai hilang atau mengotori field qty/
 * nominal bila fokus tidak berada di kotak cari. Listener fase-capture
 * ini menilai kecepatan ketik lewat pelacak ledakan (lib/barcode-burst):
 *
 * - Karakter kedua dan seterusnya dari ledakan mesin ditelan
 *   (preventDefault) agar tidak masuk field yang sedang fokus.
 * - Bila ledakan berakhir sebagai pindaian (Enter + syarat kecepatan),
 *   nilai field dikembalikan persis seperti sebelum ledakan
 *   (snapshot) lalu kode diserahkan ke onScan.
 * - Bila ternyata ketikan manusia cepat (tidak memenuhi syarat /
 *   berhenti tanpa Enter), karakter yang tertelan DIPUTAR ULANG ke
 *   field — tidak ada ketikan yang hilang diam-diam.
 *
 * Pengecualian yang disengaja: target yang dikecualikan pemanggil
 * (kotak cari mempunyai jalur pindainya sendiri), textarea, select,
 * dan elemen contentEditable. Keterbatasan yang diketahui: karakter
 * PERTAMA ledakan tidak dapat dibedakan dari ketikan manusia, jadi
 * satu karakter dapat sempat masuk field sebelum snapshot dipulihkan
 * saat pindaian terkonfirmasi; pada input qty hal itu dapat mengubah
 * qty sesaat, tetapi nilai akhir selalu dipulihkan dari snapshot.
 */

const IDLE_REPLAY_MS = 250;

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

export function useBarcodeScannerCapture(options: {
  /** Nonaktifkan saat dialog terbuka atau konteks tidak menerima pindaian. */
  enabled: boolean;
  onScan: (code: string) => void;
  /** Target yang tidak boleh ditangkap (mis. kotak cari terminal). */
  isIgnoredTarget?: (target: EventTarget | null) => boolean;
}) {
  const stateRef = useRef<BurstState>(createBurstState());
  const snapshotRef = useRef<{ el: HTMLInputElement; value: string } | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const optionsRef = useRef(options);

  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    function clearIdle() {
      if (idleTimerRef.current !== null) {
        window.clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    }

    /** Putar ulang karakter tertelan ke field snapshot (ketikan manusia). */
    function replaySwallowed() {
      const state = stateRef.current;
      const snap = snapshotRef.current;
      if (snap && state.swallowed && snap.el.isConnected) {
        setNativeValue(snap.el, snap.el.value + state.swallowed);
      }
      state.swallowed = "";
    }

    /** Kembalikan field ke nilai sebelum ledakan (pindaian terkonfirmasi). */
    function restoreSnapshot() {
      const snap = snapshotRef.current;
      if (snap && snap.el.isConnected && snap.el.value !== snap.value) {
        setNativeValue(snap.el, snap.value);
      }
    }

    function finishBurst() {
      resetBurst(stateRef.current);
      snapshotRef.current = null;
      clearIdle();
    }

    function scheduleIdleReplay() {
      clearIdle();
      idleTimerRef.current = window.setTimeout(() => {
        // Ledakan berhenti tanpa Enter — ketikan manusia cepat:
        // kembalikan karakter tertelan, lalu mulai bersih.
        replaySwallowed();
        finishBurst();
      }, IDLE_REPLAY_MS);
    }

    function onKey(event: KeyboardEvent) {
      const opts = optionsRef.current;
      if (!opts.enabled) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (opts.isIgnoredTarget?.(target)) return;
      if (target?.closest("textarea, select, [contenteditable='true']")) return;

      const state = stateRef.current;
      const now = performance.now();

      if (event.key === "Enter") {
        const code = burstScanCode(state, now);
        if (code) {
          event.preventDefault();
          event.stopPropagation();
          restoreSnapshot();
          finishBurst();
          opts.onScan(code);
        } else {
          // Enter manusia: field harus utuh lebih dulu (putar ulang
          // karakter tertelan) sebelum Enter diproses elemen tujuan.
          if (state.swallowed) replaySwallowed();
          finishBurst();
        }
        return;
      }

      if (event.key.length !== 1) return;

      if (burstExpired(state, now)) {
        // Jeda panjang sejak karakter terakhir: ledakan lama selesai
        // sebagai ketikan manusia — putar ulang sisanya, mulai baru.
        replaySwallowed();
        resetBurst(state);
        snapshotRef.current = null;
      }

      if (state.buffer.length === 0) {
        snapshotRef.current =
          target instanceof HTMLInputElement ? { el: target, value: target.value } : null;
      }

      const action = feedBurstChar(state, event.key, now);
      if (action === "swallow") {
        event.preventDefault();
        event.stopPropagation();
      }
      scheduleIdleReplay();
    }

    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearIdle();
    };
  }, []);
}
