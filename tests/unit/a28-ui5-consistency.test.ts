import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }),
}));
// Aksi server di-mock agar rantai impornya (sesi/db) tidak masuk
// render statis — pola yang sama dengan a28-ui4-workflow.
vi.mock("@/server/actions/inventory/penerimaan", () => ({
  receiveStockAction: async () => ({ ok: true, data: undefined }),
  voidReceiptAction: async () => ({ ok: true, data: undefined }),
  voidStockDocumentAction: async () => ({ ok: true, data: undefined }),
}));
vi.mock("@/server/actions/inventory/uang-muka", () => ({
  listSupplierPurchaseAdvancesAction: async () => ({ ok: true, data: [] }),
  createPurchaseAdvanceAction: async () => ({ ok: true, data: undefined }),
  voidPurchaseAdvanceAction: async () => ({ ok: true, data: undefined }),
}));
vi.mock("@/server/actions/purchasing", () => ({
  listOpenPurchaseOrdersAction: async () => ({ ok: true, data: [] }),
  savePurchaseOrderAction: async () => ({ ok: true, data: undefined }),
}));
vi.mock("@/server/actions/inventory/produk", () => ({
  productsStockAction: async () => ({ ok: true, data: [] }),
  searchInventoryProductsAction: async () => ({ ok: true, data: [] }),
}));
vi.mock("@/server/actions/pos", () => ({
  voidSaleAction: async () => ({ ok: true, data: undefined }),
}));
vi.mock("@/server/actions/accounting/akun-pemetaan", () => ({
  saveAccountAction: async () => ({ ok: true, data: undefined }),
  deleteAccountAction: async () => ({ ok: true, data: undefined }),
}));
vi.mock("@/server/actions/quick-entry", () => ({
  deleteQuickEntryDraftAction: async () => ({ ok: true, data: undefined }),
}));

import { ReceiptForm } from "@/components/gudang/receipt-form";
import { PurchaseOrderForm } from "@/components/gudang/purchase-order-form";
import { ReceiptRowActions } from "@/components/gudang/void-buttons";
import { SaleRowActions } from "@/components/pos/sale-row-actions";
import {
  AccountRowActions,
  accountDeleteBlockReason,
} from "@/components/akuntansi/account-row-actions";
import { QuickInputPanel } from "@/components/akuntansi/quick-input-panel";
import type { AccountImpactSummary, AccountInput } from "@/components/akuntansi/account-form";

// A-28 UI-5 — poles konsistensi (UX-A02, A03, A04, A05, B05):
// bukti render untuk judul ganda yang dibuang, pola aksi baris
// A-25, panel Input Cepat terlipat, dan penjaga pola sumber untuk
// jargon Status sistem & fokus awal opname. Fokus nyata opname
// dibuktikan empiris di peramban (activeElement) pada bukti visual
// tahap ini — efek tidak terlihat pada render statis.

describe("UX-A02 — pita formulir Gudang tidak lagi menggandakan judul halaman", () => {
  it("Penerimaan: hanya baris aksi (tombol Penerimaan baru), tanpa h2 judul halaman", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptForm, {
        warehouses: [{ id: "wh-1", name: "Gudang Utama" }],
        suppliers: [],
        paymentAccounts: [],
        defaultWarehouseId: "wh-1",
        today: "2026-11-07",
      }),
    );
    expect(html).toContain("Penerimaan baru");
    expect(html).not.toContain(">Penerimaan barang<");
  });

  it("PO: hanya baris aksi (tombol PO baru), tanpa h2 judul halaman", () => {
    const html = renderToStaticMarkup(
      createElement(PurchaseOrderForm, {
        suppliers: [{ id: "sup-1", name: "CV Aneka Jaya" }],
        today: "2026-11-07",
      }),
    );
    expect(html).toContain("PO baru");
    expect(html).not.toContain(">Pesanan pembelian (PO)<");
  });
});

describe("UX-A05 — Riwayat POS: aksi utama berlabel + menu ⋯", () => {
  it("Cetak nota tampil sebagai tautan berlabel ke nota salinan; ikon-ikon lama hilang", () => {
    const html = renderToStaticMarkup(
      createElement(SaleRowActions, {
        saleId: "sale-1",
        number: "INV-2026-00001",
        status: "completed",
        canVoid: true,
        canReturn: true,
      }),
    );
    expect(html).toContain("Cetak nota");
    expect(html).toContain("/app/pos/nota/sale-1?salinan=1");
    expect(html).toContain("Aksi lain untuk transaksi INV-2026-00001");
    // Pola lama: tombol ikon tanpa label dengan title per ikon.
    expect(html).not.toContain('title="Void transaksi"');
    expect(html).not.toContain('title="Cetak faktur A4"');
    expect(html).not.toContain('title="Retur"');
  });

  it("transaksi ditahan tetap bisa dicetak ulang, tanpa menu void/retur yang selalu gagal", () => {
    const html = renderToStaticMarkup(
      createElement(SaleRowActions, {
        saleId: "sale-2",
        number: "INV-2026-00002",
        status: "held",
        canVoid: true,
        canReturn: true,
      }),
    );
    expect(html).toContain("Cetak nota");
    expect(html).toContain("Aksi lain untuk transaksi INV-2026-00002");
  });
});

