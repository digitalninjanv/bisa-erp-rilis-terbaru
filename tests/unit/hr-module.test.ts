import { describe, expect, it } from "vitest";
import {
  ALL_MODULE_KEYS,
  MODULES,
  MODULE_LIST,
  groupNavItems,
  isModuleEnabled,
  resolveModuleAccess,
  sanitizeEnabledModules,
  type ModuleKey,
} from "@/lib/modules";
import {
  MODULE_PERMISSIONS,
  PERMISSIONS,
  can,
  moduleForPermission,
  modulesFor,
  permissionsFor,
  sanitizeModules,
  withImpliedModules,
} from "@/lib/permissions";
import {
  MODULE_HOME_PERMISSION,
  accessibleModules,
  denialRedirectPath,
  singleModuleLanding,
  type LandingAccess,
} from "@/lib/landing";
import { buildPalettePages } from "@/lib/palette";

/**
 * A-24 T2 — HR menjadi modul shell sendiri (Opsi A riset teknologi):
 * `ModuleKey` bertambah "hr"; sebagian besar rute tetap di
 * /app/akuntansi/... (payroll, kasbon, pinjaman, klaim, absensi).
 * Overhaul HR menambahkan beranda ringkasan /app/akuntansi/hr dan
 * memindahkan organisasi ke /app/akuntansi/hr/pengaturan; grup
 * "SDM & Payroll" tetap keluar dari sidebar akuntansi; izin tetap
 * payroll.* tetapi modul pemiliknya kini hr; saklar perusahaan
 * berbasis ModuleKey sehingga hr otomatis ikut; pendaratan
 * memperlakukan hr seperti modul lain.
 */

const HR_HREFS = [
  "/app/akuntansi/payroll",
  // A-25 U5: halaman Persetujuan gabungan ditambahkan disengaja
  // (pola penambahan T3 untuk Mode Operasi) — bukan rute berpindah.
  "/app/akuntansi/hr/persetujuan",
  "/app/akuntansi/hr/absensi",
  "/app/akuntansi/hr/lembur",
  "/app/akuntansi/hr/cuti",
  "/app/akuntansi/kasbon",
  "/app/akuntansi/pinjaman",
  "/app/akuntansi/klaim",
  "/app/akuntansi/hr",
  // Overhaul HR: organisasi & parameter pindah ke rute sendiri agar
  // beranda HR menjadi ringkasan operasional, bukan halaman setting.
  "/app/akuntansi/hr/pengaturan",
];

describe("definisi modul HR (beranda ringkasan sendiri)", () => {
  it("hr terdaftar sebagai ModuleKey, di MODULES & MODULE_LIST", () => {
    expect(ALL_MODULE_KEYS).toContain("hr");
    expect(MODULES.hr.key).toBe("hr");
    expect(MODULES.hr.name).toBe("HR");
    expect(MODULE_LIST.map((m) => m.key)).toContain("hr");
  });

  it("beranda modul HR adalah ringkasan HR, bukan halaman payroll", () => {
    expect(MODULES.hr.href).toBe("/app/akuntansi/hr");
  });

  it("nav HR menunjuk keluarga rute HR (termasuk pengaturan) tanpa duplikat", () => {
    const hrefs = MODULES.hr.nav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual([...HR_HREFS].sort());
    for (const href of hrefs) expect(href.startsWith("/app/akuntansi/")).toBe(true);
  });

  it("seluruh item nav HR berpagar payroll.view (izin tidak berganti kunci)", () => {
    for (const item of MODULES.hr.nav) expect(item.permission).toBe("payroll.view");
  });

  it("nav HR dikelompokkan per pekerjaan", () => {
    const groups = groupNavItems(MODULES.hr.nav);
    expect(groups.map((group) => group.group)).toEqual([
      "Dashboard",
      "Karyawan",
      "Kesejahteraan",
      "Pengaturan",
    ]);
  });
});

