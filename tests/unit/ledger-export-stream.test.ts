import { beforeEach, describe, expect, it, vi } from "vitest";

const streamState = vi.hoisted(() => ({
  parts: [] as { accountCode: string; bytes: Uint8Array }[],
  yielded: 0,
  finalized: false,
  transactionFinished: false,
}));

vi.mock("@/db/tenant", () => ({
  withCompanyReadOnlySnapshot: vi.fn(
    async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) => {
      try {
        return await fn({});
      } finally {
        streamState.transactionFinished = true;
      }
    },
  ),
}));

vi.mock("@/server/reports/ledger-csv-generator", () => ({
  ledgerCsvChunks: vi.fn(async function* () {
    try {
      for (const part of streamState.parts) {
        streamState.yielded += 1;
        yield part;
      }
    } finally {
      streamState.finalized = true;
    }
  }),
}));

import { createLedgerCsvExport } from "@/server/reports/ledger-export-stream";

function part(value: string) {
  return { accountCode: "10001", bytes: new TextEncoder().encode(value) };
}

describe("ledger export response stream", () => {
  beforeEach(() => {
    streamState.parts = [part("header\r\n"), part("row\r\n"), part("closing")];
    streamState.yielded = 0;
    streamState.finalized = false;
    streamState.transactionFinished = false;
  });

  it("streams chunks on demand and closes after the final chunk", async () => {
    const result = await createLedgerCsvExport(
      { id: "company-test", name: "Test" },
      { accountId: "account-test", from: "2026-01-01", to: "2026-12-31" },
    );
    expect(result?.accountCode).toBe("10001");
    if (!result) throw new Error("Ekspor buku besar tidak tersedia");

    const reader = result.body.getReader();
    const chunks: string[] = [];
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(new TextDecoder().decode(next.value));
    }

    expect(chunks).toEqual(["header\r\n", "row\r\n", "closing"]);
    expect(streamState.finalized).toBe(true);
  });

  it("returns the database iterator and ends the tenant transaction when cancelled", async () => {
    const result = await createLedgerCsvExport(
      { id: "company-test", name: "Test" },
      { accountId: "account-test", from: "2026-01-01", to: "2026-12-31" },
    );
    expect(result).not.toBeNull();
    if (!result) throw new Error("Ekspor buku besar tidak tersedia");

    const reader = result.body.getReader();
    await reader.read();
    await reader.cancel("client disconnected");

    expect(streamState.finalized).toBe(true);
    expect(streamState.transactionFinished).toBe(true);
  });
});
