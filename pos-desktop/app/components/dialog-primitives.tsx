"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";

export function LoadingSkeleton({ label }: { label: string }) {
  return (
    <p className="loading-skeleton" role="status" aria-live="polite">
      <span className="skeleton-bar" aria-hidden="true" />
      {label}
    </p>
  );
}

export function trapDialogTab(event: {
  key: string;
  shiftKey: boolean;
  currentTarget: HTMLElement;
  preventDefault: () => void;
}) {
  if (event.key !== "Tab") return;
  const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (!focusable.length) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

export type CashierTool = "session" | "customer" | "terminal" | "updates" | "sync" | "printer" | "display" | "report" | "kitchen";

export function ToolScreen({
  open,
  title,
  description,
  onBack,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  onBack: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  if (!open) return null;

  return (
    <div className="tool-screen-overlay">
      <section className="tool-screen" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapDialogTab}>
        <header className="tool-screen-header">
          <button className="tool-screen-back" type="button" onClick={onBack} autoFocus>
            <ArrowLeft aria-hidden="true" />
            <span>Kembali ke kasir</span>
          </button>
          <div className="tool-screen-heading">
            <span className="eyebrow">FITUR KASIR</span>
            <h1 id={titleId}>{title}</h1>
            <p>{description}</p>
          </div>
        </header>
        <div className="tool-screen-content">{children}</div>
      </section>
    </div>
  );
}

/** Mengembalikan fokus ke elemen pemicu saat dialog ditutup. */
export function useDialogFocusRestore(open: boolean): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    triggerRef.current = null;
    window.requestAnimationFrame(() => {
      if (document.contains(trigger)) trigger.focus();
    });
  }, [open]);
}
