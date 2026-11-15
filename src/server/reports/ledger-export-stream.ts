import { withCompanyReadOnlySnapshot } from "@/db/tenant";
import type { LedgerInput } from "./ledger";
import { ledgerCsvChunks } from "./ledger-csv-generator";

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
): Promise<LedgerCsvExport | null> {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let cancelled = false;
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
      await new Promise<void>((resolve) => {
        demandWaiter = resolve;
      });
    }
    if (cancelled) return false;
    requestedChunks -= 1;
    return true;
  };
  const wakeDemandWaiter = () => {
    demandWaiter?.();
    demandWaiter = null;
  };

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
            if (!cancelled) controller?.close();
          },
          (error: unknown) => {
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
        wakeDemandWaiter();
        return streamTask;
      },
    },
    { highWaterMark: 0 },
  );

  const metadata = await ready;
  return metadata ? { ...metadata, body } : null;
}
