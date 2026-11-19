import { describe, expect, it } from "vitest";
import {
  MemoryPrintQueueStorage,
  PrintQueue,
  type PrintJobInput,
} from "@/lib/pos/print-queue";

const input = (overrides: Partial<PrintJobInput> = {}): PrintJobInput => ({
  saleId: "sale-1",
  saleNumber: "INV-1",
  companyId: "company-1",
  terminalId: "terminal-1",
  kind: "receipt",
  receiptData: null,
  ...overrides,
});

describe("POS print queue", () => {
  it("membuat job idempoten per sale dan copy", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const first = await queue.enqueue(input({ copyIndex: 0 }));
    const second = await queue.enqueue(input({ copyIndex: 0 }));
    expect(second.id).toBe(first.id);
    expect(await queue.list()).toHaveLength(1);
  });

  it("menghitung copy berikutnya dari job yang sudah ada", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    await queue.enqueue(input({ copyIndex: 0 }));
    expect(await queue.nextCopyIndex("sale-1")).toBe(1);
    expect(await queue.nextCopyIndex("sale-2")).toBe(0);
  });

  it("mengklaim satu job dan menandainya sent", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const job = await queue.enqueue(input());
    const claimed = await queue.claimNext();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("printing");
    await queue.markSent(job.id);
    const latest = await queue.latestForSale("sale-1");
    expect(latest?.status).toBe("sent");
    expect(latest?.attempts).toBe(1);
  });

  it("menandai gagal dan bisa retry", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const job = await queue.enqueue(input());
    await queue.claimNext();
    await queue.markFailed(job.id, "kertas habis");
    let latest = await queue.latestForSale("sale-1");
    expect(latest?.status).toBe("failed");
    expect(latest?.lastError).toBe("kertas habis");
    expect(latest?.attempts).toBe(1);

    await queue.retry(job.id);
    latest = await queue.latestForSale("sale-1");
    expect(latest?.status).toBe("pending");
    expect(latest?.lastError).toBeNull();
  });

  it("menandai hasil job printing yang macet sebagai belum pasti", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const job = await queue.enqueue(input());
    await queue.claimNext();
    await queue.resetStuck(0);
    const latest = await queue.latestForSale("sale-1");
    expect(latest?.id).toBe(job.id);
    expect(latest?.status).toBe("uncertain");
  });

  it("membersihkan riwayat job selesai yang sudah tua", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const job = await queue.enqueue(input());
    await queue.markSent(job.id);
    expect(await queue.cleanup(0)).toBe(1);
    expect(await queue.list()).toHaveLength(0);
  });

  it("tidak mengklaim job yang belum pending", async () => {
    const queue = new PrintQueue(new MemoryPrintQueueStorage());
    const job = await queue.enqueue(input());
    await queue.markSent(job.id);
    expect(await queue.claimNext()).toBeUndefined();
  });
});
