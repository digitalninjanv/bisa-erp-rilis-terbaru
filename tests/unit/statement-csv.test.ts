import { describe, expect, it } from "vitest";
import {
  STATEMENT_CSV_EXAMPLE,
  parseStatementCsv,
} from "@/lib/statement-csv";
import { groupContraAccounts } from "@/lib/reconciliation-form";

/**
 * A-22 Tahap K3 (UX-05): impor mutasi harus jujur — contoh yang
 * ditampilkan UI dijamin lolos parser yang sama, dan tempelan baris
 * data TANPA header (bentuk yang ditolak pada audit) kini diterima
 * lewat deteksi baris pertama, tanpa melonggarkan penolakan format
 * asing.
 */
describe("statement-csv: contoh UI adalah kontrak parser", () => {
  it("contoh yang ditampilkan UI lolos parser persis", () => {
    const parsed = parseStatementCsv(STATEMENT_CSV_EXAMPLE);
    expect(parsed.errors).toEqual([]);
    expect(parsed.totalRows).toBe(2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].date).toBe("2026-11-03");
    expect(parsed.rows[0].description).toBe("Setoran tunai");
    expect(parsed.rows[0].debit.toFixed(4)).toBe("1500000.0000");
    expect(parsed.rows[0].credit.toFixed(4)).toBe("0.0000");
    expect(parsed.rows[1].debit.toFixed(4)).toBe("0.0000");
    expect(parsed.rows[1].credit.toFixed(4)).toBe("6500.0000");
  });

  it("contoh memuat baris header wajibnya di baris pertama", () => {
    expect(STATEMENT_CSV_EXAMPLE.split("\n")[0]).toBe("Tanggal;Keterangan;Debit;Kredit");
  });
});

describe("statement-csv: tempelan tanpa header (deteksi baris pertama)", () => {
  it("satu baris data tanpa header — bentuk persis yang gagal di audit UX-05", () => {
    const parsed = parseStatementCsv("05/11/2026;Biaya admin;;6.500");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].date).toBe("2026-11-05");
    expect(parsed.rows[0].credit.toFixed(4)).toBe("6500.0000");
  });

  it("banyak baris tanpa header menghasilkan baris yang sama dengan versi berheader", () => {
    const withHeader = parseStatementCsv(STATEMENT_CSV_EXAMPLE);
    const headerless = parseStatementCsv(
      STATEMENT_CSV_EXAMPLE.split("\n").slice(1).join("\n"),
    );
    expect(headerless.errors).toEqual([]);
    expect(
      headerless.rows.map((row) => [
        row.date,
        row.description,
        row.debit.toFixed(4),
        row.credit.toFixed(4),
      ]),
    ).toEqual(
      withHeader.rows.map((row) => [
        row.date,
        row.description,
        row.debit.toFixed(4),
        row.credit.toFixed(4),
      ]),
    );
  });

  it("tanpa header dengan satu kolom nominal: positif = debit, negatif = kredit", () => {
    const parsed = parseStatementCsv(
      ["03/11/2026;Bunga bank;25.000", "04/11/2026;Biaya admin;-6.500"].join("\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].debit.toFixed(4)).toBe("25000.0000");
    expect(parsed.rows[1].credit.toFixed(4)).toBe("6500.0000");
  });

  it("tanpa header dengan pemisah koma dan keterangan berkuot", () => {
    const parsed = parseStatementCsv('2026-11-03,"Setoran, tunai","1,500,000.00",');
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].description).toBe("Setoran, tunai");
    expect(parsed.rows[0].debit.toFixed(4)).toBe("1500000.0000");
  });

  it("baris sesudah baris pertama yang rusak tetap menjadi error per baris, bukan penolakan total", () => {
    const parsed = parseStatementCsv(
      ["05/11/2026;Biaya admin;;6.500", "bukan-tanggal;Rusak;;1.000"].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].row).toBe(2);
  });

  it("baris pertama berisi debit DAN kredit bersamaan BUKAN data sah — ditolak sebagai header tak dikenal", () => {
    expect(() => parseStatementCsv("05/11/2026;Ganda;1.000;2.000")).toThrow(
      /Header CSV tidak dikenali/,
    );
  });

  it("baris pertama bukan tanggal — format asing tetap ditolak", () => {
    expect(() => parseStatementCsv("SKU;Nama;Harga\nA1;Barang;1000")).toThrow(
      /Header CSV tidak dikenali/,
    );
    // Tanpa header dengan urutan kolom tertukar (keterangan dulu)
    // tidak ditebak — sel pertama bukan tanggal, jadi ditolak.
    expect(() => parseStatementCsv("Biaya admin;05/11/2026;;6.500")).toThrow(
      /Header CSV tidak dikenali/,
    );
  });

  it("header bernama dengan urutan kolom tertukar tetap sah (kolom dicari by nama)", () => {
    const parsed = parseStatementCsv(
      "Keterangan;Tanggal;Debit;Kredit\nBiaya admin;05/11/2026;;6.500",
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].credit.toFixed(4)).toBe("6500.0000");
  });
});

