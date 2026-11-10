import { describe, expect, it } from "vitest";
import {
  burstExpired,
  burstScanCode,
  createBurstState,
  feedBurstChar,
  resetBurst,
  type BurstState,
} from "@/lib/barcode-burst";

/** Ketik `text` mulai pada t0 dengan jeda konstan antar karakter. */
function type(state: BurstState, text: string, t0: number, gapMs: number): number {
  let now = t0;
  for (const char of text) {
    feedBurstChar(state, char, now);
    now += gapMs;
  }
  return now;
}

describe("barcode-burst (POS2-03)", () => {
  it("mengenali ledakan numerik cepat khas scanner EAN", () => {
    const state = createBurstState();
    const enterAt = type(state, "8991234567890", 1_000, 10);
    expect(burstScanCode(state, enterAt)).toBe("8991234567890");
  });

  it("mengenali kode alfanumerik Code 128 / SKU, bukan hanya angka", () => {
    const state = createBurstState();
    const enterAt = type(state, "SKU-AbC-128x", 0, 15);
    expect(burstScanCode(state, enterAt)).toBe("SKU-AbC-128x");
  });

  it("mengenali kode pendek 4 karakter yang dipindai cepat", () => {
    const state = createBurstState();
    const enterAt = type(state, "A1B2", 0, 20);
    expect(burstScanCode(state, enterAt)).toBe("A1B2");
  });

  it("menolak ledakan cepat yang terlalu pendek (3 karakter)", () => {
    const state = createBurstState();
    const enterAt = type(state, "123", 0, 10);
    expect(burstScanCode(state, enterAt)).toBeNull();
  });

  it("tidak menganggap ketikan manusia sebagai pindaian", () => {
    const state = createBurstState();
    // Manusia mengetik ±200 ms per karakter.
    const enterAt = type(state, "8991234567890", 0, 200);
    expect(burstScanCode(state, enterAt)).toBeNull();
  });

  it("menolak ledakan yang rata-ratanya melambat di tengah", () => {
    const state = createBurstState();
    // Dua karakter cepat, sisanya lambat: rata-rata melewati ambang.
    let now = type(state, "89", 0, 10);
    now = type(state, "91234567890", now, 120);
    expect(burstScanCode(state, now)).toBeNull();
  });

  it("karakter pertama track, lanjutan cepat ditelan dan tercatat", () => {
    const state = createBurstState();
    expect(feedBurstChar(state, "8", 0)).toBe("track");
    expect(feedBurstChar(state, "9", 10)).toBe("swallow");
    expect(feedBurstChar(state, "9", 20)).toBe("swallow");
    expect(state.buffer).toBe("899");
    expect(state.swallowed).toBe("99");
  });

  it("karakter lanjutan yang lambat tidak ditelan", () => {
    const state = createBurstState();
    expect(feedBurstChar(state, "a", 0)).toBe("track");
    expect(feedBurstChar(state, "b", 100)).toBe("track");
    expect(state.swallowed).toBe("");
  });

  it("ledakan kedaluwarsa sesudah jeda panjang; reset membersihkan swallowed", () => {
    const state = createBurstState();
    type(state, "899", 0, 10);
    expect(burstExpired(state, 100)).toBe(false);
    expect(burstExpired(state, 500)).toBe(true);
    resetBurst(state);
    expect(state.buffer).toBe("");
    expect(state.swallowed).toBe("");
    expect(burstExpired(state, 10_000)).toBe(false);
  });

  it("burstScanCode tidak mengubah state (pemanggil yang memutuskan)", () => {
    const state = createBurstState();
    const enterAt = type(state, "123456", 0, 10);
    expect(burstScanCode(state, enterAt)).toBe("123456");
    expect(state.buffer).toBe("123456");
  });
});
