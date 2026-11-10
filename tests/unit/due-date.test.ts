import { describe, expect, it } from "vitest";
import {
  AGING_BUCKET_LABELS,
  addDaysISO,
  ageBucketIndex,
  ageBucketLabel,
  ageDays,
  dueDateStatus,
  paymentStatusLabel,
} from "@/lib/due-date";

// FIX-P1 Tahap 5 (AK5-05 + AK3-07): penanda jatuh tempo & label status
// pembayaran Bahasa Indonesia — logika murni agar teruji tanpa DB.
describe("addDaysISO", () => {
  it("menambah hari dalam bulan yang sama", () => {
    expect(addDaysISO("2026-11-04", 7)).toBe("2026-11-11");
  });

  it("melintasi batas bulan dan tahun", () => {
    expect(addDaysISO("2026-01-15", 30)).toBe("2026-02-14");
    expect(addDaysISO("2026-12-31", 7)).toBe("2027-01-07");
  });

  it("menangani tahun kabisat", () => {
    expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysISO("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("dueDateStatus", () => {
  it("lewat jatuh tempo → overdue dengan jumlah hari", () => {
    expect(dueDateStatus("2026-11-01", "2026-11-04")).toEqual({ kind: "overdue", days: 3 });
  });

  it("hari yang sama → today", () => {
    expect(dueDateStatus("2026-11-04", "2026-11-04")).toEqual({ kind: "today", days: 0 });
  });

  it("belum tiba → upcoming dengan sisa hari", () => {
    expect(dueDateStatus("2026-11-09", "2026-11-04")).toEqual({ kind: "upcoming", days: 5 });
  });

  it("tanpa tanggal tempo atau tanggal tidak valid → null", () => {
    expect(dueDateStatus(null, "2026-11-04")).toBeNull();
    expect(dueDateStatus(undefined, "2026-11-04")).toBeNull();
    expect(dueDateStatus("bukan-tanggal", "2026-11-04")).toBeNull();
  });
});

// A-26 Q1b (D-01): umur & kelompok aging terpusat — sebelumnya batas
// 30/60/90 ditulis dua kali (halaman piutang-utang & ekspor aging).
describe("ageDays", () => {
  const today = "2026-11-15";

  it("dokumen hari ini berumur 0", () => {
    expect(ageDays("2026-11-15", today)).toBe(0);
  });

  it("menghitung selisih hari kalender persis", () => {
    expect(ageDays("2026-11-14", today)).toBe(1);
    expect(ageDays("2026-11-01", today)).toBe(14);
    expect(ageDays("2025-12-31", "2026-01-30")).toBe(30);
  });

  it("tepat pada batas bucket 30/60/90 hari", () => {
    expect(ageDays("2026-10-16", today)).toBe(30);
    expect(ageDays("2026-10-15", today)).toBe(31);
    expect(ageDays("2026-09-16", today)).toBe(60);
    expect(ageDays("2026-09-15", today)).toBe(61);
    expect(ageDays("2026-08-17", today)).toBe(90);
    expect(ageDays("2026-08-16", today)).toBe(91);
  });

  it("dokumen bertanggal masa depan berumur 0 (tidak pernah negatif)", () => {
    expect(ageDays("2026-11-20", today)).toBe(0);
    expect(ageDays("2027-01-01", today)).toBe(0);
  });

  it("string tanggal-waktu dipotong ke tanggalnya (perilaku kedua sisi lama)", () => {
    expect(ageDays("2026-11-01T23:59:00", today)).toBe(14);
  });

  it("identik dengan KEDUA mekanik lama pada sapuan 0–120 hari + masa depan", () => {
    // Ekspor lama: urai UTC + Math.round. Halaman lama: urai +07:00 +
    // Math.floor. Keduanya selalu sepakat karena kedua operan adalah
    // tanggal-saja pada offset yang sama (selisih = kelipatan persis
    // satu hari) — sapuan ini mengunci kesepakatan itu selamanya.
    const oldRoute = (date: string, t: string) =>
      Math.max(
        0,
        Math.round(
          (new Date(`${t}T00:00:00Z`).getTime() - new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime()) /
            86_400_000,
        ),
      );
    const oldPage = (date: string, t: string) =>
      Math.max(
        0,
        Math.floor(
          (new Date(`${t}T00:00:00+07:00`).getTime() -
            new Date(`${date.slice(0, 10)}T00:00:00+07:00`).getTime()) /
            86_400_000,
        ),
      );
    for (let offset = -10; offset <= 120; offset++) {
      const date = addDaysISO(today, -offset);
      expect(ageDays(date, today)).toBe(oldRoute(date, today));
      expect(ageDays(date, today)).toBe(oldPage(date, today));
    }
  });
});

describe("ageBucketIndex & ageBucketLabel", () => {
  it("label kanonis keempat kelompok", () => {
    expect(AGING_BUCKET_LABELS).toEqual(["0–30 hari", "31–60 hari", "61–90 hari", "> 90 hari"]);
  });

  it.each([
    [0, 0, "0–30 hari"],
    [30, 0, "0–30 hari"],
    [31, 1, "31–60 hari"],
    [60, 1, "31–60 hari"],
    [61, 2, "61–90 hari"],
    [90, 2, "61–90 hari"],
    [91, 3, "> 90 hari"],
    [400, 3, "> 90 hari"],
  ] as const)("umur %i hari → indeks %i (%s)", (days, index, label) => {
    expect(ageBucketIndex(days)).toBe(index);
    expect(ageBucketLabel(days)).toBe(label);
  });
});

describe("paymentStatusLabel", () => {
  it.each([
    ["unpaid", "Belum dibayar"],
    ["partial", "Sebagian"],
    ["paid", "Lunas"],
  ] as const)("memetakan %s → %s", (status, label) => {
    expect(paymentStatusLabel(status)).toBe(label);
  });

  it("status tak dikenal dikembalikan apa adanya", () => {
    expect(paymentStatusLabel("weird")).toBe("weird");
  });
});
