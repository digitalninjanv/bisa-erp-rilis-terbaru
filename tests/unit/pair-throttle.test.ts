import { beforeEach, describe, expect, it } from "vitest";
import {
  PAIR_THROTTLE_MAX_FAILURES,
  PAIR_THROTTLE_WINDOW_MS,
  _clearPairThrottle,
  pairAttemptAllowed,
  pairAttemptSource,
  recordPairFailure,
  resetPairFailures,
} from "@/lib/pair-throttle";

// AUD-015 (Audit Produksi A4): throttle percobaan POST /api/pos/pair.
// Waktu diteruskan eksplisit (parameter `now`) agar perilaku jendela
// teruji deterministik tanpa timer palsu.
const T0 = 1_700_000_000_000;

describe("pair-throttle (AUD-015)", () => {
  beforeEach(() => {
    _clearPairThrottle();
  });

  it("sumber baru selalu diizinkan", () => {
    expect(pairAttemptAllowed("1.2.3.4", T0)).toBe(true);
  });

  it("diblokir tepat sesudah batas kegagalan dalam satu jendela", () => {
    for (let i = 0; i < PAIR_THROTTLE_MAX_FAILURES; i++) {
      expect(pairAttemptAllowed("1.2.3.4", T0 + i)).toBe(true);
      recordPairFailure("1.2.3.4", T0 + i);
    }
    expect(pairAttemptAllowed("1.2.3.4", T0 + PAIR_THROTTLE_MAX_FAILURES)).toBe(false);
  });

  it("sumber lain tidak ikut terblokir", () => {
    for (let i = 0; i < PAIR_THROTTLE_MAX_FAILURES; i++) {
      recordPairFailure("1.2.3.4", T0 + i);
    }
    expect(pairAttemptAllowed("1.2.3.4", T0)).toBe(false);
    expect(pairAttemptAllowed("5.6.7.8", T0)).toBe(true);
  });

  it("jendela berakhir -> percobaan diizinkan lagi dan hitungan mulai dari nol", () => {
    for (let i = 0; i < PAIR_THROTTLE_MAX_FAILURES; i++) {
      recordPairFailure("1.2.3.4", T0 + i);
    }
    const after = T0 + PAIR_THROTTLE_WINDOW_MS + 1;
    expect(pairAttemptAllowed("1.2.3.4", after)).toBe(true);
    recordPairFailure("1.2.3.4", after);
    expect(pairAttemptAllowed("1.2.3.4", after + 1)).toBe(true);
  });

  it("keberhasilan mereset hitungan sumber", () => {
    for (let i = 0; i < PAIR_THROTTLE_MAX_FAILURES - 1; i++) {
      recordPairFailure("1.2.3.4", T0 + i);
    }
    resetPairFailures("1.2.3.4");
    for (let i = 0; i < PAIR_THROTTLE_MAX_FAILURES - 1; i++) {
      recordPairFailure("1.2.3.4", T0 + 100 + i);
    }
    expect(pairAttemptAllowed("1.2.3.4", T0 + 200)).toBe(true);
  });

  it("kunci sumber: X-Forwarded-For pertama, lalu X-Real-IP, lalu 'unknown'", () => {
    const withForwarded = new Request("http://localhost/api/pos/pair", {
      headers: { "x-forwarded-for": " 203.0.113.9 , 10.0.0.1" },
    });
    expect(pairAttemptSource(withForwarded)).toBe("203.0.113.9");
    const withRealIp = new Request("http://localhost/api/pos/pair", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(pairAttemptSource(withRealIp)).toBe("198.51.100.7");
    const bare = new Request("http://localhost/api/pos/pair");
    expect(pairAttemptSource(bare)).toBe("unknown");
  });
});
