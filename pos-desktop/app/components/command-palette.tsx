"use client";

import { useEffect, useRef, useState } from "react";
import { trapDialogTab } from "./dialog-primitives";

export type CommandAction = {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
};

/** Palette aksi cepat (Ctrl+K) untuk kasir yang bekerja dengan keyboard. */
export function CommandPalette({
  open,
  actions,
  onClose,
}: {
  open: boolean;
  actions: CommandAction[];
  onClose: () => void;
}) {
  return open ? <OpenCommandPalette actions={actions} onClose={onClose} /> : null;
}

function OpenCommandPalette({ actions, onClose }: { actions: CommandAction[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  const filtered = normalized
    ? actions.filter((action) => `${action.label} ${action.hint ?? ""}`.toLocaleLowerCase("id-ID").includes(normalized))
    : actions;

  return (
    <div
      className="command-overlay"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Aksi cepat kasir"
        onKeyDown={(event) => {
          if (event.key === "Escape") { event.preventDefault(); onClose(); }
          trapDialogTab(event);
        }}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari aksi…"
          aria-label="Cari aksi cepat"
        />
        {filtered.length ? (
          <ul className="command-results">
            {filtered.map((action) => (
              <li key={action.id}>
                <button type="button" onClick={() => { action.run(); onClose(); }}>
                  <span>{action.label}</span>
                  {action.hint ? <small>{action.hint}</small> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Tidak ada aksi yang cocok.</p>
        )}
        <p className="command-footnote">Esc untuk menutup · Tab tetap di dalam daftar</p>
      </section>
    </div>
  );
}
