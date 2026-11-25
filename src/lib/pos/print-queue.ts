/**
 * Antrean cetak POS web.
 *
 * Job disimpan di IndexedDB agar tidak hilang saat tab ditutup. Satu job
 * hanya boleh ditulis ke printer pada satu waktu; pemanggil bertanggung
 * jawab menyediakan transport (ESC/POS) dan menandai hasilnya.
 */
import type { ReceiptData } from "@/lib/escpos/types";

export type PrintJobKind = "receipt" | "copy" | "offline-receipt";
export type PrintJobStatus = "pending" | "printing" | "sent" | "failed" | "uncertain";

export type PrintJobInput = {
  saleId: string;
  saleNumber: string;
  companyId: string;
  userId?: string;
  terminalId: string;
  kind: PrintJobKind;
  copyIndex?: number;
  /** Token satu-kali untuk cetak pertama tanpa izin cetak ulang historis. */
  printToken?: string | null;
  /** Snapshot nota untuk cetak offline; null/absen = ambil dari server. */
  receiptData?: ReceiptData | null;
};

export type PrintJob = {
  id: string;
  saleId: string;
  saleNumber: string;
  companyId: string;
  /** Absen pada job lama; job lama tidak diklaim oleh aktor baru. */
  userId?: string;
  terminalId: string;
  kind: PrintJobKind;
  copyIndex: number;
  printToken?: string | null;
  receiptData: ReceiptData | null;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
};

export interface PrintQueueStorage {
  add(job: PrintJob): Promise<void>;
  put(job: PrintJob): Promise<void>;
  get(id: string): Promise<PrintJob | undefined>;
  list(): Promise<PrintJob[]>;
  listBySaleId?(saleId: string): Promise<PrintJob[]>;
  listByStatus?(status: PrintJobStatus): Promise<PrintJob[]>;
  listByStatusBefore?(status: PrintJobStatus, createdBefore: string): Promise<PrintJob[]>;
  listByStatusUpdatedBefore?(status: PrintJobStatus, updatedBefore: string): Promise<PrintJob[]>;
  claimNext?(filters: { companyId?: string; userId?: string; terminalId?: string }): Promise<PrintJob | undefined>;
  delete(id: string): Promise<void>;
}

export class MemoryPrintQueueStorage implements PrintQueueStorage {
  private readonly items = new Map<string, PrintJob>();

  async add(job: PrintJob): Promise<void> {
    if (!this.items.has(job.id)) this.items.set(job.id, job);
  }

  async put(job: PrintJob): Promise<void> {
    this.items.set(job.id, job);
  }

  async get(id: string): Promise<PrintJob | undefined> {
    return this.items.get(id);
  }

  async list(): Promise<PrintJob[]> {
    return [...this.items.values()];
  }

  async listBySaleId(saleId: string): Promise<PrintJob[]> {
    return [...this.items.values()].filter((job) => job.saleId === saleId);
  }

  async listByStatus(status: PrintJobStatus): Promise<PrintJob[]> {
    return [...this.items.values()].filter((job) => job.status === status);
  }

  async listByStatusBefore(status: PrintJobStatus, createdBefore: string): Promise<PrintJob[]> {
    return [...this.items.values()].filter(
      (job) => job.status === status && job.createdAt <= createdBefore,
    );
  }

  async listByStatusUpdatedBefore(status: PrintJobStatus, updatedBefore: string): Promise<PrintJob[]> {
    return [...this.items.values()].filter(
      (job) => job.status === status && job.updatedAt <= updatedBefore,
    );
  }

  async claimNext(filters: { companyId?: string; userId?: string; terminalId?: string }): Promise<PrintJob | undefined> {
    const next = [...this.items.values()]
      .filter(
        (job) =>
          job.status === "pending" &&
          (filters.companyId === undefined || job.companyId === filters.companyId) &&
          (filters.userId === undefined || job.userId === filters.userId) &&
          (filters.terminalId === undefined || job.terminalId === filters.terminalId),
      )
      .sort(byCreatedAt)[0];
    if (!next) return undefined;
    const claimed = { ...next, status: "printing" as const, attempts: next.attempts + 1, updatedAt: now() };
    this.items.set(claimed.id, claimed);
    return claimed;
  }

