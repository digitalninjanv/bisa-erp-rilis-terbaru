"use client";

export type PosTelemetryDetail = string | number | boolean | null;

/**
 * Event POS dari browser ke log server. Fire-and-forget: kegagalan
 * telemetri tidak boleh mengganggu checkout atau cetak.
 */
export function recordPosTelemetry(
  event: string,
  details: Record<string, PosTelemetryDetail> = {},
): void {
  if (typeof navigator === "undefined") return;
  try {
    const body = JSON.stringify({ event, details });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        "/api/pos/telemetry",
        new Blob([body], { type: "application/json" }),
      );
      return;
    }
    void fetch("/api/pos/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Telemetri tidak boleh memblokir alur kasir.
  }
}
