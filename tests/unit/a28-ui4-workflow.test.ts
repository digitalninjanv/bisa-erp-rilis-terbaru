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
// render statis — pola yang sama dengan pos-session-blind-close.
vi.mock("@/server/actions/purchasing", () => ({
  sendPurchaseOrderAction: async () => ({ ok: true, data: { id: "po-1", number: "PO-2026-00007" } }),
  cancelPurchaseOrderAction: async () => ({ ok: true, data: { id: "po-1", number: "PO-2026-00007" } }),
}));
vi.mock("@/server/actions/hr/payroll", () => ({
  runPayrollAction: async () => ({ ok: false, code: "VALIDATION", message: "mock" }),
}));

import { PurchaseOrderActions } from "@/components/gudang/purchase-order-actions";
import {
  PayrollPostedPanel,
  PayrollWizard,
  type PayrollWizardStaff,
} from "@/components/akuntansi/payroll-wizard";
import {
  groupMovementsByDocument,
  type MovementGroupRow,
} from "@/lib/gudang/movement-groups";

// A-28 UI-4 (UX-C01, C02, C03, C06): bukti render untuk workflow
// lintas modul — jalan terima PO Draf, tautan nomor run payroll,
// tanda periode terproses di wizard, dan pengelompokan pergerakan
// stok per dokumen asal. Jalur domain "Kirim & terima" (transisi
// terkirim + audit + penerimaan) dibuktikan di
// tests/integration/a28-ui4-po-send-receive.test.ts.

describe("UX-C01 — aksi PO Draf: Kirim & terima di samping Kirim PO", () => {
  it("status draft menampilkan Kirim & terima, Kirim PO, dan Batalkan PO", () => {
    const html = renderToStaticMarkup(
      createElement(PurchaseOrderActions, { id: "po-1", number: "PO-2026-00007", status: "draft" }),
    );
    expect(html).toContain("Kirim &amp; terima");
    expect(html).toContain("Kirim PO");
    expect(html).toContain("Batalkan PO");
  });

  it("status sent tidak lagi menampilkan aksi kirim apa pun, hanya Batalkan PO", () => {
    const html = renderToStaticMarkup(
      createElement(PurchaseOrderActions, { id: "po-1", number: "PO-2026-00007", status: "sent" }),
    );
    expect(html).not.toContain("Kirim &amp; terima");
    expect(html).not.toContain("Kirim PO");
    expect(html).toContain("Batalkan PO");
  });

  it("status partial/received tidak menampilkan aksi kirim maupun batal", () => {
    for (const status of ["partial", "received"]) {
      const html = renderToStaticMarkup(
        createElement(PurchaseOrderActions, { id: "po-1", number: "PO-2026-00007", status }),
      );
      expect(html).not.toContain("Kirim &amp; terima");
      expect(html).not.toContain("Kirim PO");
      expect(html).not.toContain("Batalkan PO");
    }
  });
});

const STAFF: PayrollWizardStaff[] = [
  {
    id: "emp-1",
    code: "K-001",
    name: "Sari Uji",
    position: "Kasir",
    baseSalary: "5000000",
    allowances: "0",
    deductions: "0",
    isActive: true,
    nik: "3200000000000001",
    npwp: null,
    ptkpStatus: "TK/0",
  },
];

describe("UX-C06 — wizard menandai periode yang sudah diproses di langkah 1", () => {
  it("periode cocok dengan run reguler non-void: tanda + tautan run tampil", () => {
    const html = renderToStaticMarkup(
      createElement(PayrollWizard, {
        defaultPeriod: "2026-11",
        staff: STAFF,
        processedRuns: [{ id: "run-1", number: "PRL-2026-00001", period: "2026-11" }],
      }),
    );
    expect(html).toContain("Sudah diproses — PRL-2026-00001");
    expect(html).toContain('href="/app/akuntansi/payroll/run-1"');
    expect(html).toContain("Buka run PRL-2026-00001");
  });

  it("tanpa run pada periode terpilih: tidak ada tanda", () => {
    const other = renderToStaticMarkup(
      createElement(PayrollWizard, {
        defaultPeriod: "2026-11",
        staff: STAFF,
        processedRuns: [{ id: "run-1", number: "PRL-2026-00001", period: "2026-10" }],
      }),
    );
    expect(other).not.toContain("Sudah diproses");
    const none = renderToStaticMarkup(
      createElement(PayrollWizard, { defaultPeriod: "2026-11", staff: STAFF }),
    );
    expect(none).not.toContain("Sudah diproses");
  });
});

describe("UX-C02 — panel selesai wizard menautkan nomor run", () => {
  it("tautan utama berbunyi 'Buka run PRL-…' menuju detail run", () => {
    const html = renderToStaticMarkup(
      createElement(PayrollPostedPanel, {
        posted: { id: "run-1", number: "PRL-2026-00001", totalNet: 5000000, employees: 3 },
        onReset: () => undefined,
      }),
    );
    expect(html).toContain("Buka run PRL-2026-00001");
    expect(html).toContain('href="/app/akuntansi/payroll/run-1"');
    expect(html).not.toContain("Buka payroll &amp; bayar");
  });
});

describe("UX-C03 — groupMovementsByDocument", () => {
  const row = (partial: Partial<MovementGroupRow>): MovementGroupRow => ({
    referenceType: null,
    referenceId: null,
    referenceNumber: null,
    ...partial,
  });

  it("baris berurutan dari dokumen yang sama menjadi satu grup", () => {
    const groups = groupMovementsByDocument([
      row({ referenceType: "stock_receipt", referenceId: "rcv-1", referenceNumber: "RCV-2026-00001" }),
      row({ referenceType: "stock_receipt", referenceId: "rcv-1", referenceNumber: "RCV-2026-00001" }),
      row({ referenceType: "stock_receipt", referenceId: "rcv-2", referenceNumber: "RCV-2026-00002" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].referenceNumber).toBe("RCV-2026-00001");
    expect(groups[1].rows).toHaveLength(1);
  });

  it("dokumen yang sama tetapi tidak berurutan tidak digabung paksa", () => {
    const groups = groupMovementsByDocument([
      row({ referenceType: "stock_receipt", referenceId: "rcv-1", referenceNumber: "RCV-1" }),
      row({ referenceType: "opname", referenceId: "opn-1", referenceNumber: "OPN-1" }),
      row({ referenceType: "stock_receipt", referenceId: "rcv-1", referenceNumber: "RCV-1" }),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("referensi tanpa id (stok awal) berkelompok lewat nomor; tanpa referensi selalu sendiri", () => {
    const groups = groupMovementsByDocument([
      row({ referenceType: "opening", referenceId: null, referenceNumber: "OPEN-2026" }),
      row({ referenceType: "opening", referenceId: null, referenceNumber: "OPEN-2026" }),
      row({}),
      row({}),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
    expect(groups[2].rows).toHaveLength(1);
    expect(groups[1].key).not.toBe(groups[2].key);
  });

  it("daftar kosong menghasilkan nol grup", () => {
    expect(groupMovementsByDocument([])).toEqual([]);
  });
});
