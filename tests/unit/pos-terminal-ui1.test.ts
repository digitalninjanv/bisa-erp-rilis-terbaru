import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: () => undefined, error: () => undefined },
}));

import {
  TERMINAL_SHORTCUT_HELP,
  resolveTerminalShortcut,
} from "@/lib/pos/terminal-shortcuts";
import { applyMoneyEdit } from "@/lib/money-input";
import { usePaymentPlan } from "@/components/pos/terminal/use-payment-plan";
import { ProductCatalog } from "@/components/pos/terminal/product-catalog";
import { PaymentPanel } from "@/components/pos/payment-panel";
import { POS_DISPLAY_DEFAULTS } from "@/components/pos/pos-display";
import type {
  Method,
  PaymentEntry,
  ProductOption,
} from "@/components/pos/terminal-types";

// A-28 UI-1 (UX-B01..B04, B07): bukti unit untuk keyboard & workflow
// POS — pemetaan pintasan murni, paritas nilai tender MoneyInput,
// gerbang sisa campuran pada rencana pembayaran, dan render awal
// katalog/panel (placeholder jujur + nominal tampil terformat).

const TUNAI: Method = { id: "m-tunai", code: "CASH", name: "Tunai", type: "cash", instructions: null };
const QRIS: Method = { id: "m-qris", code: "QRIS", name: "QRIS", type: "qris", instructions: null };
const UTANG: Method = { id: "m-utang", code: "CREDIT", name: "Utang / Tempo", type: "credit", instructions: null };
const BANK: Method = { id: "m-bank", code: "BANK", name: "Transfer Bank", type: "bank", instructions: null };
const methodById = new Map([TUNAI, QRIS, UTANG].map((m) => [m.id, m]));

function entry(amount: string, tendered = ""): PaymentEntry {
  return { amount, tendered, reference: "" };
}

describe("resolveTerminalShortcut — peta pintasan terminal", () => {
  it("memetakan tombol fungsi & Alt+M ke aksi yang benar", () => {
    expect(resolveTerminalShortcut({ key: "F2" })).toBe("focus-search");
    expect(resolveTerminalShortcut({ key: "F4" })).toBe("focus-tendered");
    expect(resolveTerminalShortcut({ key: "F10" })).toBe("exact-cash");
    expect(resolveTerminalShortcut({ key: "F8" })).toBe("hold");
    expect(resolveTerminalShortcut({ key: "F9" })).toBe("pay");
    expect(resolveTerminalShortcut({ key: "m", altKey: true })).toBe("toggle-mode");
    expect(resolveTerminalShortcut({ key: "M", altKey: true })).toBe("toggle-mode");
    expect(resolveTerminalShortcut({ key: "c", altKey: true })).toBe("clear-cart");
    expect(resolveTerminalShortcut({ key: "C", altKey: true })).toBe("clear-cart");
  });

  it("menolak tombol browser, modifier Ctrl/Cmd, dan tombol biasa", () => {
    expect(resolveTerminalShortcut({ key: "F5" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "F11" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "F12" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "F7" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "F9", ctrlKey: true })).toBeNull();
    expect(resolveTerminalShortcut({ key: "F2", metaKey: true })).toBeNull();
    expect(resolveTerminalShortcut({ key: "k", ctrlKey: true })).toBeNull();
    expect(resolveTerminalShortcut({ key: "a" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "Enter" })).toBeNull();
    expect(resolveTerminalShortcut({ key: "m" })).toBeNull();
  });

  it("daftar bantuan kasir memuat semua pintasan yang ditangani handler", () => {
    const keys = TERMINAL_SHORTCUT_HELP.map((row) => row.keys);
    for (const expected of ["F2", "F4", "F10", "F8", "F9", "Alt+M"]) {
      expect(keys).toContain(expected);
    }
  });
});

