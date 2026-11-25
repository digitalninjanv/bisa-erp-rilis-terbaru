/**
 * Electron's native print callback can outlive the UI timeout. A timeout
 * must report uncertainty without pretending that the native operation
 * was canceled; onNativeComplete is called only when Electron calls back.
 */
function printWithCallbackTimeout(print, timeoutMs, timeoutMessage, onNativeComplete) {
  return new Promise((resolve) => {
    let callbackReceived = false;
    let responseSent = false;
    const timer = setTimeout(() => {
      if (callbackReceived) return;
      responseSent = true;
      resolve({ ok: false, uncertain: true, message: timeoutMessage });
    }, timeoutMs);

    const finish = (success, failureReason) => {
      if (callbackReceived) return;
      callbackReceived = true;
      clearTimeout(timer);
      onNativeComplete();
      if (responseSent) return;

      if (success) {
        responseSent = true;
        resolve({ ok: true });
        return;
      }

      const reason = typeof failureReason === "string" ? failureReason.slice(0, 300) : "";
      responseSent = true;
      resolve({
        ok: false,
        uncertain: true,
        message: reason
          ? "Driver melaporkan kegagalan cetak (" + reason + "). Periksa hasil cetak sebelum mengulang."
          : "Driver melaporkan kegagalan. Periksa hasil cetak sebelum mengulang.",
      });
    };

    try {
      print(finish);
    } catch (error) {
      finish(false, error instanceof Error ? error.message : String(error));
    }
  });
}

module.exports = { printWithCallbackTimeout };
