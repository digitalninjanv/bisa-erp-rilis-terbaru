import { describe, expect, it } from "vitest";
import { withPrinterWriteLock } from "@/lib/escpos/printer-write-lock";

describe("printer write lock", () => {
  it("menjalankan penulisan secara berurutan", async () => {
    const order: string[] = [];
    const first = withPrinterWriteLock(async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
    });
    const second = withPrinterWriteLock(async () => {
      order.push("b-start");
      order.push("b-end");
    });
    await Promise.all([first, second]);
    expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("melepas lock setelah tugas gagal", async () => {
    await expect(
      withPrinterWriteLock(async () => {
        throw new Error("gagal");
      }),
    ).rejects.toThrow("gagal");
    await expect(withPrinterWriteLock(async () => "ok")).resolves.toBe("ok");
  });

  it("menunggu pengiriman yang sudah dimulai meski UI mengalami timeout", async () => {
    let finish!: () => void;
    const first = withPrinterWriteLock(() => new Promise<void>((resolve) => {
      finish = resolve;
    }), 5);
    await expect(first).rejects.toThrow(/tidak merespons/);

    const second = withPrinterWriteLock(async () => "ok");
    let finished = false;
    void second.then(() => { finished = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(finished).toBe(false);
    finish();
    await expect(second).resolves.toBe("ok");
  });

  it("menolak tugas yang melewati timeout", async () => {
    await expect(
      withPrinterWriteLock(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
        5,
      ),
    ).rejects.toThrow(/tidak merespons/);
  });
});
