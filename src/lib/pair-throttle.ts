/**
 * AUD-015 (Audit Produksi A4): throttle percobaan penukaran kode
 * pasangan POS desktop (POST /api/pos/pair).
 *
 * Kode pasangan sendiri sudah kuat (10 karakter acak, TTL 15 menit,
 * sekali pakai — lihat register AUD-015); throttle ini pengerasan
 * tambahan agar percobaan daring massal dari satu sumber melambat
 * sampai berhenti. Hanya percobaan GAGAL yang dihitung; keberhasilan
 * mereset jendela sumber itu. Sumber yang sedang ter-throttle menerima
 * respons 401 yang PERSIS sama dengan kode tidak berlaku — tidak ada
 * sinyal tambahan bagi penyerang.
 *
 * Keadaan disimpan in-memory per instance proses (batasan yang sama
 * dengan rate limit Better Auth di aplikasi ini): pada deployment
 * multi-instance batas berlaku per instance, bukan global.
 */

import { resolveClientIp, trustedProxiesFromEnv } from "./client-ip";

export const PAIR_THROTTLE_WINDOW_MS = 10 * 60 * 1000;
export const PAIR_THROTTLE_MAX_FAILURES = 20;

type Entry = { windowStart: number; failures: number };

const entries = new Map<string, Entry>();

function liveEntry(source: string, now: number): Entry | undefined {
  const entry = entries.get(source);
  if (!entry) return undefined;
  if (now - entry.windowStart >= PAIR_THROTTLE_WINDOW_MS) {
    entries.delete(source);
    return undefined;
  }
  return entry;
}

/** true = percobaan boleh diproses; false = sumber sedang ter-throttle. */
export function pairAttemptAllowed(source: string, now = Date.now()): boolean {
  const entry = liveEntry(source, now);
  return !entry || entry.failures < PAIR_THROTTLE_MAX_FAILURES;
}

export function recordPairFailure(source: string, now = Date.now()): void {
  const entry = liveEntry(source, now);
  if (entry) {
    entry.failures += 1;
    return;
  }
  // Jaga peta tetap terbatas pada sumber aktif berjendela.
  if (entries.size >= 10_000) {
    for (const [key, value] of entries) {
      if (now - value.windowStart >= PAIR_THROTTLE_WINDOW_MS) entries.delete(key);
    }
  }
  entries.set(source, { windowStart: now, failures: 1 });
}

export function resetPairFailures(source: string): void {
  entries.delete(source);
}

/** Hanya untuk test: kosongkan seluruh keadaan throttle. */
export function _clearPairThrottle(): void {
  entries.clear();
}

/**
 * Kunci sumber dari header permintaan (SEC-012): hanya header dari
 * proksi tepercaya yang dipakai; rantai multi-hop tanpa daftar proksi
 * tidak ditebak. Bila tidak ada IP yang dapat dipercaya, semua
 * panggilan berbagi ember "unknown" (fail closed).
 */
export function pairAttemptSource(
  request: Request,
  trustedProxies: string[] = trustedProxiesFromEnv(),
): string {
  return resolveClientIp(request.headers, trustedProxies) ?? "unknown";
}
