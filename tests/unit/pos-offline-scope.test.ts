import { describe, expect, it } from "vitest";
import {
  MemoryOfflineStorage,
  ScopedOfflineStorage,
  type QueuedSale,
} from "@/lib/pos-offline";

function sale(overrides: Partial<QueuedSale>): QueuedSale {
  return {
    clientKey: "key-1",
    companyId: "company-a",
    warehouseId: "w1",
    date: "2026-11-18",
    lines: [],
    payments: [],
    queuedAt: "2026-11-18T10:00:00.000Z",
    cashierId: "user-a",
    deviceId: "terminal-a",
    ...overrides,
  };
}

describe("scoped offline queue", () => {
  it("hanya menampilkan antrean perusahaan dan kasir yang cocok", async () => {
    const base = new MemoryOfflineStorage();
    await base.add(sale({ clientKey: "a" }));
    await base.add(sale({ clientKey: "b", companyId: "company-b" }));
    await base.add(sale({ clientKey: "c", cashierId: "user-b" }));

    const scoped = new ScopedOfflineStorage(base, {
      companyId: "company-a",
      userId: "user-a",
      terminalId: "terminal-a",
    });
    expect((await scoped.list()).map((row) => row.clientKey)).toEqual(["a"]);
  });

  it("menolak menulis item milik tenant lain", async () => {
    const base = new MemoryOfflineStorage();
    const scoped = new ScopedOfflineStorage(base, {
      companyId: "company-a",
      userId: "user-a",
    });
    await expect(scoped.add(sale({ companyId: "company-b" }))).rejects.toThrow(/bukan milik/);
  });

  it("mempertahankan item warisan tanpa companyId bila kasirnya cocok", async () => {
    const base = new MemoryOfflineStorage();
    await base.add(sale({ clientKey: "legacy", companyId: undefined }));
    const scoped = new ScopedOfflineStorage(base, {
      companyId: "company-a",
      userId: "user-a",
    });
    expect((await scoped.list()).map((row) => row.clientKey)).toEqual(["legacy"]);
  });
});
