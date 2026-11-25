import { describe, expect, it } from "vitest";
import {
  PERMISSIONS,
  can,
  missingPermissions,
  modulesFor,
  permissionsFor,
  sanitizeModules,
  sanitizePermissions,
} from "@/lib/permissions";

describe("built-in roles", () => {
  it("grants owner every permission and module", () => {
    expect(permissionsFor("owner")).toHaveLength(Object.keys(PERMISSIONS).length);
    expect(can("owner", "users.manage")).toBe(true);
    // A-24 T2: ALL_MODULES bertambah modul "hr".
    expect(modulesFor("owner")).toEqual(["pos", "gudang", "akuntansi", "hr", "analisa"]);
  });

  it("limits cashier to POS only (A-23 SIS-02: kasir hanya POS)", () => {
    expect(can("cashier", "pos.sell")).toBe(true);
    expect(can("cashier", "pos.session")).toBe(true);
    expect(can("cashier", "inventory.view")).toBe(false);
    expect(can("cashier", "inventory.manage")).toBe(false);
    expect(can("cashier", "inventory.cost")).toBe(false);
    expect(can("cashier", "accounting.view")).toBe(false);
    expect(modulesFor("cashier")).toEqual(["pos"]);
    expect(permissionsFor("cashier")).toEqual(["pos.sell", "pos.return", "pos.session"]);
  });

  it("grants cashier the sale-return path but not void/discount (A-23 SIS-03)", () => {
    // SIS-03: retur dengan nota adalah pekerjaan harian kasir di
    // minimarket (struk sendiri menjanjikan tukar dengan nota) dan
    // domainnya sudah berizin terpisah — template Kasir membawanya.
    // Void & diskon di atas ambang tetap BUKAN milik kasir: keduanya
    // kontrol harga/penghapusan, bukan layanan retur.
    expect(can("cashier", "pos.return")).toBe(true);
    expect(can("cashier", "pos.void")).toBe(false);
    expect(can("cashier", "pos.discount")).toBe(false);
  });

  it("falls back to viewer for unknown roles", () => {
    expect(can("unknown", "inventory.view")).toBe(true);
    expect(can("unknown", "pos.sell")).toBe(false);
  });
});

describe("inventory.price (FIX-GDG Tahap 3 / GDG3-11)", () => {
  it("is granted to owner, admin, and manager only among operational roles", () => {
    expect(can("owner", "inventory.price")).toBe(true);
    expect(can("admin", "inventory.price")).toBe(true);
    expect(can("manager", "inventory.price")).toBe(true);
    expect(can("warehouse", "inventory.price")).toBe(false);
    expect(can("cashier", "inventory.price")).toBe(false);
    expect(can("accountant", "inventory.price")).toBe(false);
    expect(can("viewer", "inventory.price")).toBe(false);
  });

  it("is a real catalog permission that custom roles can carry", () => {
    expect(PERMISSIONS["inventory.price"]).toBeTruthy();
    expect(sanitizePermissions(["inventory.price"])).toEqual(["inventory.price"]);
    expect(can({ role: "custom", permissions: ["inventory.price"] }, "inventory.price")).toBe(true);
  });
});

describe("payroll.salary (A-28 Tahap 5 / H-HR-01)", () => {
  it("memisahkan lihat angka gaji dari payroll.view & payroll.manage", () => {
    // Pemegang view saja (peran kustom HR baca-saja) TIDAK otomatis
    // melihat angka gaji; pemegang salary melihat tanpa bisa mengelola.
    expect(can({ role: "custom", permissions: ["payroll.view"] }, "payroll.salary")).toBe(false);
    expect(can({ role: "custom", permissions: ["payroll.salary"] }, "payroll.salary")).toBe(true);
    expect(can({ role: "custom", permissions: ["payroll.salary"] }, "payroll.manage")).toBe(false);
    expect(can({ role: "custom", permissions: ["payroll.salary"] }, "payroll.view")).toBe(false);
  });

  it("diberikan ke owner, admin, manager (yang kemarin memang melihat angka gaji); bukan peran lain", () => {
    expect(can("owner", "payroll.salary")).toBe(true);
    expect(can("admin", "payroll.salary")).toBe(true);
    // Manager kemarin memegang payroll.view dan halaman payroll
    // menampilkan angka gaji kepadanya — izin baru mempertahankan
    // akses efektif itu (bukan perluasan, bukan pencabutan diam-diam).
    expect(can("manager", "payroll.salary")).toBe(true);
    expect(can("manager", "payroll.manage")).toBe(false);
    // Akuntan & lihat-saja kemarin TIDAK melihat payroll sama sekali
    // (tanpa payroll.view) — template mereka tidak berubah; jalur
    // akuntan adalah peran kustom berizin payroll.salary dari pemilik.
    expect(can("accountant", "payroll.salary")).toBe(false);
    expect(can("viewer", "payroll.salary")).toBe(false);
    expect(can("cashier", "payroll.salary")).toBe(false);
    expect(can("warehouse", "payroll.salary")).toBe(false);
  });

  it("is a real catalog permission that custom roles can carry", () => {
    expect(PERMISSIONS["payroll.salary"]).toBeTruthy();
    expect(PERMISSIONS["payroll.salary"].startsWith("HR:")).toBe(true);
    expect(sanitizePermissions(["payroll.salary"])).toEqual(["payroll.salary"]);
  });
});

describe("custom permission subjects", () => {
  it("uses the explicit permission list when provided", () => {
    const subject = { role: "custom", permissions: ["pos.sell", "inventory.view"] as const };
    expect(can(subject, "pos.sell")).toBe(true);
    expect(can(subject, "pos.void")).toBe(false);
    expect(can(subject, "accounting.view")).toBe(false);
  });

  it("accepts a role string", () => {
    expect(can("accountant", "accounting.post")).toBe(true);
    expect(can("accountant", "payroll.manage")).toBe(false);
  });
});

describe("sanitizers", () => {
  it("drops unknown permissions and duplicates", () => {
    expect(sanitizePermissions(["pos.sell", "pos.sell", "hack.all", 42])).toEqual(["pos.sell"]);
  });

  it("drops unknown modules", () => {
    // A-24 T2: "hr" kini modul SAH (dulu contoh kunci asing di sini) —
    // contoh kunci asing diganti "portal"; kebertahanan "hr" diuji di
    // tests/unit/hr-module.test.ts.
    expect(sanitizeModules(["pos", "gudang", "portal", "pos"])).toEqual(["pos", "gudang"]);
    expect(sanitizeModules(["hr"])).toEqual(["hr"]);
  });

  it("handles non-array input", () => {
    expect(sanitizePermissions(null)).toEqual([]);
    expect(sanitizeModules("pos")).toEqual([]);
  });
});

describe("missingPermissions (least privilege role assignment)", () => {
  it("returns permissions the actor does not hold", () => {
    expect(
      missingPermissions(
        { role: "cashier", permissions: ["pos.sell", "pos.return", "pos.session"] },
        ["pos.sell", "pos.discount", "payroll.salary"],
      ),
    ).toEqual(["pos.discount", "payroll.salary"]);
  });

  it("owner can manage every permission", () => {
    expect(missingPermissions({ role: "owner", permissions: permissionsFor("owner") }, permissionsFor("manager"))).toEqual([]);
  });
});
