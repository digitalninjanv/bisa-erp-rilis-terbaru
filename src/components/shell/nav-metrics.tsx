"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { recordPosTelemetry } from "@/lib/pos/telemetry";

/**
 * Ukur click/pointer → pathname untuk navigasi POS. Ini hanya
 * instrumentasi: tidak mengubah navigasi, cache, atau render.
 */
export function NavMetrics({ moduleKey }: { moduleKey: string }) {
  const pathname = usePathname();
  const startRef = useRef<number | null>(null);
  const previousPathRef = useRef(pathname);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      const href = anchor?.getAttribute("href");
      if (!href || !href.startsWith("/app/pos")) return;
      startRef.current = performance.now();
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    const from = previousPathRef.current;
    const started = startRef.current;
    previousPathRef.current = pathname;
    if (!started || from === pathname) return;
    const durationMs = Math.round(performance.now() - started);
    startRef.current = null;
    if (durationMs > 10_000) return;
    recordPosTelemetry("nav.transition", {
      module: moduleKey,
      from,
      to: pathname,
      durationMs,
    });
  }, [moduleKey, pathname]);

  return null;
}
