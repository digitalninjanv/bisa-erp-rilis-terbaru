"use client";

import { useEffect, useRef } from "react";
import { AlertCircle } from "lucide-react";

export type FormErrorItem = {
  field?: string;
  message: string;
};

export function ErrorSummary({
  title = "Terdapat kesalahan pada formulir",
  errors,
  className = "",
}: {
  title?: string;
  errors: (string | FormErrorItem)[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (errors.length > 0 && containerRef.current) {
      containerRef.current.focus();
      containerRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [errors]);

  if (!errors || errors.length === 0) return null;

  const normalizedErrors: FormErrorItem[] = errors.map((err) =>
    typeof err === "string" ? { message: err } : err,
  );

  function handleJump(targetId?: string) {
    if (!targetId) return;
    const el = document.getElementById(targetId) || document.querySelector(`[name="${targetId}"]`);
    if (el && el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.focus();
    }
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="alert"
      aria-labelledby="error-summary-heading"
      className={`rounded-lg border border-destructive/40 bg-destructive/10 p-4 outline-none focus:ring-2 focus:ring-destructive/30 ${className}`}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="size-4 shrink-0 text-destructive mt-0.5" />
        <div className="min-w-0 flex-1">
          <h3 id="error-summary-heading" className="text-[13px] font-semibold text-destructive">
            {title}
          </h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] text-destructive/90">
            {normalizedErrors.map((item, idx) => (
              <li key={idx}>
                {item.field ? (
                  <button
                    type="button"
                    onClick={() => handleJump(item.field)}
                    className="text-left font-medium underline underline-offset-2 hover:text-destructive focus:outline-none"
                  >
                    {item.message}
                  </button>
                ) : (
                  <span>{item.message}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
