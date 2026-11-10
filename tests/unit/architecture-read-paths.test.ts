import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FIX-ARS Tahap 6 (ARS1-01) — ratchet jalur baca halaman.
 *
 * Aturan (AGENTS.md §"Jalur baca halaman"): halaman di src/app/app hanya
 * boleh (a) memanggil fungsi baca modul server, atau (b) mengueri inline
 * MAKSIMAL satu tabel tanpa join/agregasi untuk kebutuhan tampilan murni.
 * Test ini menggagalkan suite bila halaman melanggar:
 *  - pola join (innerJoin/leftJoin/rightJoin/fullJoin/crossJoin),
 *  - pola agregasi pada konteks kueri (groupBy, count(, sum(, avg() —
 *    juga menangkap subkueri sql`... count(*) ...` di dalam select halaman,
 *  - SQL mentah lewat .execute( di halaman,
 *  - lebih dari satu tabel distinct pada .from(...) dalam satu halaman.
 *
 * Pengecualian yang sah dicatat EKSPLISIT di EXCEPTIONS dengan alasan;
 * entri yang berkasnya sudah tidak ada menggagalkan test (anti basi).
 * Batas kata (\b) pada count/sum/avg mencegah positif-palsu dari kata
 * seperti "discount(" — pola hanya cocok bila berdiri sebagai pemanggilan.
 */
const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "app", "app");

const EXCEPTIONS: Record<string, string> = {
  // "relatif/ke/src/app/app/page.tsx": "alasan tertulis mengapa inline di sini sah",
};

function listPageFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listPageFiles(full));
    else if (entry.name === "page.tsx") found.push(full);
  }
  return found;
}

const JOIN_PATTERN = /\.(innerJoin|leftJoin|rightJoin|fullJoin|crossJoin)\s*\(/;
const AGGREGATE_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "groupBy", pattern: /\.groupBy\s*\(/ },
  { label: "count(", pattern: /\bcount\s*\(/ },
  { label: "sum(", pattern: /\bsum\s*\(/ },
  { label: "avg(", pattern: /\bavg\s*\(/ },
];
const EXECUTE_PATTERN = /\.execute\s*\(/;

function inlineTables(source: string): Set<string> {
  // Array.from(...) bukan kueri — keluarkan sebelum memindai .from(...).
  const cleaned = source.replaceAll("Array.from(", "Array.____(");
  const tables = new Set<string>();
  for (const match of cleaned.matchAll(/\.from\(\s*([A-Za-z_$][\w$]*)/g)) {
    tables.add(match[1]);
  }
  return tables;
}

describe("arsitektur: jalur baca halaman (ARS1-01)", () => {
  const files = listPageFiles(APP_DIR);
  const relative = (file: string) => path.relative(APP_DIR, file);

  it("menemukan halaman untuk dipindai", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("tidak ada join/agregasi/SQL mentah di halaman", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel in EXCEPTIONS) continue;
      const source = readFileSync(file, "utf8");
      if (JOIN_PATTERN.test(source)) violations.push(`${rel}: join`);
      for (const { label, pattern } of AGGREGATE_PATTERNS) {
        if (pattern.test(source)) violations.push(`${rel}: agregasi ${label}`);
      }
      if (EXECUTE_PATTERN.test(source)) violations.push(`${rel}: .execute( (SQL mentah)`);
    }
    expect(violations).toEqual([]);
  });

  it("halaman mengueri inline maksimal satu tabel", () => {
    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel in EXCEPTIONS) continue;
      const tables = inlineTables(readFileSync(file, "utf8"));
      if (tables.size > 1) {
        violations.push(`${rel}: ${tables.size} tabel (${[...tables].join(", ")})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("daftar pengecualian tidak basi", () => {
    for (const rel of Object.keys(EXCEPTIONS)) {
      expect(existsSync(path.join(APP_DIR, rel)), `pengecualian basi: ${rel}`).toBe(true);
    }
  });
});
