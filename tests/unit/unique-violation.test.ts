import { describe, expect, it } from "vitest";
import { uniqueViolationMessage } from "@/lib/errors";

// T5R-4: tabrakan kunci idempotensi jurnal — misalnya balapan
// double-submit jurnal manual yang lolos pemeriksaan awal di dua
// transaksi — menabrak journal_entries_company_idem_uq. Jurnal pertama
// SUDAH terposting, jadi pesan "kode/nomor sudah digunakan" menyesatkan;
// pengguna harus diarahkan memuat ulang daftar jurnal.
describe("uniqueViolationMessage — journal_entries_company_idem_uq (T5R-4)", () => {
  const expected =
    "Pengiriman ganda terdeteksi untuk jurnal ini. Muat ulang daftar jurnal untuk melihat hasilnya.";

  it("memetakan nama constraint dari properti constraint milik driver", () => {
    const error = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "journal_entries_company_idem_uq",
    });
    expect(uniqueViolationMessage(error)).toBe(expected);
  });

  it("memulihkan nama constraint dari teks pesan Postgres", () => {
    const error = Object.assign(
      new Error('duplicate key value violates unique constraint "journal_entries_company_idem_uq"'),
      { code: "23505" },
    );
    expect(uniqueViolationMessage(error)).toBe(expected);
  });

  it("menemukan pelanggaran yang terbungkus rantai cause drizzle", () => {
    const inner = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "journal_entries_company_idem_uq",
    });
    const wrapped = new Error("Failed query", { cause: inner });
    expect(uniqueViolationMessage(wrapped)).toBe(expected);
  });

  it("constraint lain tidak berubah dan error non-23505 tetap null", () => {
    const account = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "accounts_company_code_uq",
    });
    expect(uniqueViolationMessage(account)).toMatch(/Kode akun tersebut sudah digunakan/);
    const unknown = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "sesuatu_yang_baru_uq",
    });
    expect(uniqueViolationMessage(unknown)).toMatch(/Kode\/nomor tersebut sudah digunakan/);
    expect(uniqueViolationMessage(new Error("bukan pelanggaran unik"))).toBeNull();
  });
});
