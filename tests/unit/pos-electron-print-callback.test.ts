import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";

// The helper is CommonJS so it can be used by Electron's preload/main process.
const loadCjs = createRequire(import.meta.url);
const { printWithCallbackTimeout } = loadCjs("../../pos-electron/print-callback.cjs") as {
  printWithCallbackTimeout: (
    print: (callback: (success: boolean, failureReason?: string) => void) => void,
    timeoutMs: number,
    timeoutMessage: string,
    onNativeComplete: () => void,
  ) => Promise<{ ok: boolean; uncertain?: boolean; message?: string }>;
};

afterEach(() => vi.useRealTimers());

describe("Electron native print callback lifecycle", () => {
  it("reports uncertainty on timeout but retains the native operation until its late callback", async () => {
    vi.useFakeTimers();
    let callback: ((success: boolean, failureReason?: string) => void) | undefined;
    let completed = 0;
    const result = printWithCallbackTimeout(
      (done) => {
        callback = done;
      },
      1_000,
      "timeout",
      () => {
        completed += 1;
      },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(result).resolves.toEqual({ ok: false, uncertain: true, message: "timeout" });
    expect(completed).toBe(0);

    callback?.(true);
    expect(completed).toBe(1);
  });

  it("reports Electron's failure reason and completes only once", async () => {
    let callback: ((success: boolean, failureReason?: string) => void) | undefined;
    let completed = 0;
    const result = printWithCallbackTimeout(
      (done) => {
        callback = done;
      },
      1_000,
      "timeout",
      () => {
        completed += 1;
      },
    );

    callback?.(false, "Invalid printer settings");
    callback?.(true);

    await expect(result).resolves.toMatchObject({
      ok: false,
      uncertain: true,
      message: expect.stringContaining("Invalid printer settings"),
    });
    expect(completed).toBe(1);
  });
});
