import { describe, expect, it } from "vitest";
import {
  BURST_PRESETS,
  SCAN_FAST_GAP_MS,
  SCAN_MAX_AVG_MS,
  SCAN_MIN_LENGTH,
  SCAN_RESET_GAP_MS,
  burstExpired,
  burstScanCode,
  createBurstState,
  feedBurstChar,
  resolveBurstThresholds,
} from "@/lib/barcode-burst";

// A-24 T3 (pola G1): generalisasi barcode-burst menjadi utilitas bersama
// berprasel per konteks. Kontrak kerasnya: tanpa argumen tambahan,
// perilaku HARUS identik dengan ambang historis POS (test lama di
// barcode-burst.test.ts tidak disunting dan tetap menjadi kontrak POS).

function feedAll(state: ReturnType<typeof createBurstState>, text: string, startAt: number, gapMs: number) {
  let now = startAt;
  for (const ch of text) {
    feedBurstChar(state, ch, now);
    now += gapMs;
  }
  return now;
}

describe("resolveBurstThresholds", () => {
  it("tanpa argumen = ambang historis POS persis", () => {
    expect(resolveBurstThresholds()).toEqual({
      minLength: SCAN_MIN_LENGTH,
      maxAvgMs: SCAN_MAX_AVG_MS,
      fastGapMs: SCAN_FAST_GAP_MS,
      resetGapMs: SCAN_RESET_GAP_MS,
    });
    expect(resolveBurstThresholds("pos")).toEqual(resolveBurstThresholds());
  });

  it("prasel document menuntut kode lebih panjang dari barcode pendek", () => {
    expect(BURST_PRESETS.document.minLength).toBeGreaterThan(BURST_PRESETS.pos.minLength);
    expect(BURST_PRESETS.document.maxAvgMs).toBe(SCAN_MAX_AVG_MS);
  });

  it("opsi parsial menimpa hanya field yang disebut", () => {
    const resolved = resolveBurstThresholds({ minLength: 9 });
    expect(resolved.minLength).toBe(9);
    expect(resolved.fastGapMs).toBe(SCAN_FAST_GAP_MS);
  });
});

describe("perilaku prasetel pada penilaian pindaian", () => {
  it("ledakan 5 karakter cepat: pindaian untuk POS, bukan untuk dokumen", () => {
    const posState = createBurstState();
    const endPos = feedAll(posState, "12345", 1000, 10);
    expect(burstScanCode(posState, endPos)).toBe("12345");

    const docState = createBurstState();
    const endDoc = feedAll(docState, "12345", 1000, 10);
    expect(burstScanCode(docState, endDoc, "document")).toBeNull();
  });

  it("nomor dokumen cepat dinilai pindaian oleh prasel document", () => {
    const state = createBurstState();
    const end = feedAll(state, "PO-2026-00003", 500, 8);
    expect(burstScanCode(state, end, "document")).toBe("PO-2026-00003");
  });

  it("ketikan manusia lambat tetap bukan pindaian di semua prasel", () => {
    const state = createBurstState();
    const end = feedAll(state, "PO-2026-00003", 500, 200);
    expect(burstScanCode(state, end, "document")).toBeNull();
    expect(burstScanCode(state, end)).toBeNull();
  });

  it("fastGapMs kustom mengubah keputusan swallow", () => {
    const strict = createBurstState();
    feedBurstChar(strict, "8", 0);
    // jeda 30ms: di bawah fastGap bawaan 50 → swallow; di atas fastGap 20 → track.
    expect(feedBurstChar(strict, "9", 30)).toBe("swallow");
    const loose = createBurstState();
    feedBurstChar(loose, "8", 0, { fastGapMs: 20 });
    expect(feedBurstChar(loose, "9", 30, { fastGapMs: 20 })).toBe("track");
  });

  it("burstExpired menghormati resetGapMs kustom", () => {
    const state = createBurstState();
    feedBurstChar(state, "8", 0);
    expect(burstExpired(state, 200)).toBe(true); // bawaan 150ms
    expect(burstExpired(state, 200, { resetGapMs: 500 })).toBe(false);
  });
});