  async delete(id: string): Promise<void> {
    this.items.delete(id);
  }
}

const DB_NAME = "bisa-pos-print";
const STORE_NAME = "jobs";
const DB_VERSION = 2;

export class IndexedDbPrintQueueStorage implements PrintQueueStorage {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB tidak tersedia di browser ini."));
    }
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(STORE_NAME)
          ? request.transaction!.objectStore(STORE_NAME)
          : db.createObjectStore(STORE_NAME, { keyPath: "id" });
        if (!store.indexNames.contains("status")) store.createIndex("status", "status");
        if (!store.indexNames.contains("saleId")) store.createIndex("saleId", "saleId");
        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt");
        if (!store.indexNames.contains("statusCreatedAt")) {
          store.createIndex("statusCreatedAt", ["status", "createdAt"]);
        }
        if (!store.indexNames.contains("statusUpdatedAt")) {
          store.createIndex("statusUpdatedAt", ["status", "updatedAt"]);
        }
        if (!store.indexNames.contains("companyTerminalStatusCreatedAt")) {
          store.createIndex("companyTerminalStatusCreatedAt", [
            "companyId",
            "terminalId",
            "status",
            "createdAt",
          ]);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Gagal membuka IndexedDB cetak."));
    });
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = fn(transaction.objectStore(STORE_NAME));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Operasi IndexedDB cetak gagal."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () =>
        reject(transaction.error ?? request.error ?? new Error("Transaksi IndexedDB cetak dibatalkan."));
      transaction.onerror = () =>
        reject(transaction.error ?? request.error ?? new Error("Transaksi IndexedDB cetak gagal."));
    });
  }

  async add(job: PrintJob): Promise<void> {
    await this.run("readwrite", (store) => store.add(job));
  }

  async put(job: PrintJob): Promise<void> {
    await this.run("readwrite", (store) => store.put(job));
  }

  async get(id: string): Promise<PrintJob | undefined> {
    return this.run("readonly", (store) => store.get(id));
  }

  async list(): Promise<PrintJob[]> {
    return this.run("readonly", (store) => store.getAll());
  }

  async listBySaleId(saleId: string): Promise<PrintJob[]> {
    return this.run("readonly", (store) => store.index("saleId").getAll(IDBKeyRange.only(saleId)));
  }

  async listByStatus(status: PrintJobStatus): Promise<PrintJob[]> {
    return this.run("readonly", (store) => store.index("status").getAll(IDBKeyRange.only(status)));
  }

  async listByStatusBefore(status: PrintJobStatus, createdBefore: string): Promise<PrintJob[]> {
    return this.run("readonly", (store) =>
      store.index("statusCreatedAt").getAll(
        IDBKeyRange.bound([status, ""], [status, createdBefore]),
      ),
    );
  }

  async listByStatusUpdatedBefore(status: PrintJobStatus, updatedBefore: string): Promise<PrintJob[]> {
    return this.run("readonly", (store) =>
      store.index("statusUpdatedAt").getAll(
        IDBKeyRange.bound([status, ""], [status, updatedBefore]),
      ),
    );
  }

  /** Claim the oldest eligible pending job atomically across tabs/windows. */
  async claimNext(
    filters: { companyId?: string; userId?: string; terminalId?: string },
  ): Promise<PrintJob | undefined> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const scoped = filters.companyId !== undefined && filters.terminalId !== undefined;
      const index = store.index(scoped ? "companyTerminalStatusCreatedAt" : "statusCreatedAt");
      const lower = scoped
        ? [filters.companyId!, filters.terminalId!, "pending", ""]
        : ["pending", ""];
      const upper = scoped
        ? [filters.companyId!, filters.terminalId!, "pending", "\uffff"]
        : ["pending", "\uffff"];
      const request = index.openCursor(IDBKeyRange.bound(lower, upper), "next");
      let claimed: PrintJob | undefined;
      let failed = false;
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const job = cursor.value as PrintJob;
        if (
          (filters.companyId === undefined || job.companyId === filters.companyId) &&
          (filters.userId === undefined || job.userId === filters.userId) &&
          (filters.terminalId === undefined || job.terminalId === filters.terminalId)
        ) {
          claimed = { ...job, status: "printing", attempts: job.attempts + 1, updatedAt: now() };
          cursor.update(claimed);
          return;
        }
        cursor.continue();
      };
      request.onerror = () => {
        failed = true;
        reject(request.error ?? new Error("Gagal mencari job cetak pending."));
      };
      transaction.oncomplete = () => {
        if (!failed) resolve(claimed);
      };
      transaction.onabort = () => {
        if (!failed) reject(transaction.error ?? new Error("Claim job cetak dibatalkan."));
      };
      transaction.onerror = () => {
        if (!failed) reject(transaction.error ?? new Error("Claim job cetak gagal."));
      };
    });
  }

  async delete(id: string): Promise<void> {
    await this.run("readwrite", (store) => store.delete(id));
  }
}