describe("statement-csv: perilaku berheader tidak berubah", () => {
  it("alias header bank umum tetap dikenali", () => {
    const parsed = parseStatementCsv(
      [
        "Tanggal Transaksi,Uraian,Mutasi Debit,Mutasi Kredit",
        "2026-11-03,Setoran tunai,1500000,",
      ].join("\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].debit.toFixed(4)).toBe("1500000.0000");
  });

  it("satu kolom Nominal berheader tetap didukung", () => {
    const parsed = parseStatementCsv(
      ["Tanggal;Keterangan;Nominal", "03/11/2026;Setoran;1.500.000", "03/11/2026;Biaya;-6.500"].join("\n"),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows[0].debit.toFixed(4)).toBe("1500000.0000");
    expect(parsed.rows[1].credit.toFixed(4)).toBe("6500.0000");
  });

  it("error per baris dipertahankan untuk berkas berheader", () => {
    const parsed = parseStatementCsv(
      ["Tanggal;Keterangan;Debit;Kredit", "32/13/2026;Tanggal rusak;1.000;", "03/11/2026;Bagus;2.000;"].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.errors).toHaveLength(1);
    expect(parsed.errors[0].row).toBe(2);
  });

  it("teks kosong ditolak dengan pesan kosong", () => {
    expect(() => parseStatementCsv("   \n  ")).toThrow(/kosong/);
  });
});

describe("reconciliation-form: pengelompokan akun lawan", () => {
  const account = (code: string, type: string, isCashBank = false) => ({
    id: `id-${code}`,
    code,
    name: `Akun ${code}`,
    type,
    isCashBank,
  });

  it("kas/bank selalu kelompok pertama, lalu beban, pendapatan, kewajiban, aset, hpp, ekuitas", () => {
    const groups = groupContraAccounts([
      account("6060", "expense"),
      account("1100", "asset", true),
      account("4030", "revenue"),
      account("2130", "liability"),
      account("1400", "asset"),
      account("5000", "cogs"),
      account("3000", "equity"),
      account("1000", "asset", true),
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Kas & bank",
      "Beban",
      "Pendapatan",
      "Kewajiban & pajak",
      "Aset lain",
      "Harga pokok",
      "Ekuitas",
    ]);
    expect(groups[0].accounts.map((row) => row.code)).toEqual(["1100", "1000"]);
    expect(groups[1].accounts.map((row) => row.code)).toEqual(["6060"]);
  });

  it("kelompok kosong tidak ditampilkan; tipe tak dikenal masuk Lainnya", () => {
    const groups = groupContraAccounts([
      account("6060", "expense"),
      account("9999", "mystery"),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Beban", "Lainnya"]);
  });

  it("daftar kosong menghasilkan daftar kelompok kosong", () => {
    expect(groupContraAccounts([])).toEqual([]);
  });
});
