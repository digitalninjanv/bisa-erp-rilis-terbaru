import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  branches,
  companySettings,
  customers,
  paymentMethods,
  saleLines,
  salePayments,
  sales,
  user,
  warehouses,
} from "@/db/schema";
import { adminDb } from "@/db/admin";

// A-28 UI-2 (UX-D01/D02/D03/D05) — permukaan cetak:
//  - nota membaca kop/logo/kaki KUSTOM dari mesin cetak (dulu teks
//    kop hanya dari sana tetapi saklar kasir/PPN masih dari kolom
//    warisan; kini semua dari print settings);
//  - saklar elemen (kasir, PPN, pelanggan, sesi, merek) benar-benar
//    mengubah render nota;
//  - faktur penjualan A4 memakai data penjualan yang sama: total &
//    PPN identik dengan struk, DPP = total − PPN, kop memuat NPWP,
//    label tanda tangan faktur dari pengaturan.
// Fixture ter-commit di perusahaan uji tersendiri (aa71) karena
// halaman membaca lewat withCompany sungguhan; dibersihkan di
// afterAll. Pola sama dengan H-POS-04/05 (pos-session-close-hardening).

const ORG = "01900000-0000-7000-8000-00000000aa71";
const KASIR = "kasir-uji-ui2";
const SESSION_ID = "01900000-0000-7000-8000-000000000771";
const SALE_ID = "01900000-0000-7000-8000-000000000772";
const CUSTOMER_ID = "01900000-0000-7000-8000-000000000773";
const PRODUCT_ID = "01900000-0000-7000-8000-000000000774";

vi.mock("@/lib/session", () => ({
  requirePermissionPage: async () => ({
    user: { id: KASIR, name: "Rani Kasir" },
    company: { id: ORG, name: "Uji Cetak UI-2" },
  }),
  requirePermission: async () => ({
    company: { id: ORG },
    user: { id: KASIR },
    role: "owner",
  }),
}));

async function cleanupFixture() {
  await adminDb.delete(sales).where(eq(sales.companyId, ORG));
  await adminDb.delete(customers).where(eq(customers.companyId, ORG));
  await adminDb.delete(paymentMethods).where(eq(paymentMethods.companyId, ORG));
  await adminDb.delete(warehouses).where(eq(warehouses.companyId, ORG));
  await adminDb.delete(branches).where(eq(branches.companyId, ORG));
  await adminDb.delete(companySettings).where(eq(companySettings.companyId, ORG));
  await adminDb.delete(user).where(eq(user.id, KASIR));
}

async function setPrintSettings(patch: Partial<typeof companySettings.$inferInsert>) {
  await adminDb
    .update(companySettings)
    .set(patch)
    .where(eq(companySettings.companyId, ORG));
}

const BASE_PRINT = {
  printTemplate: "modern",
  printLogoUrl: "https://example.com/logo-ui2.png",
  printAccentColor: "#111827",
  printFont: "sans",
  printHeaderText: "KOP-KUSTOM-UI2",
  printFooterText: "KAKI-KUSTOM-UI2",
  printShowSignature: true,
  printShowQr: true,
  printReceiptPaper: "thermal80",
  printDocumentPaper: "a4",
  printShowCashier: true,
  printShowTax: true,
  printShowCustomer: true,
  printShowSession: true,
  printShowBranding: true,
  printSignatureLabels: null,
} as const;

beforeAll(async () => {
  await cleanupFixture();
  await adminDb.insert(user).values({ id: KASIR, name: "Rani Kasir", email: "rani.kasir@uji.local" });
  await adminDb.insert(companySettings).values({
    companyId: ORG,
    legalName: "PT Uji Faktur Sejahtera",
    taxId: "02.345.678.9-012.000",
    address: "Jl. Uji Faktur No. 8, Jakarta",
    phone: "021-555-8899",
    taxRate: "11",
    taxEnabled: true,
    ...BASE_PRINT,
  });
  await adminDb.insert(branches).values({ companyId: ORG, code: "UI2", name: "Cabang UI-2", isDefault: true });
  const [warehouse] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "GD-UI2", name: "Gudang UI-2", type: "store", isDefault: true })
    .returning();
  await adminDb.insert(customers).values({
    id: CUSTOMER_ID,
    companyId: ORG,
    code: "CUST-UI2",
    name: "PT Pelanggan Bisnis",
    phone: "0812-3456-7890",
    address: "Jl. Pelanggan No. 3, Bekasi",
  });
  const [method] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", sortOrder: 1 })
    .returning();
  await adminDb.insert(sales).values({
    id: SALE_ID,
    companyId: ORG,
    warehouseId: warehouse.id,
    number: "INV-UJI-UI2-001",
    date: "2026-11-07",
    cashierId: KASIR,
    sessionId: SESSION_ID,
    customerId: CUSTOMER_ID,
    status: "completed",
    // Harga POS termasuk PPN: total 111.000 memuat PPN 11.000,
    // sehingga DPP = 100.000.
    subtotal: "111000",
    discountTotal: "0",
    taxTotal: "11000",
    total: "111000",
    paidTotal: "111000",
  });
  await adminDb.insert(saleLines).values({
    companyId: ORG,
    saleId: SALE_ID,
    productId: PRODUCT_ID,
    lineNo: 1,
    qty: "1",
    // S4: baris fixture adalah baris satuan dasar — qtyInput = qty.
    qtyInput: "1",
    unitPrice: "111000",
    discountAmount: "0",
    taxAmount: "11000",
    lineTotal: "111000",
    productName: "Produk Uji Faktur",
    productSku: "UJI-FAKTUR-1",
  });
  await adminDb.insert(salePayments).values({
    companyId: ORG,
    saleId: SALE_ID,
    methodId: method.id,
    amount: "111000",
    tendered: "111000",
  });
});

