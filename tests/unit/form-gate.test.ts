import { describe, expect, it } from "vitest";
import { formGateState } from "@/lib/form-gate";

/**
 * A-24 T1 (SIS-05): keputusan tiga cabang di belakang form dokumen yang
 * digerbang izin. Cacat audit: satu kondisi gabungan
 * `can(manage) && data tersedia` dengan SATU pesan else membuat peran
 * lihat-saja menerima pesan prasyarat yang salah ("Tambahkan gudang
 * terlebih dahulu") padahal datanya ada. Kontrak di sini memisahkan
 * ketiganya agar halaman tidak bisa mencampurnya lagi.
 */
describe("formGateState (SIS-05)", () => {
  it("pengelola + data cukup → form", () => {
    expect(formGateState({ canManage: true, available: 3, minimum: 1 })).toBe("form");
  });

  it("pengelola + data kurang dari minimum → missing (pesan prasyarat BENAR untuknya)", () => {
    expect(formGateState({ canManage: true, available: 0, minimum: 1 })).toBe("missing");
    expect(formGateState({ canManage: true, available: 1, minimum: 2 })).toBe("missing");
  });

  it("lihat-saja + data cukup → view (BUKAN missing — inti cacat SIS-05)", () => {
    expect(formGateState({ canManage: false, available: 3, minimum: 1 })).toBe("view");
  });

  it("lihat-saja + data kurang → view juga (peran tetap bukan pembuat; pesan data kosong bukan urusannya)", () => {
    expect(formGateState({ canManage: false, available: 0, minimum: 1 })).toBe("view");
  });

  it("minimum bawaan = 1", () => {
    expect(formGateState({ canManage: true, available: 1 })).toBe("form");
    expect(formGateState({ canManage: true, available: 0 })).toBe("missing");
  });
});
