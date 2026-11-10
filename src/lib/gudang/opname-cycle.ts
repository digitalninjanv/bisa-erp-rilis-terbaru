/**
 * A-24 T3 (pola G3): pengingat siklus opname berkonfigurasi.
 *
 * Penjadwalan siklus otomatis ala Odoo DITURUNKAN menjadi pengingat:
 * perusahaan mengonfigurasi frekuensi hitung (hari) per gudang dan/atau
 * per kategori di `company_settings.opname_cycle` (jsonb, null = tanpa
 * pengingat). Dashboard Gudang menampilkan kartu "jatuh tempo" dari
 * konfigurasi itu + tanggal hitung terakhir — tidak ada mesin jadwal
 * yang membuat dokumen sendiri.
 *
 * Modul murni ini sumber kebenaran tunggal untuk bentuk konfigurasi,
 * sanitasinya, dan hitungan jatuh temponya (semua tanggal ISO
 * yyyy-mm-dd, dihitung dalam hari kalender UTC agar bebas zona waktu).
 */

export type OpnameCycleConfig = {
  /** Frekuensi hitung (hari) per id gudang. */
  warehouseDays: Record<string, number>;
  /** Frekuensi hitung (hari) per id kategori produk. */
  categoryDays: Record<string, number>;
};

export const EMPTY_OPNAME_CYCLE: OpnameCycleConfig = {
  warehouseDays: {},
  categoryDays: {},
};

export const MAX_OPNAME_CYCLE_DAYS = 3660;

function sanitizeDayMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
    const days = Math.floor(raw);
    if (days < 1 || days > MAX_OPNAME_CYCLE_DAYS) continue;
    if (key.trim()) result[key] = days;
  }
  return result;
}

/** Sanitasi nilai jsonb tersimpan; bentuk rusak → konfigurasi kosong
 *  (pengingat mati), tidak pernah melempar. */
export function sanitizeOpnameCycleConfig(value: unknown): OpnameCycleConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...EMPTY_OPNAME_CYCLE };
  }
  const raw = value as Record<string, unknown>;
  return {
    warehouseDays: sanitizeDayMap(raw.warehouseDays),
    categoryDays: sanitizeDayMap(raw.categoryDays),
  };
}

const DAY_MS = 86_400_000;

function dayNumber(isoDate: string): number {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export type OpnameDueStatus = {
  /** Tanggal hitung berikutnya seharusnya (null bila belum pernah). */
  dueDate: string | null;
  /** Sudah melewati tanggal seharusnya per `today`. */
  due: boolean;
  /** Hari keterlambatan (0 bila belum jatuh tempo / belum pernah). */
  daysOverdue: number;
};

/**
 * Status jatuh tempo satu cakupan: hitung terakhir + frekuensi.
 * Belum pernah dihitung sama sekali = jatuh tempo segera (dueDate
 * null menandakan "belum pernah", bukan tanggal).
 */
export function opnameDueStatus(input: {
  lastCountDate: string | null;
  frequencyDays: number;
  today: string;
}): OpnameDueStatus {
  if (!input.lastCountDate) return { dueDate: null, due: true, daysOverdue: 0 };
  const dueDay = dayNumber(input.lastCountDate) + input.frequencyDays;
  const todayDay = dayNumber(input.today);
  return {
    dueDate: isoOf(dueDay),
    due: todayDay >= dueDay,
    daysOverdue: Math.max(0, todayDay - dueDay),
  };
}