afterAll(cleanupFixture);

/** formatIDR memakai spasi (NBSP) sesudah "Rp" — rapatkan semua
 * spasi agar asersi nominal tidak bergantung pada jenis spasinya. */
function compact(html: string): string {
  return html.replace(/[\s  ]+/g, "");
}

async function renderNota(searchParams: Record<string, string> = {}) {
  const { default: ReceiptPage } = await import("@/app/app/pos/nota/[id]/page");
  const element = await ReceiptPage({
    params: Promise.resolve({ id: SALE_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element as ReactElement);
}

async function renderFaktur(searchParams: Record<string, string> = {}) {
  const { default: SalesInvoicePage } = await import("@/app/app/pos/nota/[id]/faktur/page");
  const element = await SalesInvoicePage({
    params: Promise.resolve({ id: SALE_ID }),
    searchParams: Promise.resolve(searchParams),
  });
  return renderToStaticMarkup(element as ReactElement);
}

describe("A-28 UI-2 — nota membaca mesin cetak kustom", () => {
  it("kop, logo, dan kaki kustom tampil di nota", async () => {
    const html = await renderNota();
    expect(html).toContain("KOP-KUSTOM-UI2");
    expect(html).toContain("https://example.com/logo-ui2.png");
    expect(html).toContain("KAKI-KUSTOM-UI2");
    expect(html).toContain("Dicetak dari Bisa ERP");
    expect(html).toContain("Rani Kasir");
    expect(html).toContain("PT Pelanggan Bisnis");
    expect(html).toContain("termasuk PPN");
  });

  it("saklar elemen mati benar-benar menghilangkan kasir, pelanggan, sesi, PPN, dan merek", async () => {
    await setPrintSettings({
      printShowCashier: false,
      printShowCustomer: false,
      printShowSession: false,
      printShowTax: false,
      printShowBranding: false,
    });
    try {
      const html = await renderNota();
      expect(html).not.toContain("Rani Kasir");
      expect(html).not.toContain("PT Pelanggan Bisnis");
      expect(html).not.toContain("Sesi");
      expect(html).not.toContain("termasuk PPN");
      expect(html).not.toContain("Dicetak dari Bisa ERP");
      // Angka nota tidak berubah oleh saklar tampilan.
      expect(compact(html)).toContain("Rp111.000");
    } finally {
      await setPrintSettings({ ...BASE_PRINT });
    }
  });
});

describe("A-28 UI-2 — faktur penjualan A4", () => {
  it("memuat kop + NPWP, pihak, PPN terpisah, dan total yang sama dengan struk", async () => {
    const [faktur, nota] = await Promise.all([renderFaktur(), renderNota()]);
    expect(faktur).toContain("Faktur Penjualan");
    expect(faktur).toContain("PT Uji Faktur Sejahtera");
    expect(faktur).toContain("NPWP 02.345.678.9-012.000");
    expect(faktur).toContain("PT Pelanggan Bisnis");
    expect(faktur).toContain("Jl. Pelanggan No. 3, Bekasi");
    expect(faktur).toContain("Produk Uji Faktur");
    // DPP = total − PPN; PPN terpisah; TOTAL identik dengan struk.
    expect(faktur).toContain("Dasar pengenaan pajak");
    expect(compact(faktur)).toContain("Rp100.000");
    expect(faktur).toContain("PPN (termasuk dalam total)");
    expect(compact(faktur)).toContain(">Rp11.000<");
    expect(compact(faktur)).toContain("Rp111.000");
    expect(compact(nota)).toContain("Rp111.000");
    expect(compact(nota)).toContain(">Rp11.000<");
    // Blok tanda tangan dengan label bawaan faktur.
    expect(faktur).toContain("Dibuat oleh");
    expect(faktur).toContain("Diterima oleh");
    // Kertas dokumen dari mesin cetak.
    expect(faktur).toContain("size: A4 portrait");
    expect(faktur).not.toContain("Salinan — bukan faktur asli");
  });

  it("cetak ulang faktur (salinan=1) berpita SALINAN", async () => {
    const html = await renderFaktur({ salinan: "1" });
    expect(html).toContain("Salinan — bukan faktur asli");
  });

  it("label tanda tangan faktur dari pengaturan mengganti label bawaan", async () => {
    await setPrintSettings({
      printSignatureLabels: { faktur: ["Hormat kami", "Penerima barang"] },
    });
    try {
      const html = await renderFaktur();
      expect(html).toContain("Hormat kami");
      expect(html).toContain("Penerima barang");
    } finally {
      await setPrintSettings({ ...BASE_PRINT });
    }
  });

  it("baris merek hilang di faktur saat showBranding mati", async () => {
    await setPrintSettings({ printShowBranding: false });
    try {
      const html = await renderFaktur();
      expect(html).not.toContain("Dicetak dari Bisa ERP");
    } finally {
      await setPrintSettings({ ...BASE_PRINT });
    }
  });
});
