import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A-26 Q1 (K-08, kontrak §1.3) — larangan impor internal lintas modul.
 *
 * Wilayah domain di src/server yang punya barrel `index.ts` hanya boleh
 * diimpor lewat permukaan publiknya dari LUAR wilayah itu:
 *  - `@/server/<domain>` (fasad kompatibilitas src/server/<domain>.ts)
 *    atau barrel `@/server/<domain>/index` — SAH dari mana pun;
 *  - impor yang teresolusi ke berkas internal lain di dalam folder
 *    domain (mis. `@/server/inventory/opname-tasks` atau jalur relatif
 *    yang menembus foldernya) — DILARANG dari luar folder domain;
 *  - berkas di DALAM folder domain yang sama bebas saling mengimpor.
 *
 * Pengecualian yang sah dicatat EKSPLISIT di EXCEPTIONS dengan alasan
 * (kunci: "<berkas pengimpor> -> <berkas tujuan>", jalur relatif
 * terhadap src/); entri yang berkasnya sudah tidak ada menggagalkan
 * test (anti basi, pola architecture-read-paths.test.ts).
 */
const SRC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

/** Wilayah domain ber-barrel, relatif terhadap src/. */
const DOMAINS = [
  "server/pos",
  "server/inventory",
  "server/hr",
  "server/reports",
  "server/supplier-returns",
  // A-26 Q5: catalog menjadi wilayah ber-barrel (catalog/index.ts);
  // agregat internalnya tidak boleh diimpor langsung dari luar folder.
  "server/catalog",
  // A-26 Q6: domain impor disatukan di server/import (barrel index.ts);
  // concern internalnya (masters/analyze/commit/opening/files) tidak
  // boleh diimpor langsung dari luar folder — fasad kompatibilitas
  // server/import-masters.ts & server/import-files.ts me-re-export
  // lewat barrel ini.
  "server/import",
] as const;

const EXCEPTIONS: Record<string, string> = {
  // "components/contoh.tsx -> server/inventory/opname-tasks.ts": "alasan tertulis mengapa impor internal di sini sah",
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

const SPECIFIER_PATTERN =
  /\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) found.push(spec);
  }
  return found;
}

/** Resolusi specifier ke berkas nyata di src/ (null = paket eksternal / tak teresolusi). */
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

function domainOf(rel: string): string | null {
  for (const domain of DOMAINS) {
    if (rel.startsWith(`${domain}/`)) return domain;
  }
  return null;
}

describe("arsitektur: batas modul server (A-26 Q1)", () => {
  const files = listSourceFiles(SRC_DIR);
  const fileSet = new Set(files);

  it("menemukan berkas sumber dan barrel setiap domain", () => {
    expect(files.length).toBeGreaterThan(400);
    for (const domain of DOMAINS) {
      expect(
        existsSync(path.join(SRC_DIR, domain, "index.ts")),
        `barrel hilang untuk domain ${domain}`,
      ).toBe(true);
    }
  });

  it("tidak ada impor internal lintas modul di luar barrel", () => {
    const violations: string[] = [];
    for (const file of files) {
      const importerRel = relative(file);
      const importerDomain = domainOf(importerRel);
      const source = readFileSync(file, "utf8");
      for (const spec of specifiersOf(source)) {
        const target = resolveSpecifier(file, spec, fileSet);
        if (!target) continue;
        const targetRel = relative(target);
        const targetDomain = domainOf(targetRel);
        if (!targetDomain) continue;
        if (importerDomain === targetDomain) continue; // internal satu domain: bebas
        if (targetRel === `${targetDomain}/index.ts` || targetRel === `${targetDomain}/index.tsx`) {
          continue; // barrel: permukaan publik
        }
        if (`${importerRel} -> ${targetRel}` in EXCEPTIONS) continue;
        violations.push(`${importerRel} -> ${targetRel} (lewat "${spec}")`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("daftar pengecualian tidak basi", () => {
    for (const key of Object.keys(EXCEPTIONS)) {
      const [importerRel, targetRel] = key.split(" -> ");
      expect(existsSync(path.join(SRC_DIR, importerRel)), `pengecualian basi (pengimpor hilang): ${key}`).toBe(true);
      expect(existsSync(path.join(SRC_DIR, targetRel)), `pengecualian basi (tujuan hilang): ${key}`).toBe(true);
    }
  });
});