const now = () => new Date().toISOString();

function byCreatedAt(a: PrintJob, b: PrintJob): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export class PrintQueue {
  constructor(private readonly storage: PrintQueueStorage) {}

  async enqueue(input: PrintJobInput): Promise<PrintJob> {
    const copyIndex = input.copyIndex ?? (await this.nextCopyIndex(input.saleId));
    const id = `${input.saleId}:${copyIndex}`;
    const existing = await this.storage.get(id);
    if (existing) return existing;

    const timestamp = now();
    const job: PrintJob = {
      id,
      saleId: input.saleId,
      saleNumber: input.saleNumber,
      companyId: input.companyId,
      userId: input.userId,
      terminalId: input.terminalId,
      kind: input.kind,
      copyIndex,
      printToken: input.printToken ?? null,
      receiptData: input.receiptData ?? null,
      status: "pending",
      attempts: 0,
      lastError: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      sentAt: null,
    };
    await this.storage.add(job);
    return job;
  }

  async list(): Promise<PrintJob[]> {
    return (await this.storage.list()).sort(byCreatedAt);
  }

  async nextCopyIndex(saleId: string): Promise<number> {
    const jobs = this.storage.listBySaleId
      ? await this.storage.listBySaleId(saleId)
      : (await this.storage.list()).filter((job) => job.saleId === saleId);
    return jobs.reduce((max, job) => Math.max(max, job.copyIndex + 1), 0);
  }

  async latestForSale(saleId: string): Promise<PrintJob | undefined> {
    const jobs = this.storage.listBySaleId
      ? await this.storage.listBySaleId(saleId)
      : (await this.storage.list()).filter((job) => job.saleId === saleId);
    return jobs
      .sort((a, b) => b.copyIndex - a.copyIndex || b.createdAt.localeCompare(a.createdAt))[0];
  }

  async claimNext(
    companyId?: string,
    userId?: string,
    terminalId?: string,
  ): Promise<PrintJob | undefined> {
    if (this.storage.claimNext) return this.storage.claimNext({ companyId, userId, terminalId });
    const next = (await this.storage.list())
      .filter(
        (job) =>
          job.status === "pending" &&
          (companyId === undefined || job.companyId === companyId) &&
          (userId === undefined || job.userId === userId) &&
          (terminalId === undefined || job.terminalId === terminalId),
      )
      .sort(byCreatedAt)[0];
    if (!next) return undefined;
    const claimed: PrintJob = {
      ...next,
      status: "printing",
      attempts: next.attempts + 1,
      updatedAt: now(),
    };
    await this.storage.put(claimed);
    return claimed;
  }

  async markSent(id: string): Promise<void> {
    const job = await this.storage.get(id);
    if (!job) return;
    await this.storage.put({
      ...job,
      status: "sent",
      sentAt: now(),
      updatedAt: now(),
      lastError: null,
    });
  }

  async markFailed(id: string, message: string): Promise<void> {
    const job = await this.storage.get(id);
    if (!job) return;
    await this.storage.put({
      ...job,
      status: "failed",
      lastError: message,
      updatedAt: now(),
    });
  }

  async markUncertain(id: string, message: string): Promise<void> {
    const job = await this.storage.get(id);
    if (!job) return;
    await this.storage.put({
      ...job,
      status: "uncertain",
      lastError: message,
      updatedAt: now(),
    });
  }

  async retry(id: string): Promise<void> {
    const job = await this.storage.get(id);
    if (!job) return;
    await this.storage.put({
      ...job,
      status: "pending",
      lastError: null,
      updatedAt: now(),
    });
  }

  async resetStuck(olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    let reset = 0;
    const candidates = this.storage.listByStatusUpdatedBefore
      ? await this.storage.listByStatusUpdatedBefore("printing", new Date(cutoff).toISOString())
      : this.storage.listByStatus
        ? await this.storage.listByStatus("printing")
        : await this.storage.list();
    for (const job of candidates) {
      await this.storage.put({
        ...job,
        status: "uncertain",
        lastError: "Pengiriman sebelumnya terhenti. Periksa struk sebelum mengirim ulang.",
        updatedAt: now(),
      });
      reset += 1;
    }
    return reset;
  }

  async remove(id: string): Promise<void> {
    await this.storage.delete(id);
  }

  /** Buang riwayat job selesai agar IndexedDB tidak tumbuh tanpa batas. */
  async cleanup(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;
    const cutoffISO = new Date(cutoff).toISOString();
    const terminalJobs = await Promise.all(
      (["sent", "failed", "uncertain"] as const).map((status) =>
        this.storage.listByStatusBefore
          ? this.storage.listByStatusBefore(status, cutoffISO)
          : this.storage.listByStatus
            ? this.storage.listByStatus(status)
            : this.storage.list(),
      ),
    );
    const seen = new Set<string>();
    for (const job of terminalJobs.flat()) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      await this.storage.delete(job.id);
      removed += 1;
    }
    return removed;
  }
}

