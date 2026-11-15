import { describe, expect, it } from "vitest";
import {
  MemoryOfflineStorage,
  applySyncResults,
  countQueued,
  enqueueOfflineSale,
  getOfflineQueueSummary,
  type OfflineSalePayload,
} from "@/lib/pos-offline";

/**
 * SIM-2 S7B-2 Batch 6 — logika antrean offline POS sebagai unit murni
 * (adapter memori). Adapter IndexedDB adalah bungkus tipis di atas
 * antarmuka yang sama dan diuji lewat acceptance manual di browser.
 */

function payload(clientKey: string): OfflineSalePayload {
  return {
    clientKey,
    warehouseId: "01900000-0000-7000-8000-0000000000aa",
    date: "2026-05-02",
    lines: [{ productId: "01900000-0000-7000-8000-0000000000bb", qty: 1 }],
    payments: [{ methodId: "01900000-0000-7000-8000-0000000000cc", amount: 15000, tendered: 15000 }],
    queuedAt: "2026-05-02T03:00:00.000Z",
  };
}

class CountingOfflineStorage extends MemoryOfflineStorage {
  getCalls = 0;
  listCalls = 0;

  override async get(clientKey: string) {
    this.getCalls += 1;
    return super.get(clientKey);
  }

  override async list() {
    this.listCalls += 1;
    return super.list();
  }
}

describe("Antrean offline POS (unit)", () => {
  it("enqueue menyimpan dan menolak duplikat clientKey", async () => {
    const storage = new MemoryOfflineStorage();
    const first = await enqueueOfflineSale(storage, payload("key-1"));
    expect(first.duplicate).toBe(false);
    const second = await enqueueOfflineSale(storage, payload("key-1"));
    expect(second.duplicate).toBe(true);
    expect(await countQueued(storage)).toBe(1);
  });

  it("hasil synced & duplicate dikeluarkan dari antrean", async () => {
    const storage = new MemoryOfflineStorage();
    await enqueueOfflineSale(storage, payload("key-1"));
    await enqueueOfflineSale(storage, payload("key-2"));
    const outcome = await applySyncResults(storage, [
      { clientKey: "key-1", status: "synced", saleId: "s1", saleNumber: "POS-1" },
      { clientKey: "key-2", status: "duplicate", saleId: "s1", saleNumber: "POS-1" },
    ]);
    expect(outcome.removed).toEqual(["key-1", "key-2"]);
    expect(await countQueued(storage)).toBe(0);
  });

  it("hasil conflict & failed tetap antre dengan pesan terakhir", async () => {
    const storage = new MemoryOfflineStorage();
    await enqueueOfflineSale(storage, payload("key-3"));
    await enqueueOfflineSale(storage, payload("key-4"));
    const outcome = await applySyncResults(storage, [
      { clientKey: "key-3", status: "conflict", message: "Stok tidak cukup" },
      { clientKey: "key-4", status: "failed", message: "Sesi kas belum dibuka" },
    ]);
    expect(outcome.kept).toEqual(["key-3", "key-4"]);
    const items = await storage.list();
    expect(items).toHaveLength(2);
    expect(items[0].lastStatus).toBe("conflict");
    expect(items[0].lastMessage).toBe("Stok tidak cukup");
    expect(items[1].lastStatus).toBe("failed");
  });

  it("memproses backlog konflik lewat lookup kunci tanpa membaca seluruh daftar berulang", async () => {
    const storage = new CountingOfflineStorage();
    const results = Array.from({ length: 1000 }, (_, index) => {
      const clientKey = `bulk-${index}`;
      return { clientKey, status: "conflict" as const, message: "Perlu ditinjau" };
    });
    for (const result of results) {
      await storage.put(payload(result.clientKey));
    }

    const outcome = await applySyncResults(storage, results);

    expect(outcome.kept).toHaveLength(1000);
    expect(storage.getCalls).toBe(1000);
    expect(storage.listCalls).toBe(0);
    const updated = await storage.list();
    expect(updated).toHaveLength(1000);
    expect(updated.every((item) => item.lastStatus === "conflict")).toBe(true);
  });

  it("urutan antrean mengikuti waktu antre (FIFO)", async () => {
    const storage = new MemoryOfflineStorage();
    const later = { ...payload("key-b"), queuedAt: "2026-05-02T04:00:00.000Z" };
    const earlier = { ...payload("key-a"), queuedAt: "2026-05-02T02:00:00.000Z" };
    await enqueueOfflineSale(storage, later);
    await enqueueOfflineSale(storage, earlier);
    const items = await storage.list();
    expect(items.map((item) => item.clientKey)).toEqual(["key-a", "key-b"]);
  });

  it("ringkasan backlog menunjukkan jumlah dan waktu antre tertua", async () => {
    const storage = new MemoryOfflineStorage();
    const later = { ...payload("key-b"), queuedAt: "2026-05-02T04:00:00.000Z" };
    const earlier = { ...payload("key-a"), queuedAt: "2026-05-02T02:00:00.000Z" };

    await enqueueOfflineSale(storage, later);
    await enqueueOfflineSale(storage, earlier);

    await expect(getOfflineQueueSummary(storage)).resolves.toEqual({
      count: 2,
      oldestQueuedAt: "2026-05-02T02:00:00.000Z",
    });
    await applySyncResults(storage, [
      { clientKey: "key-a", status: "synced", saleId: "s1", saleNumber: "POS-1" },
    ]);
    await expect(getOfflineQueueSummary(storage)).resolves.toEqual({
      count: 1,
      oldestQueuedAt: "2026-05-02T04:00:00.000Z",
    });
  });

  it("ringkasan antre kosong tanpa waktu tertua", async () => {
    await expect(getOfflineQueueSummary(new MemoryOfflineStorage())).resolves.toEqual({
      count: 0,
      oldestQueuedAt: null,
    });
  });
});
