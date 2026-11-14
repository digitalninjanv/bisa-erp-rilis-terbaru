import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBrowserOfflineStorage,
  IndexedDbOfflineStorage,
  type QueuedSale,
} from "@/lib/pos-offline";

function fixture() {
  const request = {
    result: "key-1",
    error: null,
    onsuccess: null as IDBRequest<unknown>["onsuccess"],
    onerror: null as IDBRequest<unknown>["onerror"],
  } as IDBRequest<unknown>;
  const store = { add: () => request } as unknown as IDBObjectStore;
  const transactionState = {
    error: null as DOMException | null,
    objectStore: () => store,
    oncomplete: null as IDBTransaction["oncomplete"],
    onabort: null as IDBTransaction["onabort"],
    onerror: null as IDBTransaction["onerror"],
  };
  const transaction = transactionState as unknown as IDBTransaction;
  const database = { transaction: () => transaction } as unknown as IDBDatabase;
  const openRequest = {
    result: database,
    error: null,
    onsuccess: null as IDBOpenDBRequest["onsuccess"],
    onerror: null as IDBOpenDBRequest["onerror"],
    onupgradeneeded: null as IDBOpenDBRequest["onupgradeneeded"],
  } as IDBOpenDBRequest;
  vi.stubGlobal("indexedDB", { open: () => openRequest } as unknown as IDBFactory);
  return { request, transaction, transactionState, openRequest };
}

const sale: QueuedSale = {
  clientKey: "key-1",
  warehouseId: "warehouse-1",
  date: "2026-11-14",
  lines: [],
  payments: [],
  queuedAt: "2026-11-14T00:00:00.000Z",
};

afterEach(() => vi.unstubAllGlobals());

describe("IndexedDB offline queue commit handling", () => {
  it("fails closed in a browser without IndexedDB instead of using volatile memory", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("indexedDB", undefined);

    expect(() => getBrowserOfflineStorage()).toThrow(/IndexedDB/);
  });

  it("does not resolve a write on request success before transaction commit", async () => {
    const { request, transaction, openRequest } = fixture();
    const operation = new IndexedDbOfflineStorage().add(sale);
    openRequest.onsuccess?.call(openRequest, new Event("success"));
    await Promise.resolve();

    let settled = false;
    void operation.then(() => {
      settled = true;
    });
    request.onsuccess?.call(request, new Event("success"));
    await Promise.resolve();
    expect(settled).toBe(false);

    transaction.oncomplete?.call(transaction, new Event("complete"));
    await operation;
    expect(settled).toBe(true);
  });

  it("rejects a write if the transaction aborts after request success", async () => {
    const { request, transaction, transactionState, openRequest } = fixture();
    const operation = new IndexedDbOfflineStorage().add(sale);
    openRequest.onsuccess?.call(openRequest, new Event("success"));
    await Promise.resolve();
    request.onsuccess?.call(request, new Event("success"));
    transactionState.error = new DOMException("Quota exceeded", "QuotaExceededError");
    transaction.onabort?.call(transaction, new Event("abort"));

    await expect(operation).rejects.toThrow("Quota exceeded");
  });
});