describe("UX-A05 — Penerimaan: Cetak GRN berlabel + Batalkan di menu ⋯", () => {
  it("baris terposting ber-manage: tautan Cetak GRN + pemicu menu tampil", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptRowActions, { id: "rcv-1", number: "RCV-2026-00001", canVoid: true }),
    );
    expect(html).toContain("Cetak GRN");
    expect(html).toContain("/app/gudang/penerimaan/rcv-1/cetak");
    expect(html).toContain("Aksi lain untuk penerimaan RCV-2026-00001");
    // Tombol "Batalkan" terbuka ala lama tidak ada lagi.
    expect(html).not.toContain(">Batalkan<");
  });

  it("tanpa hak batal: hanya Cetak GRN, tanpa tombol menu kosong", () => {
    const html = renderToStaticMarkup(
      createElement(ReceiptRowActions, { id: "rcv-1", number: "RCV-2026-00001", canVoid: false }),
    );
    expect(html).toContain("Cetak GRN");
    expect(html).not.toContain("Aksi lain untuk penerimaan");
  });
});

const baseAccount: AccountInput = {
  id: "acc-1",
  code: "11099",
  name: "Kas Kecil Cadangan",
  type: "asset",
  normalBalance: "debit",
  isActive: true,
};

const baseImpact: AccountImpactSummary = {
  balance: "0",
  journalLineCount: null,
  mappingLabels: [],
  paymentMethods: [],
  discountGroupNames: [],
  childrenCount: null,
  isSystem: false,
  partial: true,
};

describe("UX-A05 — Bagan akun: Hapus masuk menu ⋯, nonaktif berpenjelasan untuk akun terikat", () => {
  it("alasan blokir: akun sistem & akun berinduk terjelaskan; akun bebas null", () => {
    expect(accountDeleteBlockReason({ isSystem: true, hasChildren: false })).toContain("Akun sistem");
    expect(accountDeleteBlockReason({ isSystem: false, hasChildren: true })).toContain("induk sub-akun");
    expect(accountDeleteBlockReason({ isSystem: true, hasChildren: true })).toContain("Akun sistem");
    expect(accountDeleteBlockReason({ isSystem: false, hasChildren: false })).toBeNull();
  });

  it("render baris: tombol Ubah terlihat + pemicu menu ⋯; tidak ada tombol Hapus terbuka", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRowActions, {
        account: baseAccount,
        parents: [],
        impact: baseImpact,
        canManage: true,
        hasChildren: false,
      }),
    );
    expect(html).toContain("Ubah");
    expect(html).toContain("Aksi untuk akun 11099 Kas Kecil Cadangan");
    expect(html).not.toContain(">Hapus<");
  });

  it("peran lihat-saja: tanpa tombol Ubah, menu navigasi tetap ada", () => {
    const html = renderToStaticMarkup(
      createElement(AccountRowActions, {
        account: baseAccount,
        parents: [],
        impact: baseImpact,
        canManage: false,
        hasChildren: false,
      }),
    );
    expect(html).not.toContain(">Ubah<");
    expect(html).toContain("Aksi untuk akun 11099 Kas Kecil Cadangan");
  });
});

describe("UX-A03 — Input Cepat terlipat bawaan di beranda Akuntansi", () => {
  it("keadaan awal: kepala panel + hitungan jalan pintas saja, kartu tidak dirender", () => {
    const html = renderToStaticMarkup(
      createElement(QuickInputPanel, {
        canPost: true,
        canPay: true,
        canPayroll: true,
        showPosSession: true,
      }),
    );
    expect(html).toContain("Input Cepat");
    expect(html).toContain("jalan pintas");
    expect(html).toContain('aria-expanded="false"');
    // Kartu jalan pintas (label item) belum tampil sebelum dibuka.
    expect(html).not.toContain("Penjualan Tunai");
    expect(html).not.toContain("Proses Payroll");
  });
});

describe("UX-A04 & UX-B05 — penjaga pola sumber", () => {
  it("Status sistem: nama env tidak lagi tampil sebagai teks utama bergaya '(env …)'", () => {
    const source = readFileSync("src/app/app/pengaturan/status/page.tsx", "utf8");
    expect(source).not.toContain("(env");
    expect(source).not.toContain("Direktori manifest:");
    // Detail teknis tetap tersedia — di area terlipat.
    expect(source).toContain("Detail teknis");
    expect(source).toContain("BISA_BACKUP_MAX_AGE_HOURS");
  });

  it("Opname: ProductPicker dipanggil dengan autoFocus (pola Mode Operasi)", () => {
    const form = readFileSync("src/components/gudang/opname-form.tsx", "utf8");
    expect(form).toContain("scanMode autoFocus");
    const picker = readFileSync("src/components/gudang/product-picker.tsx", "utf8");
    expect(picker).toContain("if (autoFocus) inputRef.current?.focus()");
  });
});
