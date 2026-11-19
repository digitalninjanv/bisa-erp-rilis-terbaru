/** Satu writer printer per proses; dipakai ESC/POS web. */
let writeChain: Promise<void> = Promise.resolve();

export async function withPrinterWriteLock<T>(
  task: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  let release!: () => void;
  const previous = writeChain;
  writeChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous.catch(() => {});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Printer tidak merespons dalam ${Math.round(timeoutMs / 1000)} detik.`)),
        timeoutMs,
      );
    });
    return await Promise.race([task(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    release();
  }
}
