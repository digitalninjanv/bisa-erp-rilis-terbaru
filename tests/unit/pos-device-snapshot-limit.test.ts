import { describe, expect, it } from "vitest";
import {
  assertPosDeviceSnapshotComplete,
  POS_DEVICE_SNAPSHOT_MAX_PRODUCTS,
} from "@/lib/pos/snapshot-limit";

describe("POS native full-snapshot limit", () => {
  it("allows complete catalogs at and below the limit", () => {
    expect(() => assertPosDeviceSnapshotComplete(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS, false)).not.toThrow();
    expect(() => assertPosDeviceSnapshotComplete(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS - 1, true)).not.toThrow();
  });

  it("rejects a partial full snapshot when one more product exists", () => {
    expect(() => assertPosDeviceSnapshotComplete(POS_DEVICE_SNAPSHOT_MAX_PRODUCTS, true)).toThrow(
      /Snapshot penuh tidak dibuat/,
    );
  });
});
