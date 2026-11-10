import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";

/**
 * SIM-2 S6 (SEC-07): injeksi formula CSV. Nama produk/pelanggan/
 * pemasok yang dikendalikan pengguna ikut diekspor; tanpa
 * netralisasi, nilai seperti `=2+5+cmd|...` dieksekusi spreadsheet
 * sebagai formula saat berkas dibuka.
 */
describe("toCsv — netralisasi injeksi formula (SEC-07)", () => {
  it("mengawali sel berawalan =, +, -, @ dengan kutip tunggal", () => {
    const csv = toCsv(["Nama"], [["=2+5+cmd|' /C calc'!A0"], ["+SUM(A1:A9)"], ["-2+3+cmd"], ["@SUM(1+1)"]]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("'=2+5+cmd|' /C calc'!A0");
    expect(lines[2]).toBe("'+SUM(A1:A9)");
    expect(lines[3]).toBe("'-2+3+cmd");
    expect(lines[4]).toBe("'@SUM(1+1)");
  });

  it("menetralkan juga bila didahului spasi/tab", () => {
    const csv = toCsv(["Nama"], [["  =HYPERLINK(\"http://x\")"], ["\t@cmd"]]);
    const lines = csv.split("\r\n");
    // Nilai berisi tanda kutip → tetap terbungkus kutip CSV; awalan '
    // menetralkan formula ada di dalam bungkus itu.
    expect(lines[1]).toBe("\"'  =HYPERLINK(\"\"http://x\"\")\"");
    expect(lines[2]).toBe("'\t@cmd");
  });

  it("angka murni — termasuk negatif — tidak diubah agar tetap terparse sebagai angka", () => {
    const csv = toCsv(["Saldo"], [["-1500.50"], ["2000"], ["-42"], [0], [-7.25]]);
    const lines = csv.split("\r\n");
    expect(lines.slice(1)).toEqual(["-1500.50", "2000", "-42", "0", "-7.25"]);
  });

  it("teks biasa dan penggabungan kutip tetap seperti sebelumnya", () => {
    const csv = toCsv(["Nama", "Catatan"], [["Toko \"Baru\", Jaya", "baris\nbaru"], [null, undefined]]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Nama,Catatan");
    expect(lines[1]).toBe('"Toko ""Baru"", Jaya","baris\nbaru"');
    expect(lines[2]).toBe(",");
  });

  it("header yang berisiko pun dinetralkan", () => {
    expect(toCsv(["=Judul"], [["x"]]).split("\r\n")[0]).toBe("'=Judul");
  });
});
