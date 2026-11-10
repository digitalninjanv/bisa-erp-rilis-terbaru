import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  assertModuleEnabled,
  isModuleEnabled,
  resolveModuleAccess,
  sanitizeEnabledModules,
} from "@/lib/modules";

// T5-2 (D-16): saklar modul per perusahaan. Nilai tersimpan di
// company_settings.enabled_modules adalah jsonb tak tepercaya — sanitasi
// menentukan modul mana yang aktif; bawaan selalu "semua aktif".
describe("sanitizeEnabledModules", () => {
  it("null / undefined / bukan objek berarti semua modul aktif", () => {
    expect(sanitizeEnabledModules(null)).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
    expect(sanitizeEnabledModules(undefined)).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
    expect(sanitizeEnabledModules("pos")).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
    expect(sanitizeEnabledModules(42)).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
    expect(sanitizeEnabledModules(["pos"])).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
  });

  it("objek kosong berarti semua modul aktif", () => {
    expect(sanitizeEnabledModules({})).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
  });

  it("hanya nilai false persis yang mematikan modul", () => {
    expect(sanitizeEnabledModules({ akuntansi: false })).toEqual(["pos", "gudang", "hr", "analisa"]);
    expect(sanitizeEnabledModules({ pos: false, akuntansi: false })).toEqual(["gudang", "hr", "analisa"]);
    expect(sanitizeEnabledModules({ pos: false, gudang: false, akuntansi: false })).toEqual(["hr", "analisa"]);
    expect(sanitizeEnabledModules({ pos: false, gudang: false, akuntansi: false, hr: false })).toEqual(["analisa"]);
    expect(sanitizeEnabledModules({ pos: true, gudang: true })).toEqual([
      "pos",
      "gudang",
      "akuntansi",
      "hr",
      "analisa",
    ]);
  });

  it("nilai selain false (0, string, null) tidak mematikan modul; kunci asing diabaikan", () => {
    expect(sanitizeEnabledModules({ pos: 0, gudang: "false", akuntansi: null })).toEqual([
      "pos",
      "gudang",
      "akuntansi",
      "hr",
      "analisa",
    ]);
    // A-24 T2: "hr" bukan lagi kunci asing — ia modul sah yang bisa
    // dimatikan persis; kunci yang benar-benar asing ("portal") tetap
    // diabaikan.
    expect(sanitizeEnabledModules({ hr: false, pos: false })).toEqual(["gudang", "akuntansi", "analisa"]);
    expect(sanitizeEnabledModules({ portal: false, pos: false })).toEqual([
      "gudang",
      "akuntansi",
      "hr",
      "analisa",
    ]);
  });
});

describe("isModuleEnabled", () => {
  it("tanpa baris pengaturan semua modul aktif", () => {
    expect(isModuleEnabled(null, "pos")).toBe(true);
    expect(isModuleEnabled(undefined, "akuntansi")).toBe(true);
    expect(isModuleEnabled({}, "gudang")).toBe(true);
  });

  it("mengikuti peta enabledModules pada baris pengaturan", () => {
    const settings = { enabledModules: { akuntansi: false } };
    expect(isModuleEnabled(settings, "akuntansi")).toBe(false);
    expect(isModuleEnabled(settings, "pos")).toBe(true);
    expect(isModuleEnabled({ enabledModules: null }, "pos")).toBe(true);
  });
});

describe("assertModuleEnabled (T5R-2: gerbang saklar di lapisan action)", () => {
  it("tidak melempar bila modul termasuk yang aktif", () => {
    expect(() => assertModuleEnabled(["pos", "gudang", "akuntansi"], "pos")).not.toThrow();
    expect(() => assertModuleEnabled(["akuntansi"], "akuntansi")).not.toThrow();
  });

  it("melempar FORBIDDEN berisi nama modul bila modul dimatikan perusahaan", () => {
    let caught: unknown;
    try {
      assertModuleEnabled(["gudang", "akuntansi"], "pos");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe("FORBIDDEN");
    expect((caught as AppError).message).toBe(
      "Modul POS sedang dinonaktifkan untuk perusahaan ini.",
    );
    expect(() => assertModuleEnabled([], "akuntansi")).toThrowError(
      "Modul Akuntansi sedang dinonaktifkan untuk perusahaan ini.",
    );
    expect(() => assertModuleEnabled(["pos"], "gudang")).toThrowError(
      "Modul Gudang sedang dinonaktifkan untuk perusahaan ini.",
    );
  });
});

describe("resolveModuleAccess", () => {
  const all = ["pos", "gudang", "akuntansi"] as const;

  it("ok bila peran mengizinkan dan perusahaan mengaktifkan", () => {
    expect(resolveModuleAccess([...all], [...all], "pos")).toBe("ok");
  });

  it("denied bila peran tidak memuat modul (dicek lebih dulu dari saklar perusahaan)", () => {
    expect(resolveModuleAccess(["pos"], [...all], "akuntansi")).toBe("denied");
    expect(resolveModuleAccess(["pos"], [], "akuntansi")).toBe("denied");
  });

  it("disabled bila peran mengizinkan tetapi perusahaan mematikan modul", () => {
    expect(resolveModuleAccess([...all], ["pos", "gudang"], "akuntansi")).toBe("disabled");
  });
});