describe("paritas tender MoneyInput — nilai terkirim tidak berubah semantik", () => {
  /** Ketik seperti kasir: satu karakter per kejadian, di akhir teks. */
  function typeText(digits: string): { text: string; value: string } {
    let text = "";
    let value = "";
    for (const ch of digits) {
      const outcome = applyMoneyEdit(text, text + ch);
      if (outcome.kind !== "value") throw new Error(`ketikan '${ch}' tidak menghasilkan nilai`);
      text = outcome.text;
      value = outcome.value;
    }
    return { text, value };
  }

  it("mengetik 72000 tampil '72.000' dan bernilai persis 72000", () => {
    const { text, value } = typeText("72000");
    expect(text).toBe("72.000");
    expect(Number(value)).toBe(72_000);
  });

  it("mengetik 50000 tampil '50.000' dan bernilai persis 50000", () => {
    const { text, value } = typeText("50000");
    expect(text).toBe("50.000");
    expect(Number(value)).toBe(50_000);
  });

  it("nilai kanonik tersimpan terbaca Number(...) sama dengan angka mentah lama", () => {
    // Bentuk lama: entries menyimpan "50000"; bentuk baru: "50000.0000".
    expect(Number("50000.0000")).toBe(Number("50000"));
    expect(Number("4000.0000")).toBe(4_000);
  });
});

