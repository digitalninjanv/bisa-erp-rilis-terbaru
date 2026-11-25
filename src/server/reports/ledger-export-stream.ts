import { withCompanyReadOnlySnapshot } from "@/db/tenant";
import type { LedgerInput } from "./ledger";
import { ledgerCsvChunks } from "./ledger-csv-generator";
import { AppError } from "@/lib/errors";

const IDLE_DEMAND_TIMEOUT_MS = 60_000;
const configuredExportLimit = Number(process.env.BISA_LEDGER_EXPORT_LIMIT ?? 4);
const MAX_CONCURRENT_LEDGER_EXPORTS = Number.isFinite(configuredExportLimit)
  ? Math.min(Math.max(Math.trunc(configuredExportLimit), 1), 16)
  : 4;
let activeLedgerExports = 0;

export type LedgerCsvExport = {
  accountCode: string;
  body: ReadableStream<Uint8Array>;
};

/**
 * Stream a ledger CSV directly from a PostgreSQL cursor. The database cursor
 * and repeatable-read tenant transaction stay open until the client consumes
 * or cancels the response; Node retains only one fetched page and one output
 * chunk at a time.
 */
export async function createLedgerCsvExport(
  company: { id: string; name: string },
  input: Omit<LedgerInput, "companyId" | "accountId"> & { accountId: string | null },
  options?: { signal?: AbortSignal },
): Promise<LedgerCsvExport | null> {
  if (activeLedgerExports >= MAX_CONCURRENT_LEDGER_EXPORTS) {
    throw new AppError(
      "CONFLICT",
      "Terlalu banyak ekspor buku besar berjalan. Tunggu salah satu selesai lalu coba lagi.",
    );
  }
  activeLedgerExports += 1;
  let released = false;
  let removeAbortListener: (() => void) | null = null;
  const release = () => {
    if (released) return;
    released = true;
    removeAbortListener?.();
    removeAbortListener = null;
    activeLedgerExports = Math.max(0, activeLedgerExports - 1);
  };
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = options?.signal?.aborted ?? false;
  let requestedChunks = 0;
  let demandWaiter: (() => void) | null = null;
  let readySettled = false;
  let resolveReady!: (value: { accountCode: string } | null) => void;
  let rejectReady!: (error: unknown) => void;
  let streamTask: Promise<void> | undefined;

  const ready = new Promise<{ accountCode: string } | null>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const settleReady = (value: { accountCode: string } | null) => {
    if (readySettled) return;
    readySettled = true;
    resolveReady(value);
  };
  const failReady = (error: unknown) => {
    if (readySettled) return;
    readySettled = true;
    rejectReady(error);
  };
  const waitForDemand = async (): Promise<boolean> => {
    while (requestedChunks === 0 && !cancelled) {
      const demand = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => resolve(false), IDLE_DEMAND_TIMEOUT_MS);
        demandWaiter = () => {
          clearTimeout(timeout);
          resolve(true);
        };
      });
      demandWaiter = null;
      if (!demand) {
        cancelled = true;
        controller?.error(new Error("Ekspor buku besar dihentikan karena klien tidak meminta data."));
        return false;
      }
    }
    if (cancelled) return false;
    requestedChunks -= 1;
    return true;
  };
  const wakeDemandWaiter = () => {
    demandWaiter?.();
    demandWaiter = null;
  };
  if (options?.signal) {
    const onAbort = () => {
      cancelled = true;
      release();
      wakeDemandWaiter();
    };
    if (options.signal.aborted) {
      onAbort();
    } else {
      options.signal.addEventListener("abort", onAbort, { once: true });
      removeAbortListener = () => options.signal?.removeEventListener("abort", onAbort);
    }
  }

  const body = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController;
        streamTask = withCompanyReadOnlySnapshot(company.id, async (tx) => {
          const iterator = ledgerCsvChunks(tx, company, input);
          let iteratorFinished = false;
          try {
            let next = await iterator.next();
            if (next.done) {
              settleReady(null);
              return;
            }

            settleReady({ accountCode: next.value.accountCode });
            while (!cancelled) {
              if (!(await waitForDemand())) break;
              controller?.enqueue(next.value.bytes);
              next = await iterator.next();
              if (next.done) {
                iteratorFinished = true;
                break;
              }
            }
          } finally {
            if (!iteratorFinished) await iterator.return(undefined);
          }
        }).then(
          () => {
            release();
            if (!cancelled) controller?.close();
          },
          (error: unknown) => {
            release();
            failReady(error);
            if (!cancelled) controller?.error(error);
          },
        );
      },
      pull() {
        requestedChunks = 1;
        wakeDemandWaiter();
      },
      cancel() {
        cancelled = true;
        release();
        wakeDemandWaiter();
        return streamTask;
      },
    },
    { highWaterMark: 0 },
  );

  const metadata = await ready;
  return metadata ? { ...metadata, body } : null;
}
