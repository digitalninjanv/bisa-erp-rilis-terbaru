import { describe, expect, it } from "vitest";
import {
  accessibleModules,
  denialRedirectPath,
  singleModuleLanding,
  type LandingAccess,
} from "@/lib/landing";
import type { ModuleKey } from "@/lib/modules";
import { modulesFor, permissionsFor } from "@/lib/permissions";

// A-24 T2: himpunan modul bertambah "hr" (modul cangkang HR).
const ALL: ModuleKey[] = ["pos", "gudang", "akuntansi", "hr"];

function accessFor(role: string, enabledModules: ModuleKey[] = ALL): LandingAccess {
  return {
    permissions: permissionsFor(role),
    modules: modulesFor(role),
    enabledModules,
  };
}

/**
 * A-23 SIS-06/SIS-04: pendaratan sadar peran (riset pola S1) dan target
 * pantulan penolakan izin. Aturannya murni: modul terjangkau = peran ∩
 * saklar perusahaan; tepat satu modul terjangkau → mendarat langsung di
 * modulnya; penolakan izin memantul ke permukaan yang bisa dibuka
 * pengguna (beranda, atau beranda modulnya bila halaman induk modul itu
 * bisa ia buka) dengan parameter `forbidden` untuk banner penjelasan —
 * tidak pernah ke halaman yang penjaganya sendiri akan menolak lagi.
 */
describe("accessibleModules", () => {
  it("intersects role modules with the company switch", () => {
    expect(accessibleModules(["pos", "gudang"], ALL)).toEqual(["pos", "gudang"]);
    expect(accessibleModules(["pos", "gudang"], ["pos"])).toEqual(["pos"]);
    expect(accessibleModules(["pos"], ["gudang"])).toEqual([]);
  });

  it("keeps the canonical module order regardless of input order", () => {
    expect(accessibleModules(["akuntansi", "pos"], ALL)).toEqual(["pos", "akuntansi"]);
  });
});

describe("singleModuleLanding", () => {
  it("lands the built-in single-module roles in their module", () => {
    expect(singleModuleLanding(["pos"], ALL)).toBe("pos");
    expect(singleModuleLanding(["gudang"], ALL)).toBe("gudang");
  });

  it("keeps multi-module and zero-module users on the shared home", () => {
    expect(singleModuleLanding(ALL, ALL)).toBeNull();
    expect(singleModuleLanding(["akuntansi", "gudang"], ALL)).toBeNull();
    expect(singleModuleLanding([], ALL)).toBeNull();
  });

  it("does not land a user whose only module is switched off company-wide", () => {
    expect(singleModuleLanding(["pos"], ["gudang", "akuntansi"])).toBeNull();
  });
});

describe("denialRedirectPath", () => {
  it("bounces a cashier into the POS home with the notice attached", () => {
    expect(denialRedirectPath(accessFor("cashier"), "pos.return")).toBe(
      "/app/pos?forbidden=pos.return",
    );
    expect(denialRedirectPath(accessFor("cashier"), "settings.manage")).toBe(
      "/app/pos?forbidden=settings.manage",
    );
  });

  it("bounces warehouse staff into the warehouse home", () => {
    expect(denialRedirectPath(accessFor("warehouse"), "import.manage")).toBe(
      "/app/gudang?forbidden=import.manage",
    );
  });

  it("bounces multi-module users to the shared home", () => {
    expect(denialRedirectPath(accessFor("manager"), "users.manage")).toBe(
      "/app?forbidden=users.manage",
    );
    expect(denialRedirectPath(accessFor("accountant"), "pos.return")).toBe(
      "/app?forbidden=pos.return",
    );
  });

  it("never bounces to a module home whose own guard would deny again", () => {
    // Custom role: module akuntansi only, but WITHOUT accounting.view —
    // the akuntansi home page itself requires accounting.view.
    const custom: LandingAccess = { permissions: [], modules: ["akuntansi"], enabledModules: ALL };
    expect(denialRedirectPath(custom, "accounting.view")).toBe("/app?forbidden=accounting.view");
    // Same shape for POS: module pos without pos.sell.
    const posCustom: LandingAccess = {
      permissions: ["pos.session"],
      modules: ["pos"],
      enabledModules: ALL,
    };
    expect(denialRedirectPath(posCustom, "pos.sell")).toBe("/app?forbidden=pos.sell");
  });

  it("bounces to the shared home when the only module is switched off", () => {
    expect(denialRedirectPath(accessFor("cashier", ["gudang"]), "pos.return")).toBe(
      "/app?forbidden=pos.return",
    );
  });
});