export const PRINT_QUEUE_EVENT = "bisa-pos-print-queue";

let browserQueue: PrintQueue | null = null;

export function getBrowserPrintQueue(): PrintQueue {
  if (typeof window === "undefined") throw new Error("Antrean cetak hanya tersedia di browser.");
  if (!browserQueue) browserQueue = new PrintQueue(new IndexedDbPrintQueueStorage());
  return browserQueue;
}

export function notifyPrintQueueChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(PRINT_QUEUE_EVENT));
}

export async function enqueuePrintJob(input: PrintJobInput): Promise<PrintJob> {
  const job = await getBrowserPrintQueue().enqueue(input);
  notifyPrintQueueChanged();
  return job;
}

export async function retryPrintJob(saleId: string): Promise<PrintJob | undefined> {
  const queue = getBrowserPrintQueue();
  const latest = await queue.latestForSale(saleId);
  if (latest && (latest.status === "failed" || latest.status === "uncertain")) {
    await queue.retry(latest.id);
    notifyPrintQueueChanged();
    return queue.latestForSale(saleId);
  }
  return latest;
}

export async function latestPrintJob(saleId: string): Promise<PrintJob | undefined> {
  return getBrowserPrintQueue().latestForSale(saleId);
}

export type PrintHandlerResult = { ok: boolean; message?: string; uncertain?: boolean };

let draining = false;
let lastCleanup = 0;

/**
 * Proses antrean sampai kosong. Pemanggil harus membungkusnya dengan
 * `navigator.locks` (jika tersedia) agar dua tab tidak menulis bersamaan.
 */
export async function drainPrintQueue(
  handler: (job: PrintJob) => Promise<PrintHandlerResult>,
  companyId?: string,
  userId?: string,
  terminalId?: string,
): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const queue = getBrowserPrintQueue();
    if (await queue.resetStuck(2 * 60 * 1000)) notifyPrintQueueChanged();
    if (Date.now() - lastCleanup >= 60 * 60 * 1000) {
      await queue.cleanup();
      lastCleanup = Date.now();
    }
    for (let index = 0; index < 25; index += 1) {
      const job = await queue.claimNext(companyId, userId, terminalId);
      if (!job) break;
      try {
        const result = await handler(job);
        if (result.ok) await queue.markSent(job.id);
        else if (result.uncertain) await queue.markUncertain(job.id, result.message ?? "Hasil cetak tidak dapat dipastikan.");
        else await queue.markFailed(job.id, result.message ?? "Gagal mencetak.");
      } catch (error) {
        await queue.markFailed(job.id, error instanceof Error ? error.message : "Gagal mencetak.");
      }
      notifyPrintQueueChanged();
    }
  } finally {
    draining = false;
  }
}