describe("sidebar akuntansi kehilangan grup SDM & Payroll", () => {
  it("tidak ada lagi item HR di nav akuntansi", () => {
    const hrefs = MODULES.akuntansi.nav.map((item) => item.href);
    for (const href of HR_HREFS) expect(hrefs).not.toContain(href);
  });

  it("grup akuntansi mengikuti IA Accurate-like", () => {
    const groups = groupNavItems(MODULES.akuntansi.nav);
    expect(groups.map((g) => g.group)).toEqual([
      "Dashboard",
      "Kas & Bank",
      "Buku Besar",
      "Laporan",
      "Pengaturan",
    ]);
  });

  it("gabungan href semua modul = 56 item tanpa dobel", () => {
    const all = MODULE_LIST.flatMap((m) => m.nav.map((i) => i.href));
    expect(new Set(all).size).toBe(all.length);
    // 9 POS + 17 Gudang + 16 Akuntansi + 10 HR + 4 Analisa = 56 item nav.
    expect(all).toHaveLength(56);
  });
});

describe("kepemilikan izin payroll berpindah ke modul hr (kunci izin tetap)", () => {
  it("moduleForPermission memetakan payroll.* ke hr, bukan akuntansi", () => {
    expect(moduleForPermission("payroll.view")).toBe("hr");
    expect(moduleForPermission("payroll.manage")).toBe("hr");
    // A-28 Tahap 5 (H-HR-01): payroll.salary bergabung di modul hr.
    expect(moduleForPermission("payroll.salary")).toBe("hr");
    expect(MODULE_PERMISSIONS.hr).toEqual(["payroll.view", "payroll.salary", "payroll.manage"]);
    expect(MODULE_PERMISSIONS.akuntansi).not.toContain("payroll.view");
    expect(MODULE_PERMISSIONS.akuntansi).not.toContain("payroll.manage");
  });

  it("label izin payroll dinetralkan ke modul HR (teks semata)", () => {
    expect(PERMISSIONS["payroll.view"].startsWith("HR:")).toBe(true);
    expect(PERMISSIONS["payroll.manage"].startsWith("HR:")).toBe(true);
    expect(PERMISSIONS["payroll.salary"].startsWith("HR:")).toBe(true);
  });

  it("sanitizeModules kini mempertahankan hr (modul sah)", () => {
    expect(sanitizeModules(["hr", "pos"])).toEqual(["hr", "pos"]);
  });
});

describe("matriks visibilitas modul HR per peran bawaan", () => {
  // Modul terlihat = peran memuat modulnya DAN perusahaan menyalakan.
  const visible = (role: string) =>
    accessibleModules(modulesFor(role), [...ALL_MODULE_KEYS]);

  it("owner, admin, manager (pemegang payroll.view) melihat HR", () => {
    for (const role of ["owner", "admin", "manager"]) {
      expect(can(role, "payroll.view")).toBe(true);
      expect(visible(role)).toContain("hr");
    }
  });

  it("kasir & staf gudang tidak melihat HR", () => {
    for (const role of ["cashier", "warehouse"]) {
      expect(can(role, "payroll.view")).toBe(false);
      expect(visible(role)).not.toContain("hr");
    }
  });

  it("akuntan & lihat-saja tidak melihat HR: template mereka memang tidak memegang payroll.view", () => {
    // Keadaan template yang sudah ada & tidak diubah T2: akuntan tidak
    // pernah bisa membuka halaman payroll (gerbang payroll.view), jadi
    // modul HR juga tidak tampil untuknya. Pemilik dapat memberi peran
    // kustom berizin payroll.view bila menginginkan sebaliknya.
    for (const role of ["accountant", "viewer"]) {
      expect(can(role, "payroll.view")).toBe(false);
      expect(visible(role)).not.toContain("hr");
    }
  });

  it("penjaga modul: resolveModuleAccess untuk hr mengikuti pola modul lain", () => {
    const all = [...ALL_MODULE_KEYS];
    expect(resolveModuleAccess(["hr"], all, "hr")).toBe("ok");
    expect(resolveModuleAccess(["pos"], all, "hr")).toBe("denied");
    expect(resolveModuleAccess(["hr"], ["pos", "gudang", "akuntansi"], "hr")).toBe("disabled");
  });
});

