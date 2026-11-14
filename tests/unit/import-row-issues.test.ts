import { describe, expect, it } from "vitest";
import { chunkPendingImportRowIssues } from "@/server/import-row-issues";

describe("chunkPendingImportRowIssues", () => {
  it("filters non-pending rows and keeps every pending row in bounded batches", () => {
    const rows = Array.from({ length: 1_202 }, (_, index) => ({
      id: `row-${index}`,
      status: index % 3 === 0 ? "committed" : "pending",
      issue: index % 2 === 0 ? "invalid" : null,
    }));

    const batches = chunkPendingImportRowIssues(rows);
    const actual = batches.flat();
    const expected = rows.filter((row) => row.status === "pending");

    expect(batches.map((batch) => batch.length)).toEqual([500, 301]);
    expect(actual).toEqual(expected);
    expect(actual.every((row) => row.status === "pending")).toBe(true);
  });

  it("returns no batches when there are no pending rows", () => {
    expect(chunkPendingImportRowIssues([{ id: "done", status: "committed", issue: null }])).toEqual([]);
  });
});
