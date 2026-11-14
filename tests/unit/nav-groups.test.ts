import { describe, expect, it } from "vitest";
import { MODULES, groupNavItems, type NavItem } from "@/lib/modules";

// Kontrak navigasi mengikuti group dan href di MODULES, supaya test tidak
// memaksa label atau kelompok lama setelah workflow sidebar dirombak.
// groupNavItems adalah pengelompok murni bersama SidebarNav &
// MobileNav; POS, HR, dan Gudang kini dikelompokkan per pekerjaan,
// sementara modul tanpa grup tetap dirender sebagai satu kelompok
// tanpa nama.

const item = (label: string, group?: string): NavItem =>
  ({ label, href: `/x/${label}`, icon: MODULES.akuntansi.icon, group }) as NavItem;

describe("groupNavItems", () => {
  it("item tanpa grup menjadi satu kelompok tanpa nama, urutan utuh", () => {
    const items = [item("A"), item("B"), item("C")];
    const groups = groupNavItems(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].group).toBeNull();
    expect(groups[0].items.map((i) => i.label)).toEqual(["A", "B", "C"]);
  });

  it("mengelompokkan item berurutan per grup dan mempertahankan urutan", () => {
    const items = [
      item("Jurnal", "Harian"),
      item("Beban", "Harian"),
      item("Laporan", "Buku & Laporan"),
      item("Payroll", "SDM & Payroll"),
    ];
    const groups = groupNavItems(items);
    expect(groups.map((g) => g.group)).toEqual(["Harian", "Buku & Laporan", "SDM & Payroll"]);
    expect(groups[0].items.map((i) => i.label)).toEqual(["Jurnal", "Beban"]);
  });

  it("grup yang sama tetapi tidak berurutan tidak digabung paksa", () => {
    const items = [item("A", "G1"), item("B", "G2"), item("C", "G1")];
    expect(groupNavItems(items).map((g) => g.group)).toEqual(["G1", "G2", "G1"]);
  });
});

describe("navigasi akuntansi berkelompok (Accurate-like)", () => {
  const groups = groupNavItems(MODULES.akuntansi.nav);

  it("kelompok tampil sesuai pekerjaan akuntansi", () => {
    expect(groups.map((g) => g.group)).toEqual([
      "Keuangan harian",
      "Pembukuan",
      "Bagan akun & pengaturan",
      "Laporan & pengendalian",
    ]);
  });

  it("anggota tiap kelompok persis rute yang ada", () => {
    const byGroup = new Map(groups.map((g) => [g.group, g.items.map((i) => i.href)]));
    expect(byGroup.get("Keuangan harian")).toEqual([
      "/app/akuntansi",
      "/app/akuntansi/bank",
      "/app/akuntansi/piutang-utang",
      "/app/akuntansi/bank/transfer",
    ]);
    expect(byGroup.get("Pembukuan")).toEqual([
      "/app/akuntansi/jurnal",
      "/app/akuntansi/jurnal/riwayat",
      "/app/akuntansi/buku-besar",
      "/app/akuntansi/aset",
    ]);
    expect(byGroup.get("Bagan akun & pengaturan")).toEqual([
      "/app/akuntansi/akun",
      "/app/akuntansi/migrasi-coa",
    ]);
    expect(byGroup.get("Laporan & pengendalian")).toEqual([
      "/app/akuntansi/laporan",
      "/app/akuntansi/pajak",
      "/app/akuntansi/periode",
      "/app/akuntansi/rekonsiliasi",
      "/app/akuntansi/rekonsiliasi-kontrol",
      "/app/akuntansi/riwayat",
    ]);
  });

  it("tidak ada href ganda dan total item sesuai konfigurasi", () => {
    const hrefs = MODULES.akuntansi.nav.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(16);
  });

  it("form Beban tidak dipromosikan; Piutang & Utang menjadi halaman kerja Kas & Bank", () => {
    const hrefs = MODULES.akuntansi.nav.map((i) => i.href);
    expect(hrefs).not.toContain("/app/akuntansi/beban");
    expect(hrefs).toContain("/app/akuntansi/piutang-utang");
  });

  it("POS dan HR berkelompok per pekerjaan", () => {
    const posGroups = groupNavItems(MODULES.pos.nav);
    expect(posGroups.map((group) => group.group)).toEqual([
      "Penjualan",
      "Pengaturan penjualan",
      "Sesi & Perangkat",
    ]);
    expect(posGroups.flatMap((group) => group.items)).toHaveLength(MODULES.pos.nav.length);

    const hrGroups = groupNavItems(MODULES.hr.nav);
    expect(hrGroups.map((group) => group.group)).toEqual([
      "Karyawan & gaji",
      "Operasi harian",
    ]);
    expect(hrGroups.flatMap((group) => group.items)).toHaveLength(MODULES.hr.nav.length);
  });
});

// Kontrak sidebar Gudang mengikuti pengelompokan workflow dan semua
// tujuan yang benar-benar disediakan konfigurasi modul.
describe("navigasi gudang berkelompok (SIS-09)", () => {
  const groups = groupNavItems(MODULES.gudang.nav);

  it("menampilkan ringkasan lalu mengurutkan grup menurut frekuensi dan alur kerja", () => {
    expect(groups.map((g) => g.group)).toEqual([
      null,
      "Pengadaan",
      "Persediaan",
      "Operasi Stok",
      "Data Master",
    ]);
  });

  it("anggota tiap kelompok mengikuti jenis pekerjaan gudang", () => {
    const byGroup = new Map(groups.map((g) => [g.group, g.items.map((i) => i.href)]));
    expect(byGroup.get("Pengadaan")).toEqual([
      "/app/gudang/rekomendasi",
      "/app/gudang/purchase-request",
      "/app/gudang/pembelian",
      "/app/gudang/penerimaan",
      "/app/gudang/penerimaan/riwayat",
      "/app/gudang/retur-pembelian",
      "/app/gudang/uang-muka",
    ]);
    expect(byGroup.get("Persediaan")).toEqual([
      "/app/gudang/pergerakan",
      "/app/gudang/reservasi",
      "/app/gudang/nilai",
    ]);
    expect(byGroup.get("Operasi Stok")).toEqual([
      "/app/gudang/operasi",
      "/app/gudang/penyesuaian",
      "/app/gudang/transfer",
      "/app/gudang/opname",
    ]);
    expect(byGroup.get(null)).toEqual(["/app/gudang"]);
    expect(byGroup.get("Data Master")).toEqual([
      "/app/gudang/master-data",
      "/app/gudang/produk",
      "/app/gudang/pemasok",
      "/app/gudang/kategori-satuan",
      "/app/gudang/impor",
    ]);
  });

  it("tidak ada href ganda dan label konsisten berbahasa Indonesia", () => {
    const hrefs = MODULES.gudang.nav.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(20);
    const labels = MODULES.gudang.nav.map((i) => i.label);
    expect(labels).toContain("Permintaan pembelian");
    expect(labels).toContain("Riwayat penerimaan");
    expect(labels).not.toContain("Purchase Request");
    const masterDataIcons = groups.find((group) => group.group === "Data Master")!.items.map((i) => i.icon);
    expect(new Set(masterDataIcons).size).toBe(masterDataIcons.length);
  });
});
