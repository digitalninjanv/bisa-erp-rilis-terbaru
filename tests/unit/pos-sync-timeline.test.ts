import { describe, expect, it } from "vitest";
import { orderPosSyncEvents, type PosSyncEvent } from "@/lib/pos/sync-timeline";

describe("urutan sinkronisasi POS Desktop", () => {
  it("memproses shift, penjualan, mutasi kas, lalu penutupan sesuai waktu lokal", () => {
    const events: PosSyncEvent<string>[] = [
      { kind: "close", occurredAt: "2026-11-17T10:00:00.000Z", order: 4, value: "close" },
      { kind: "sale", occurredAt: "2026-11-17T09:20:00.000Z", order: 3, value: "sale-2" },
      { kind: "movement", occurredAt: "2026-11-17T09:10:00.000Z", order: 2, value: "deposit" },
      { kind: "open", occurredAt: "2026-11-17T09:00:00.000Z", order: 0, value: "open" },
      { kind: "sale", occurredAt: "2026-11-17T09:05:00.000Z", order: 1, value: "sale-1" },
    ];

    expect(orderPosSyncEvents(events).map((event) => event.value)).toEqual([
      "open",
      "sale-1",
      "deposit",
      "sale-2",
      "close",
    ]);
    expect(events[0].value).toBe("close");
  });

  it("menempatkan pembukaan sebelum aktivitas dan penutupan sesudahnya pada waktu yang sama", () => {
    const events: PosSyncEvent<string>[] = [
      { kind: "close", occurredAt: "invalid", order: 0, value: "close" },
      { kind: "sale", occurredAt: "invalid", order: 1, value: "sale" },
      { kind: "movement", occurredAt: "invalid", order: 2, value: "movement" },
      { kind: "open", occurredAt: "invalid", order: 3, value: "open" },
    ];

    expect(orderPosSyncEvents(events).map((event) => event.value)).toEqual([
      "open",
      "movement",
      "sale",
      "close",
    ]);
  });
});
