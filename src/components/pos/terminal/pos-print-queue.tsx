"use client";

import { useEffect, useRef } from "react";
import { getSaleReceiptDataAction } from "@/server/actions/pos-receipt";
import { formatReceiptToEscPos } from "@/lib/escpos/receipt-template";
import { getPrinterPreferences, sendEscPosToPrinter } from "@/lib/escpos/printer-connection";
import { recordPosTelemetry } from "@/lib/pos/telemetry";
import {
  drainPrintQueue,
  PRINT_QUEUE_EVENT,
  type PrintHandlerResult,
  type PrintJob,
} from "@/lib/pos/print-queue";

function isDirectPrinter() {
  const type = getPrinterPreferences().type;
  return type === "bluetooth" || type === "usb" || type === "serial";
}

async function handleJob(job: PrintJob): Promise<PrintHandlerResult> {
  const prefs = getPrinterPreferences();
  if (prefs.type !== "bluetooth" && prefs.type !== "usb" && prefs.type !== "serial") {
    return { ok: false, message: "Printer thermal belum terhubung." };
  }

  let receipt = job.receiptData;
  if (!receipt) {
    const result = await getSaleReceiptDataAction(job.saleId);
    if (!result.ok) {
      recordPosTelemetry("print.fail", { saleId: job.saleId, reason: "receipt_fetch" });
      return { ok: false, message: result.message };
    }
    receipt = result.data;
  }

  const bytes = formatReceiptToEscPos({
    ...receipt,
    paperWidth: prefs.paperWidth,
    openCashDrawer: prefs.openCashDrawer,
    cutPaper: prefs.cutPaper,
    copyIndex: job.copyIndex,
  });
  const sent = await sendEscPosToPrinter(bytes);
  recordPosTelemetry(sent.ok ? "print.sent" : "print.fail", {
    saleId: job.saleId,
    kind: job.kind,
    copyIndex: job.copyIndex,
    reason: sent.ok ? null : (sent.message ?? "unknown"),
  });
  return { ok: sent.ok, message: sent.message };
}

/**
 * Worker tunggal antrean cetak. Dipasang sekali di terminal POS; job
 * tetap tersimpan bila tab ditutup dan dilanjutkan saat terminal dibuka.
 */
export function PosPrintQueue() {
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      if (cancelled || running.current || !isDirectPrinter()) return;
      running.current = true;
      try {
        const drain = () => drainPrintQueue(handleJob);
        if (typeof navigator !== "undefined" && navigator.locks) {
          await navigator.locks.request("bisa-pos-print", drain);
        } else {
          await drain();
        }
      } finally {
        running.current = false;
      }
    }

    void run();
    const interval = window.setInterval(() => void run(), 2_000);
    const onOnline = () => void run();
    const onQueue = () => void run();
    const onError = (event: ErrorEvent) => {
      recordPosTelemetry("client.error", { message: event.message.slice(0, 240) });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
      recordPosTelemetry("client.unhandledrejection", { message: reason.slice(0, 240) });
    };
    window.addEventListener("online", onOnline);
    window.addEventListener(PRINT_QUEUE_EVENT, onQueue);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", onOnline);
      window.removeEventListener(PRINT_QUEUE_EVENT, onQueue);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