describe("usePaymentPlan — gerbang sisa campuran (UX-B07)", () => {
  function plan(entries: Record<string, PaymentEntry>, total: number) {
    const box: { value: ReturnType<typeof usePaymentPlan> | null } = { value: null };
    function Probe() {
      box.value = usePaymentPlan({
        mode: "mixed",
        entries,
        methodById,
        total,
        singleMethod: TUNAI.id,
        single: TUNAI,
        isCreditSingle: false,
        cashTendered: 0,
        debtMethod: { id: UTANG.id, name: UTANG.name },
      });
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    if (!box.value) throw new Error("hook tidak terpanggil");
    return box.value;
  }

  it("sisa penuh tanpa alokasi → terblokir", () => {
    const result = plan({}, 72_000);
    expect(result.outstanding).toBe(72_000);
    expect(result.mixedShortfall).toBe(true);
  });

  it("tertutup sebagian → tetap terblokir sebesar sisa", () => {
    const result = plan({ [TUNAI.id]: entry("50000.0000") }, 72_000);
    expect(result.outstanding).toBe(22_000);
    expect(result.mixedShortfall).toBe(true);
  });

  it("tertutup penuh → tidak terblokir", () => {
    const result = plan(
      { [TUNAI.id]: entry("50000.0000"), [QRIS.id]: entry("22000.0000") },
      72_000,
    );
    expect(result.outstanding).toBe(0);
    expect(result.mixedShortfall).toBe(false);
  });

  it("sisa yang dialokasikan ke baris Utang tidak terblokir (alokasi server)", () => {
    const result = plan(
      { [TUNAI.id]: entry("50000.0000"), [UTANG.id]: entry("1000.0000") },
      72_000,
    );
    // Teralokasi 51.000 (tunai 50.000 + utang 1.000); sisa 21.000 akan
    // dialokasikan server ke metode kredit — tombol tidak terblokir.
    expect(result.outstanding).toBe(21_000);
    expect(result.mixedShortfall).toBe(false);
  });
});

const PRODUCTS: ProductOption[] = [
  { id: "p1", name: "Indomie Goreng", sku: "SKU-1", barcode: "8990001", salePrice: "3800", stock: 10, trackStock: true, unitCode: "PCS" },
  { id: "p2", name: "Indomie Soto", sku: "SKU-2", barcode: "8990002", salePrice: "3700", stock: 5, trackStock: true, unitCode: "PCS" },
];

describe("ProductCatalog — placeholder jujur & bantuan pintasan (UX-B01/B03)", () => {
  const html = renderToStaticMarkup(
    createElement(ProductCatalog, {
      searchRef: { current: null },
      search: "",
      setSearch: () => undefined,
      products: PRODUCTS,
      searching: false,
      page: 1,
      pageFull: false,
      goToPage: () => undefined,
      scanBarcode: async () => null,
      addProduct: () => undefined,
      warehouses: [{ id: "g1", name: "Gudang Utama" }],
      categories: [{ id: "c1", name: "Minuman" }],
      selectedWarehouse: "g1",
      setSelectedWarehouse: () => undefined,
      selectedCategory: "",
      setSelectedCategory: () => undefined,
      setReservationId: () => undefined,
      reservations: [],
      reservationId: null,
      applyReservation: async () => undefined,
      sessionOpen: true,
      posOfflineEnabled: true,
      online: true,
      queuedCount: 2,
      oldestQueuedAt: "2026-05-02T02:00:00.000Z",
      syncing: false,
      syncOfflineQueue: async () => undefined,
      display: POS_DISPLAY_DEFAULTS,
      updateDisplay: () => undefined,
      resetDisplay: () => undefined,
      fullscreen: false,
      setFullscreenOverride: () => undefined,
    }),
  );

  it("placeholder menjanjikan F2 yang kini nyata dan tidak terpotong", () => {
    // Teks dipendekkan agar tidak terpotong di kolom cari desktop;
    // janji pintasan F2 tetap ada.
    expect(html).toContain("Pindai barcode / cari produk (F2)");
  });

  it("bantuan pintasan tersedia lewat menu terminal", () => {
    // Sejak terminal dirapikan, bantuan pindah ke menu agar toolbar
    // tidak penuh; pemicunya tetap punya nama aksesibel.
    expect(html).toContain('aria-label="Menu POS lainnya"');
  });

  it("menampilkan umur transaksi tertua pada antrean offline", () => {
    expect(html).toContain("Tertua");
    expect(html).toContain("Waktu transaksi tertua yang masih menunggu sinkronisasi (WIB)");
  });

  it("render awal tanpa sorotan panah (Enter = hasil pertama seperti dulu)", () => {
    expect(html).not.toContain("data-highlighted");
    expect(html).toContain('data-catalog-index="0"');
    expect(html).toContain('data-catalog-index="1"');
  });
});

describe("PaymentPanel — tender terformat & label sisa (UX-B04/B07)", () => {
  const creditStub = {
    creditOpen: false,
    setCreditOpen: () => undefined,
    creditNumber: "",
    setCreditNumber: () => undefined,
    creditInfo: null,
    creditAmount: "",
    setCreditAmount: () => undefined,
    creditBusy: false,
    appliedCredit: undefined,
    lookupCredit: async () => undefined,
    applyCredit: async () => undefined,
    removeCredit: () => undefined,
    resetCredit: () => undefined,
  } as unknown as Parameters<typeof PaymentPanel>[0]["credit"];

  function renderPanel(overrides: Partial<Parameters<typeof PaymentPanel>[0]>) {
    return renderToStaticMarkup(
      createElement(PaymentPanel, {
        companyName: "Bisa Minimarket",
        mode: "mixed",
        setMode: () => undefined,
        methods: [TUNAI, QRIS],
        single: TUNAI,
        singleMethod: TUNAI.id,
        setSingleMethod: () => undefined,
        entries: {},
        setEntries: () => undefined,
        total: 72_000,
        change: 0,
        isCreditSingle: false,
        debtMethod: null,
        debtActive: false,
        debtAmount: 0,
        qrisImage: null,
        nonCashNeedsConfirm: false,
        nonCashConfirmed: false,
        setNonCashConfirmedFor: () => undefined,
        creditMethod: null,
        credit: creditStub,
        customer: null,
        setCustomer: () => undefined,
        customerQuery: "",
        setCustomerQuery: () => undefined,
        customerResults: [],
        customerSearching: false,
        quickAddOpen: false,
        setQuickAddOpen: () => undefined,
        quickName: "",
        setQuickName: () => undefined,
        quickPhone: "",
        setQuickPhone: () => undefined,
        quickBusy: false,
        quickAddCustomer: async () => undefined,
        dueDate: "",
        setDueDate: () => undefined,
        outstanding: 72_000,
        mixedPlan: { appliedTotal: 0, changeTotal: 0, overpaid: [] },
        fillDebtRemainder: () => undefined,
        cart: [{ productId: "p1", qty: 1 }],
        serialIncomplete: false,
        quoteError: null,
        quote: null,
        setQuoteNonce: () => undefined,
        payDisabled: true,
        payLabel: "Bayar — sisa Rp 72.000",
        checkout: async () => undefined,
        setHoldOpen: () => undefined,
        sessionOpen: true,
        lastSale: null,
        ...overrides,
      }),
    );
  }

  it("mode campuran: tombol Bayar nonaktif dan label menyatakan sisa", () => {
    const html = renderPanel({});
    expect(html).toContain("Bayar — sisa Rp 72.000");
    // Tombol Bayar adalah satu-satunya tombol nonaktif wajib di panel ini.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Bayar — sisa Rp 72\.000<\/button>/);
  });

  it("nominal campuran tersimpan kanonik tampil terformat '50.000'", () => {
    const html = renderPanel({
      entries: { [TUNAI.id]: entry("50000.0000", "50000.0000") },
      outstanding: 22_000,
      mixedPlan: { appliedTotal: 50_000, changeTotal: 0, overpaid: [] },
      payLabel: "Bayar — sisa Rp 22.000",
    });
    expect(html).toContain('value="50.000"');
    expect(html).not.toContain('value="50000"');
  });

  it("hanya dua metode utama yang tampil; metode sekunder masuk disclosure", () => {
    const html = renderPanel({
      mode: "single",
      methods: [TUNAI, QRIS, BANK],
      debtMethod: UTANG,
      debtActive: false,
      debtAmount: 0,
    });
    expect(html).toContain('title="Tunai"');
    expect(html).toContain('title="QRIS"');
    expect(html).toContain('aria-label="Opsi pembayaran lain"');
    expect(html).not.toContain('title="Transfer Bank"');
    expect(html).not.toContain('title="Utang / Tempo"');
  });

  it("kolom tunai memakai placeholder netral, bukan nominal yang terlihat terisi", () => {
    const html = renderPanel({ mode: "single", total: 72_000, payDisabled: false, payLabel: "Bayar Rp 72.000" });
    expect(html).toContain('placeholder="0"');
    expect(html).not.toContain("Pas: 72.000");
  });

  it("mode tunggal: kolom Diterima adalah MoneyInput ber-id target F4, tampil terformat", () => {
    const html = renderPanel({
      mode: "single",
      entries: { [TUNAI.id]: entry("4000", "50000.0000") },
      total: 4_000,
      outstanding: 0,
      payDisabled: false,
      payLabel: "Bayar Rp 4.000",
    });
    expect(html).toContain('id="pos-tendered-input"');
    expect(html).toContain('value="50.000"');
  });

  it("panel embedded menyediakan tombol tutup sendiri tanpa close bawaan dialog", () => {
    const html = renderPanel({
      mode: "single",
      embedded: true,
      onClose: () => undefined,
    });
    expect(html).toContain('aria-label="Tutup pembayaran"');
  });

  it("aksi nota terakhir pada panel pembayaran memakai printToken tanpa memaksa salinan=1", () => {
    const html = renderPanel({
      mode: "single",
      lastSale: { id: "sale-123", number: "INV-2026-00002", receiptToken: "tok-abc" },
      canReprint: true,
    });
    expect(html).toContain("Cetak / lihat nota INV-2026-00002");
    expect(html).toContain("printToken=tok-abc");
    expect(html).not.toContain("salinan=1");
  });
});
