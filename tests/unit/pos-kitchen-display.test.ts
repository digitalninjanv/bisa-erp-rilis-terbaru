import { describe, expect, it } from "vitest";
import { buildKitchenTickets, kitchenTicketAgeLabel } from "../../src/lib/pos/kitchen-display";

describe("kitchen display", () => {
  it("membangun tiket dari penjualan, membuang baris kosong, dan mengurut FIFO", () => {
    const tickets = buildKitchenTickets([
      {
        id: "s2", number: "SALE-2", createdAt: "2026-11-18T02:00:00.000Z",
        lines: [{ productName: "Kopi", qty: "2", unitCode: "Cup" }],
      },
      {
        id: "s1", number: "SALE-1", createdAt: "2026-11-18T01:00:00.000Z",
        lines: [
          { productName: "Teh", qty: "1", unitCode: "Gelas" },
          { productName: "Batal", qty: "0", unitCode: "Pcs" },
        ],
      },
      { id: "s3", number: "SALE-3", createdAt: "2026-11-18T03:00:00.000Z", lines: [] },
    ]);
    expect(tickets.map((t) => t.number)).toEqual(["SALE-1", "SALE-2"]);
    expect(tickets[0].lines).toHaveLength(1);
    expect(tickets[0].lines[0]).toMatchObject({ productName: "Teh", qty: 1, unitCode: "Gelas" });
  });

  it("menampilkan usia tiket dengan benar", () => {
    const now = new Date("2026-11-18T02:10:00.000Z");
    expect(kitchenTicketAgeLabel("2026-11-18T02:00:00.000Z", now)).toBe("10 menit lalu");
    expect(kitchenTicketAgeLabel("2026-11-18T00:00:00.000Z", now)).toBe("2 jam 10 menit lalu");
    expect(kitchenTicketAgeLabel("tidak-valid", now)).toBe("waktu tidak diketahui");
  });
});