describe("withImpliedModules — modul mengikuti izin pemiliknya (pola editor peran)", () => {
  it("peran kustom lama berizin payroll.view memperoleh modul hr tanpa menulis ulang data tersimpan", () => {
    // Peran kustom yang disimpan sebelum T2 tidak mungkin memuat "hr"
    // di daftar modulnya, tetapi saveCompanyRoleAction selalu menanam
    // modul pemilik izin ke daftar modul — resolusi sesi menerapkan
    // pelengkap yang sama agar akses payroll yang sah tidak hilang.
    expect(withImpliedModules(["akuntansi"], ["payroll.view"])).toEqual(["akuntansi", "hr"]);
    expect(withImpliedModules(["akuntansi"], ["payroll.manage"])).toEqual(["akuntansi", "hr"]);
  });

  it("tidak menambah modul yang izinnya tidak dipegang", () => {
    expect(withImpliedModules(["pos"], ["pos.sell", "pos.session"])).toEqual(["pos"]);
    expect(withImpliedModules(["gudang"], ["inventory.view"])).toEqual(["gudang"]);
    expect(withImpliedModules([], [])).toEqual([]);
  });

  it("urutan hasil kanonis mengikuti ALL_MODULES dan tanpa duplikat", () => {
    expect(withImpliedModules(["hr", "pos"], ["pos.sell", "payroll.view"])).toEqual(["pos", "hr"]);
  });
});

describe("saklar perusahaan: hr otomatis ikut mekanisme ModuleKey", () => {
  it("bawaan (null/kosong) = hr aktif seperti modul lain", () => {
    expect(sanitizeEnabledModules(null)).toContain("hr");
    expect(sanitizeEnabledModules({})).toContain("hr");
    expect(isModuleEnabled(null, "hr")).toBe(true);
  });

  it("hr:false persis mematikan HR saja", () => {
    expect(sanitizeEnabledModules({ hr: false })).toEqual(["pos", "gudang", "akuntansi", "analisa"]);
    expect(isModuleEnabled({ enabledModules: { hr: false } }, "hr")).toBe(false);
    expect(isModuleEnabled({ enabledModules: { hr: false } }, "akuntansi")).toBe(true);
  });

  it("peta tersimpan lama tanpa kunci hr tetap mengaktifkan HR (lenient)", () => {
    expect(sanitizeEnabledModules({ pos: false })).toEqual(["gudang", "akuntansi", "hr", "analisa"]);
  });
});

describe("pendaratan memperlakukan hr seperti modul lain", () => {
  it("pengguna satu-modul HR mendarat di HR", () => {
    expect(singleModuleLanding(["hr"], [...ALL_MODULE_KEYS])).toBe("hr");
    expect(MODULE_HOME_PERMISSION.hr).toBe("payroll.view");
  });

  it("penolakan untuk pengguna HR-saja memantul ke beranda HR dengan banner", () => {
    const access: LandingAccess = {
      permissions: ["payroll.view"],
      modules: ["hr"],
      enabledModules: [...ALL_MODULE_KEYS],
    };
    expect(denialRedirectPath(access, "payroll.manage")).toBe(
      "/app/akuntansi/hr?forbidden=payroll.manage",
    );
  });

  it("kasir tetap hanya mendarat di POS (hr tidak bocor ke peran lain)", () => {
    const access: LandingAccess = {
      permissions: permissionsFor("cashier"),
      modules: modulesFor("cashier") as ModuleKey[],
      enabledModules: [...ALL_MODULE_KEYS],
    };
    expect(singleModuleLanding(access.modules, access.enabledModules)).toBe("pos");
    expect(accessibleModules(access.modules, access.enabledModules)).not.toContain("hr");
  });
});

describe("palet perintah sadar modul HR", () => {
  it("pemilik: halaman payroll berkumpul di bawah modul HR, bukan Akuntansi", () => {
    const role = { permissions: permissionsFor("owner"), modules: modulesFor("owner") };
    const pages = buildPalettePages({
      permissions: role.permissions,
      modules: role.modules,
      enabledModules: [...ALL_MODULE_KEYS],
    });
    const payroll = pages.find((page) => page.href === "/app/akuntansi/payroll");
    expect(payroll?.module).toBe("HR");
    expect(pages.some((page) => page.module === "HR" && page.href === "/app/akuntansi/kasbon")).toBe(true);
  });

  it("kasir: nol halaman HR di indeks", () => {
    const pages = buildPalettePages({
      permissions: permissionsFor("cashier"),
      modules: modulesFor("cashier"),
      enabledModules: [...ALL_MODULE_KEYS],
    });
    expect(pages.some((page) => page.module === "HR")).toBe(false);
  });
});
