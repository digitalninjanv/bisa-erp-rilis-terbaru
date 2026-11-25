/**
 * Antrean cetak serial FIFO dengan penjaga duplikasi per saleId.
 *
 * - Transaksi berbeda (key berbeda) antre berurutan tanpa saling memblokir
 *   dengan dialog uncertain.
 * - Transaksi yang sama (key sama) yang masih aktif atau belum memberi kepastian
 *   ditolak kecuali retryConfirmed = true.
 */
function createPrintScheduler() {
  const inFlightKeys = new Set();
  let tail = Promise.resolve();

  function enqueue(key, retryConfirmed, execute) {
    const jobKey = key || "__test__";
    if (inFlightKeys.has(jobKey) && !retryConfirmed) {
      return Promise.resolve({
        ok: false,
        uncertain: true,
        message: "Cetakan struk ini masih diproses. Periksa printer sebelum mengirim ulang.",
      });
    }

    inFlightKeys.add(jobKey);
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      inFlightKeys.delete(jobKey);
    };

    const run = tail.then(async () => {
      try {
        return await execute(release);
      } catch (error) {
        release();
        throw error;
      }
    });
    tail = run.catch(() => {});
    return run;
  }

  return {
    enqueue,
    inFlightCount: () => inFlightKeys.size,
  };
}

module.exports = { createPrintScheduler };
