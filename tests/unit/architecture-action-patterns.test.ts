import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * G4 (CRUD-01/CRUD-02, Program Perbaikan Gabungan) — idiom aksi satu ejaan.
 *
 * Dua penjaga permanen:
 *  1. CRUD-01: validasi input aksi SELALU lewat `parseInput`
 *     (@/lib/action-validation) — tidak ada `.parse(` mentah yang tersisa
 *     di src/server/actions/**. Kedua idiom memang menghasilkan pesan
 *     yang identik (formatZodIssues yang sama di errors.ts), jadi ini
 *     penjaga ejaan, bukan perilaku: ejaan tidak boleh mundur.
 *     Komentar dibuang sebelum pemindaian. Pengecualian per berkas
 *     harus bernama + beralasan di PARSE_EXCEPTIONS, dan entri yang
 *     berkasnya sudah tidak memuat `.parse(` menggagalkan test
 *     (anti basi, pola G1).
 *  2. CRUD-02: setiap aksi HR menjangkau halaman tempat datanya tampil
 *     lewat revalidatePath server. Helper bersama `revalidateHrPaths`
 *     (hr/shared.ts) mencakup hub HR, payroll & beranda akuntansi;
 *     halaman sub-HR (lembur, cuti, absensi, persetujuan) direvalidasi
 *     per aksi di berkas pemiliknya. Test ini memeriksa rentang tiap
 *     fungsi ekspor: jalur yang diharapkan harus hadir di dalam
 *     rentang fungsi itu.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");
const ACTIONS_DIR = path.join(SRC_DIR, "server", "actions");

const PARSE_EXCEPTIONS: Record<string, string> = {};

function listSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listSourceFiles(full));
    else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) found.push(full);
  }
  return found;
}

const relative = (file: string) => path.relative(ACTIONS_DIR, file).split(path.sep).join("/");

/** Buang komentar blok & baris agar penyebutan di dokumentasi tidak dihitung sebagai pemanggilan. */
function stripComments(source: string): string {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx > 0 && line[idx - 1] === ":") return line;
      return idx >= 0 ? line.slice(0, idx) : line;
    })
    .join("\n");
}

const RAW_PARSE_PATTERN = /\.parse\s*\(/;

/** Rentang sumber per fungsi ekspor: nama -> potongan kode fungsinya. */
function functionSpans(source: string): Map<string, string> {
  const spans = new Map<string, string>();
  const matches = [...source.matchAll(/export async function (\w+)/g)];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : source.length;
    spans.set(matches[i][1], source.slice(start, end));
  }
  return spans;
}

describe("G4 idiom validasi aksi (CRUD-01)", () => {
  const files = listSourceFiles(ACTIONS_DIR);

  it("tidak ada .parse( mentah di src/server/actions — semua lewat parseInput", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel in PARSE_EXCEPTIONS) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (RAW_PARSE_PATTERN.test(code)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it("pengecualian .parse( tidak basi", () => {
    for (const rel of Object.keys(PARSE_EXCEPTIONS)) {
      const full = path.join(ACTIONS_DIR, rel);
      expect(existsSync(full), `${rel} (pengecualian) harus ada`).toBe(true);
      expect(
        RAW_PARSE_PATTERN.test(stripComments(readFileSync(full, "utf8"))),
        `${rel} (pengecualian) harus masih memuat .parse(`,
      ).toBe(true);
    }
  });
});

describe("G4 revalidasi server HR (CRUD-02)", () => {
  const read = (rel: string) => readFileSync(path.join(ACTIONS_DIR, rel), "utf8");

  it("helper bersama mencakup hub HR, payroll & beranda akuntansi", () => {
    const shared = read("hr/shared.ts");
    for (const p of ["/app/akuntansi/hr", "/app/akuntansi/payroll", "/app/akuntansi"]) {
      expect(shared).toContain(`revalidatePath("${p}")`);
    }
  });

  it("organisasi: setiap aksi memanggil helper bersama (hub HR tercakup)", () => {
    const spans = functionSpans(read("hr/organisasi.ts"));
    expect(spans.size).toBe(8);
    for (const [name, span] of spans) {
      expect(span, `${name} harus memanggil revalidateHrPaths()`).toContain("revalidateHrPaths();");
    }
  });

  it("presensi: setiap aksi merevalidasi halaman absensi", () => {
    const spans = functionSpans(read("hr/presensi.ts"));
    expect(spans.size).toBe(2);
    for (const [name, span] of spans) {
      expect(span, `${name} harus merevalidasi absensi`).toContain(
        'revalidatePath("/app/akuntansi/hr/absensi")',
      );
    }
  });

  it("cuti-lembur: setiap aksi merevalidasi halaman tempat datanya tampil", () => {
    const expected: Record<string, string[]> = {
      submitOvertimeRequestAction: ["/app/akuntansi/hr/lembur", "/app/akuntansi/hr/persetujuan"],
      decideOvertimeRequestAction: ["/app/akuntansi/hr/lembur", "/app/akuntansi/hr/persetujuan"],
      computeThrAction: ["/app/akuntansi/hr/lembur"],
      voidComponentDraftAction: ["/app/akuntansi/hr/lembur"],
      saveLeaveTypeAction: ["/app/akuntansi/hr/cuti"],
      setLeaveTypeActiveAction: ["/app/akuntansi/hr/cuti"],
      submitLeaveRequestAction: ["/app/akuntansi/hr/cuti", "/app/akuntansi/hr/persetujuan"],
      decideLeaveRequestAction: ["/app/akuntansi/hr/cuti", "/app/akuntansi/hr/persetujuan"],
    };
    const spans = functionSpans(read("hr/cuti-lembur.ts"));
    expect([...spans.keys()].sort()).toEqual(Object.keys(expected).sort());
    for (const [name, paths] of Object.entries(expected)) {
      const span = spans.get(name)!;
      expect(span, `${name} harus tetap memanggil helper bersama`).toContain("revalidateHrPaths();");
      for (const p of paths) {
        expect(span, `${name} harus merevalidasi ${p}`).toContain(`revalidatePath("${p}")`);
      }
    }
  });
});
