import { describe, expect, it } from "vitest";
import {
  QUICK_INPUT_ITEMS,
  resolveQuickInputItem,
  type QuickInputVisibility,
} from "@/lib/quick-input";

/**
 * A-22 Tahap K4 (UX-06): panel Input Cepat harus JUJUR — kartu yang
 * membuka modal Catat Transaksi berperilaku modal; kartu yang
 * menavigasi ke halaman tugasnya wajib bernama halaman tujuannya
 * (pageName) agar pemanggil menggambar penanda "membuka halaman".
 * Jurnal Manual TIDAK boleh menjadi modal: aturan proyek menetapkan
 * jurnal manual memakai formulir halaman penuh jurnal/baru.
 */

const fullAccess: QuickInputVisibility = {
  canPost: true,
  canPay: true,
  canPayroll: true,
  showPosSession: true,
};
const payOnly: QuickInputVisibility = {
  canPost: false,
  canPay: true,
  canPayroll: false,
  showPosSession: false,
};

const byLabel = (label: string) => {
  const item = QUICK_INPUT_ITEMS.find((row) => row.label === label);
  if (!item) throw new Error(`item tidak ditemukan: ${label}`);
  return item;
};

describe("QUICK_INPUT_ITEMS", () => {
  it("memuat 9 kartu seperti panel hari ini", () => {
    expect(QUICK_INPUT_ITEMS.map((item) => item.label)).toEqual([
      "Penjualan Tunai",
      "Catat Beban",
      "Jurnal Manual",
      "Transfer Kas & Bank",
      "Setoran Modal",
      "Bayar Utang",
      "Terima Piutang",
      "Proses Payroll",
      "Setor / Tarik Kas",
    ]);
  });

  it("setiap kartu yang bisa dirender sebagai tautan punya nama halaman tujuan", () => {
    for (const item of QUICK_INPUT_ITEMS) {
      if (item.href) {
        expect(item.pageName, `${item.label} wajib bernama halaman`).toBeTruthy();
      }
    }
  });

  it("lima jenis Catat Transaksi berk quickKind; empat tugas halaman tidak", () => {
    const modalKinds = QUICK_INPUT_ITEMS.filter((item) => item.quickKind).map((item) => item.label);
    expect(modalKinds).toEqual([
      "Penjualan Tunai",
      "Catat Beban",
      "Transfer Kas & Bank",
      "Bayar Utang",
      "Terima Piutang",
    ]);
  });
});

describe("resolveQuickInputItem", () => {
  it("pemegang accounting.post: lima jenis membuka modal", () => {
    for (const label of ["Penjualan Tunai", "Catat Beban", "Transfer Kas & Bank", "Bayar Utang", "Terima Piutang"]) {
      const resolved = resolveQuickInputItem(byLabel(label), fullAccess);
      expect(resolved?.mode, label).toBe("modal");
    }
  });

  it("Jurnal Manual selalu menavigasi ke formulir halaman penuh — tidak pernah modal", () => {
    const resolved = resolveQuickInputItem(byLabel("Jurnal Manual"), fullAccess);
    expect(resolved).toEqual({ mode: "link", href: "/app/akuntansi/jurnal/baru" });
  });

  it("tugas halaman (Setoran Modal, Proses Payroll, Setor/Tarik Kas) selalu tautan bernama", () => {
    expect(resolveQuickInputItem(byLabel("Setoran Modal"), fullAccess)?.mode).toBe("link");
    expect(byLabel("Setoran Modal").pageName).toBe("Kas & bank");
    expect(resolveQuickInputItem(byLabel("Proses Payroll"), fullAccess)?.mode).toBe("link");
    expect(byLabel("Proses Payroll").pageName).toBe("Payroll");
    expect(resolveQuickInputItem(byLabel("Setor / Tarik Kas"), fullAccess)?.mode).toBe("link");
    expect(byLabel("Setor / Tarik Kas").pageName).toBe("Sesi kasir POS");
  });

  it("tanpa accounting.post: Bayar Utang & Terima Piutang jatuh ke tautan halaman piutang-utang", () => {
    expect(resolveQuickInputItem(byLabel("Bayar Utang"), payOnly)).toEqual({
      mode: "link",
      href: "/app/akuntansi/piutang-utang?tab=utang",
    });
    expect(resolveQuickInputItem(byLabel("Terima Piutang"), payOnly)).toEqual({
      mode: "link",
      href: "/app/akuntansi/piutang-utang",
    });
  });

  it("kartu tak terlihat untuk peran ini mengembalikan null", () => {
    expect(resolveQuickInputItem(byLabel("Penjualan Tunai"), payOnly)).toBeNull();
    expect(resolveQuickInputItem(byLabel("Proses Payroll"), payOnly)).toBeNull();
  });
});
