import { describe, expect, it } from "vitest";
import { parseOfflineReviewCursor } from "@/server/pos-offline";

describe("offline review keyset cursor", () => {
  it("preserves PostgreSQL timestamp precision exactly", () => {
    const timestamp = "2099-01-01T00:00:00.123456Z";
    const cursor = parseOfflineReviewCursor(
      timestamp + "~0194d5f0-0000-7000-8000-000000000001",
    );

    expect(cursor?.createdAt).toBe(timestamp);
  });

  it("ignores malformed cursors and oversized values", () => {
    expect(parseOfflineReviewCursor("not-a-cursor")).toBeNull();
    expect(parseOfflineReviewCursor("2099-01-01T00:00:00Z~bad")).toBeNull();
    expect(parseOfflineReviewCursor("a".repeat(129))).toBeNull();
  });
});
