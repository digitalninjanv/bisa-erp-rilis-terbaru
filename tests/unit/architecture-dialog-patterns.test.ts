import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G1 (FRM-01/FRM-02, Program Perbaikan Gabungan) — dialog satu pintu.
 *
 * Dua penjaga permanen:
 *  1. TIDAK ADA dialog peramban (`window.prompt` / `window.confirm` /
 *     `window.alert`) yang DIPANGGIL di mana pun di src/ — alasan &
 *     konfirmasi selalu lewat ConfirmDialog bersama
 *     (src/components/blocks/confirm-dialog.tsx, prop `reason`).
 *     Penyebutan di komentar didokumentasikan, bukan pelanggaran:
 *     komentar dibuang sebelum pemindaian.
 *  2. Overlay `fixed inset-0` racikan tangan DILARANG di komponen —
 *     form dialog memakai Modal bersama, konfirmasi memakai
 *     ConfirmDialog. Yang boleh hanya komponen bersama itu sendiri,
 *     primitif ui/, overlay shell (bukan form), dan permukaan POS
 *     terminal yang kekhususannya terdokumentasi per berkas di
 *     EXCEPTIONS. Entri pengecualian yang berkasnya sudah tidak
 *     memuat pola ini menggagalkan test (anti basi).
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

const OVERLAY_EXCEPTIONS: Record<string, string> = {
  "components/blocks/modal.tsx": "Modal bersama itu sendiri — satu-satunya overlay form yang sah.",
  "components/blocks/confirm-dialog.tsx": "ConfirmDialog bersama itu sendiri — lapisan konfirmasi di atas Modal.",
  "components/ui/dialog.tsx": "Primitif shadcn/Base UI; bukan overlay form per fitur.",
  "components/ui/alert-dialog.tsx": "Primitif shadcn/Base UI; bukan overlay form per fitur.",
  "components/ui/sheet.tsx": "Primitif shadcn/Base UI (laci); bukan overlay form per fitur.",
  "components/shell/command-palette.tsx": "Overlay shell (palet perintah), bukan form per fitur.",
  "components/shell/mobile-nav.tsx": "Laci navigasi shell, bukan form per fitur.",
  "components/pos/pos-terminal.tsx":
    "Pengambilalihan layar penuh terminal POS (bukan dialog) — alur offline kasir; migrasi membahayakan alur itu.",
  "components/pos/terminal-dialogs.tsx":
    "Dialog permukaan terminal POS z-[70] di bawah lapisan kasir; kekhususan tercatat di docs/form-crud/HASIL-G1.md.",
  "components/pos/sale-row-actions.tsx":
    "Lembar aksi baris penjualan di dalam terminal POS; kekhususan tercatat di docs/form-crud/HASIL-G1.md.",
};

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(SRC_DIR, file).split(path.sep).join("/");

/** Buang komentar blok & baris agar penyebutan di dokumentasi tidak dihitung sebagai pemanggilan. */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      // "//" sesudah ":" adalah bagian URL di dalam string, bukan komentar.
      if (idx > 0 && line[idx - 1] === ":") return line;
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

const BROWSER_DIALOG_PATTERN = /\bwindow\.(?:prompt|confirm|alert)\s*\(/;
const OVERLAY_PATTERN = /fixed inset-0/;

describe("G1 dialog satu pintu", () => {
  const files = listSourceFiles(SRC_DIR);

  it("tidak ada pemanggilan window.prompt/confirm/alert di src/", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (BROWSER_DIALOG_PATTERN.test(code)) offenders.push(relative(file));
    }
    expect(offenders).toEqual([]);
  });

  it("overlay fixed inset-0 hanya di lapisan bersama & pengecualian terdokumentasi", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (!readFileSync(file, "utf8").includes("fixed inset-0")) continue;
      if (!(rel in OVERLAY_EXCEPTIONS)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("pengecualian overlay tidak basi", () => {
    for (const rel of Object.keys(OVERLAY_EXCEPTIONS)) {
      const full = path.join(SRC_DIR, rel);
      expect(existsSync(full), `${rel} (pengecualian) harus ada`).toBe(true);
      expect(
        OVERLAY_PATTERN.test(readFileSync(full, "utf8")),
        `${rel} (pengecualian) harus masih memuat fixed inset-0`,
      ).toBe(true);
    }
  });
});
