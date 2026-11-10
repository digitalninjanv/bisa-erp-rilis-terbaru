import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-26 Q1 (K-08, kontrak §1.1/§2.2) — larangan siklus impor level berkas.
 *
 * Graf impor statis dibangun dari seluruh berkas src/ (alias `@/` →
 * src/, specifier relatif diresolusi ke berkas nyata; paket eksternal
 * diabaikan). Setiap pernyataan impor digolongkan:
 *  - TYPE-ONLY: `import type` / `export type`, atau pernyataan impor
 *    bernama yang SELURUH specifier-nya berawalan `type ` — terhapus
 *    saat kompilasi, tidak membentuk dependensi runtime;
 *  - RUNTIME: sisanya (termasuk impor dinamis `import(...)`).
 *
 * Aturan:
 *  - graf RUNTIME tidak boleh punya komponen terhubung kuat (SCC)
 *    beranggota >1, dan tidak ada berkas yang mengimpor dirinya;
 *  - graf PENUH (runtime + type) hanya boleh punya SCC yang terdaftar
 *    di ALLOWED_TYPE_CYCLES. Satu-satunya entri saat ini adalah
 *    pasangan type-only `lib/permissions.ts ↔ lib/modules.ts`, yang
 *    sudah terdokumentasi di docs/MODULE_BOUNDARIES.md §4 — dan test
 *    memverifikasi tepi di dalam SCC itu memang seluruhnya type-only;
 *  - entri ALLOWED_TYPE_CYCLES yang siklusnya sudah hilang menggagalkan
 *    test (anti basi): hapus entrinya bersamaan dengan siklusnya.
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** SCC type-only yang diizinkan: daftar berkas anggota (relatif src/, terurut). */
const ALLOWED_TYPE_CYCLES: string[][] = [
  ["lib/modules.ts", "lib/permissions.ts"], // MODULE_BOUNDARIES §4: import type dua arah, terhapus saat runtime
];

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

function resolveSpecifier(importer: string, spec: string, fileSet: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) base = path.join(SRC_DIR, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) {
    base = path.resolve(path.dirname(importer), spec);
  } else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT_FROM_PATTERN = /\bimport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const EXPORT_FROM_PATTERN = /\bexport\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const SIDE_EFFECT_PATTERN = /\bimport\s+["']([^"']+)["']/g;
const DYNAMIC_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Klausa impor bernama yang seluruh specifier-nya `type ...` terhapus saat kompilasi. */
function clauseIsAllType(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith("{")) return false;
  const inner = trimmed.slice(trimmed.indexOf("{") + 1, trimmed.lastIndexOf("}"));
  const parts = inner.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 && parts.every((part) => part.startsWith("type "));
}

interface ImportGraph {
  /** Semua tepi (runtime + type). */
  all: Map<string, Set<string>>;
  /** Hanya tepi runtime. */
  runtime: Map<string, Set<string>>;
  /** Berkas yang mengimpor dirinya sendiri. */
  selfImports: string[];
}

function buildGraph(files: string[]): ImportGraph {
  const fileSet = new Set(files);
  const all = new Map<string, Set<string>>();
  const runtime = new Map<string, Set<string>>();
  const selfImports: string[] = [];
  for (const file of files) {
    all.set(file, new Set());
    runtime.set(file, new Set());
  }
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const add = (spec: string, typeOnly: boolean) => {
      const target = resolveSpecifier(file, spec, fileSet);
      if (!target) return;
      if (target === file) {
        selfImports.push(relative(file));
        return;
      }
      all.get(file)!.add(target);
      if (!typeOnly) runtime.get(file)!.add(target);
    };
    for (const match of source.matchAll(IMPORT_FROM_PATTERN)) {
      add(match[3], Boolean(match[1]) || clauseIsAllType(match[2]));
    }
    for (const match of source.matchAll(EXPORT_FROM_PATTERN)) {
      add(match[3], Boolean(match[1]) || clauseIsAllType(match[2]));
    }
    for (const match of source.matchAll(SIDE_EFFECT_PATTERN)) add(match[1], false);
    for (const match of source.matchAll(DYNAMIC_PATTERN)) add(match[1], false);
  }
  return { all, runtime, selfImports };
}

/** Komponen terhubung kuat beranggota >1 (Kosaraju, iteratif). */
function strongComponents(graph: Map<string, Set<string>>): string[][] {
  const nodes = [...graph.keys()];
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const stack: Array<[string, boolean]> = [[start, false]];
    while (stack.length > 0) {
      const [node, expanded] = stack.pop()!;
      if (expanded) {
        order.push(node);
        continue;
      }
      if (visited.has(node)) continue;
      visited.add(node);
      stack.push([node, true]);
      for (const target of graph.get(node)!) {
        if (!visited.has(target)) stack.push([target, false]);
      }
    }
  }
  const reverse = new Map<string, string[]>(nodes.map((node) => [node, []]));
  for (const [node, targets] of graph) {
    for (const target of targets) reverse.get(target)!.push(node);
  }
  const assigned = new Set<string>();
  const components: string[][] = [];
  for (let i = order.length - 1; i >= 0; i--) {
    const start = order[i];
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    assigned.add(start);
    while (stack.length > 0) {
      const node = stack.pop()!;
      component.push(node);
      for (const source of reverse.get(node)!) {
        if (!assigned.has(source)) {
          assigned.add(source);
          stack.push(source);
        }
      }
    }
    if (component.length > 1) {
      components.push(component.map((file) => relative(file)).sort());
    }
  }
  return components;
}

describe("arsitektur: siklus impor (A-26 Q1)", () => {
  const files = listSourceFiles(SRC_DIR);
  const graph = buildGraph(files);
  const runtimeSccs = strongComponents(graph.runtime);
  const allSccs = strongComponents(graph.all);

  it("menemukan berkas sumber untuk dipindai", () => {
    expect(files.length).toBeGreaterThan(400);
    for (const cycle of ALLOWED_TYPE_CYCLES) {
      for (const rel of cycle) {
        expect(existsSync(path.join(SRC_DIR, rel)), `berkas daftar izin hilang: ${rel}`).toBe(true);
      }
    }
  });

  it("tidak ada berkas yang mengimpor dirinya sendiri", () => {
    expect(graph.selfImports).toEqual([]);
  });

  it("tidak ada siklus impor runtime", () => {
    expect(runtimeSccs).toEqual([]);
  });

  it("tidak ada siklus type baru di luar daftar izin", () => {
    const allowed = new Set(ALLOWED_TYPE_CYCLES.map((cycle) => cycle.join("|")));
    const violations = allSccs.filter((scc) => !allowed.has(scc.join("|")));
    expect(violations).toEqual([]);
  });

  it("siklus yang diizinkan murni type-only dan tidak basi", () => {
    for (const cycle of ALLOWED_TYPE_CYCLES) {
      const key = [...cycle].sort().join("|");
      const found = allSccs.find((scc) => scc.join("|") === key);
      expect(found, `siklus izin sudah hilang, hapus dari ALLOWED_TYPE_CYCLES: ${key}`).toBeDefined();
      // Tepi runtime di dalam SCC terlarang: siklus ini sah HANYA karena type-only.
      const members = new Set(cycle.map((rel) => path.join(SRC_DIR, rel)));
      const runtimeEdges: string[] = [];
      for (const member of members) {
        for (const target of graph.runtime.get(member)!) {
          if (members.has(target)) {
            runtimeEdges.push(`${relative(member)} -> ${relative(target)}`);
          }
        }
      }
      expect(runtimeEdges, `siklus izin mengandung tepi runtime: ${key}`).toEqual([]);
    }
  });
});
