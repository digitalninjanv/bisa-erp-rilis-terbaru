import { describe, expect, it } from "vitest";
import { MODULES, groupNavItems, type NavItem } from "@/lib/modules";

// A-22 Tahap K5 (UX-07): sidebar akuntansi datar tanpa kelompok diganti
// kepala kelompok tanpa mengubah rute. A-24 T2: grup "SDM & Payroll"
// keluar dari akuntansi menjadi nav modul HR sendiri, jadi kelompok
// akuntansi kini Dashboard / Kas & Bank / Buku Besar / Laporan / Setting (16 item;
// 15 sejak A-27 B7 menambah Migrasi bagan akun di Buku & Laporan).
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

  it("kelompok tampil berurutan: Dashboard, Kas & Bank, Buku Besar, Laporan, Pengaturan", () => {
    expect(groups.map((g) => g.group)).toEqual([
      "Dashboard",
      "Kas & Bank",
      "Buku Besar",
      "Laporan",
      "Pengaturan",
    ]);
  });

  it("anggota tiap kelompok persis rute yang ada", () => {
    const byGroup = new Map(groups.map((g) => [g.group, g.items.map((i) => i.href)]));
    expect(byGroup.get("Dashboard")).toEqual([
      "/app/akuntansi",
      "/app/akuntansi/riwayat",
    ]);
    expect(byGroup.get("Kas & Bank")).toEqual([
      "/app/akuntansi/bank",
      "/app/akuntansi/piutang-utang",
      "/app/akuntansi/bank#transfer-bank",
      "/app/akuntansi/bank/transfer",
      "/app/akuntansi/rekonsiliasi",
    ]);
    expect(byGroup.get("Buku Besar")).toEqual([
      "/app/akuntansi/jurnal",
      "/app/akuntansi/buku-besar",
      "/app/akuntansi/akun",
      "/app/akuntansi/aset",
    ]);
    expect(byGroup.get("Laporan")).toEqual([
      "/app/akuntansi/laporan",
      "/app/akuntansi/pajak",
      "/app/akuntansi/periode",
      "/app/akuntansi/rekonsiliasi-kontrol",
    ]);
    expect(byGroup.get("Pengaturan")).toEqual([
      "/app/akuntansi/migrasi-coa",
    ]);
  });

  it("tidak ada href ganda dan total item 16", () => {
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
      "Harian",
      "Kas & Perangkat",
      "Lainnya",
    ]);
    expect(posGroups.flatMap((group) => group.items)).toHaveLength(MODULES.pos.nav.length);

    const hrGroups = groupNavItems(MODULES.hr.nav);
    expect(hrGroups.map((group) => group.group)).toEqual([
      "Dashboard",
      "Karyawan",
      "Kesejahteraan",
      "Pengaturan",
    ]);
    expect(hrGroups.flatMap((group) => group.items)).toHaveLength(MODULES.hr.nav.length);
  });
});

// A-24 T3 (SIS-09): sidebar gudang yang dulu datar 16 item kini
// berkelompok se pola akuntansi; nol href lama berubah, satu label
// diindonesiakan, dan Mode Operasi (G1) adalah satu-satunya rute baru.
describe("navigasi gudang berkelompok (SIS-09)", () => {
  const groups = groupNavItems(MODULES.gudang.nav);

  it("kelompok tampil berurutan: Harian, Master & Stok, Pembelian, lalu tanpa grup", () => {
    expect(groups.map((g) => g.group)).toEqual(["Harian", "Master & Stok", "Pembelian", null]);
  });

  it("anggota tiap kelompok persis mandat SIS-09", () => {
    const byGroup = new Map(groups.map((g) => [g.group, g.items.map((i) => i.href)]));
    expect(byGroup.get("Harian")).toEqual([
      "/app/gudang",
      "/app/gudang/operasi",
      "/app/gudang/penerimaan",
      "/app/gudang/penyesuaian",
      "/app/gudang/transfer",
      "/app/gudang/opname",
    ]);
    expect(byGroup.get("Master & Stok")).toEqual([
      "/app/gudang/produk",
      "/app/gudang/pergerakan",
      "/app/gudang/reservasi",
      "/app/gudang/nilai",
    ]);
    expect(byGroup.get("Pembelian")).toEqual([
      "/app/gudang/purchase-request",
      "/app/gudang/pembelian",
      "/app/gudang/uang-muka",
      "/app/gudang/retur-pembelian",
      "/app/gudang/rekomendasi",
      "/app/gudang/pemasok",
    ]);
    expect(byGroup.get(null)).toEqual(["/app/gudang/impor"]);
  });

  it("semua href lama tetap ada persis; label Inggris hilang", () => {
    const hrefs = MODULES.gudang.nav.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toHaveLength(17);
    const labels = MODULES.gudang.nav.map((i) => i.label);
    expect(labels).toContain("Permintaan Pembelian");
    expect(labels).not.toContain("Purchase Request");
  });
});
