/** Urutkan pengiriman, termasuk ketika perangkat belum selesai setelah timeout UI. */
let writeChain: Promise<unknown> = Promise.resolve();

export async function withPrinterWriteLock<T>(
  task: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let expired = false;
  const timeoutError = new Error(`Printer tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik.`);
  const write = async () => {
    if (expired) throw timeoutError;
    return task();
  };
  const pending = writeChain.then(async () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("bisa-pos-printer-write", write)
      : write(),
  );
  writeChain = pending.catch(() => undefined);

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        reject(timeoutError);
      }, timeoutMs);
    });
    return await Promise.race([pending, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
