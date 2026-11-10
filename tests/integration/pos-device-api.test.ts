import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { adminDb, adminSql } from "@/db/admin";
import {
  account,
  accountMappings,
  accounts,
  auditLog,
  cashSessions,
  companySettings,
  customers,
  journalEntries,
  member,
  organization,
  paymentMethods,
  posPairingCodes,
  posTerminalSessionReviews,
  posTerminals,
  productPackagings,
  products,
  saleLines,
  sales,
  stockOnHand,
  user,
  warehouses,
} from "@/db/schema";
import { withCompany } from "@/db/tenant";
import { applyStockMovement } from "@/server/inventory";
import {
  decideDesktopUpdate,
  openCashSession,
  rolloutBucket,
  setDesktopReleaseSettings,
} from "@/server/pos";
import { GET as snapshotGET } from "@/app/api/pos/snapshot/route";
import { POST as syncPOST } from "@/app/api/pos/sync/route";
import { POST as pairPOST } from "@/app/api/pos/pair/route";
import { GET as updateGET } from "@/app/api/pos/update/[target]/[arch]/[version]/route";
import { GET as updateDownloadGET } from "@/app/api/pos/update/download/[target]/[arch]/route";
import { wipeCompanyFixture } from "../helpers/wipe-company";

/**
 * POS Native Langkah 1 — endpoint perangkat `/api/pos/*` diuji LEWAT
 * permukaan HTTP-nya (handler route dipanggil dengan Request
 * sungguhan: header Authorization, badan JSON, kode status), bukan
 * hanya lewat action/domain:
 * - tanpa/salah token perangkat → 401;
 * - snapshot berisi katalog + harga + stok + metode dari fungsi
 *   domain yang sama dengan terminal web;
 * - sync menjalankan kontrak idempoten yang ada: item valid →
 *   synced, pengiriman ulang clientKey yang sama → duplicate dan
 *   penjualan TIDAK dobel;
 * - badan tidak valid → 400.
 */

const ORG = "01900000-0000-7000-8000-00000000e807";
const OWNER = "01900000-0000-7000-8000-00000000e859";
const TOKEN = "device-token-uji-1234567890";


const digestOf = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");

async function wipeFixture() {
  // AUD-001: penghapusan tuntas satu transaksi lewat helper bersama
  // (tabel dienumerasi dinamis dari information_schema — bukan daftar
  // tulis tangan yang membeku; lihat tests/helpers/wipe-company.ts).
  await wipeCompanyFixture(adminSql, ORG, [OWNER]);
}

let whId = "";
let productId = "";
let methodId = "";
let terminalId = "";

async function bootstrap() {
  await wipeFixture();
  await adminDb.insert(user).values({ id: OWNER, name: "Pemilik Uji API", email: "owner-e807@bisa.id", emailVerified: true, role: "owner" });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER,
  });
  await adminDb.insert(organization).values({ id: ORG, name: "PT Uji API POS", slug: "uji-api-pos", createdAt: new Date() });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
  await adminDb.insert(companySettings).values({
    companyId: ORG, legalName: "PT Uji API POS", roundingMode: "none", taxRate: "0", taxEnabled: false,
    allowNegativeStock: false, posOfflineEnabled: true,
    // Langkah 5: pengaturan cetak perusahaan — blok receipt snapshot
    // harus membawanya dari SUMBER yang sama dengan nota web.
    printHeaderText: "Cabang Uji",
    printFooterText: "Terima kasih — uji API",
    printReceiptPaper: "thermal58",
  });
  const acc: Record<string, string> = {};
  const rows = await adminDb
    .insert(accounts)
    .values([
      { companyId: ORG, code: "1000", name: "Kas", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "1300", name: "Persediaan Barang", type: "asset", normalBalance: "debit" },
      { companyId: ORG, code: "2000", name: "Utang Usaha", type: "liability", normalBalance: "credit" },
      { companyId: ORG, code: "3000", name: "Modal Pemilik", type: "equity", normalBalance: "credit" },
      { companyId: ORG, code: "4000", name: "Penjualan", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "4010", name: "Diskon Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "4020", name: "Retur Penjualan", type: "revenue", normalBalance: "debit" },
      { companyId: ORG, code: "5000", name: "Harga Pokok Penjualan", type: "cogs", normalBalance: "debit" },
      { companyId: ORG, code: "9000", name: "Pembulatan Penjualan (Laba)", type: "revenue", normalBalance: "credit" },
      { companyId: ORG, code: "9001", name: "Selisih Pembulatan (Rugi)", type: "expense", normalBalance: "debit" },
    ])
    .returning();
  for (const row of rows) acc[row.code] = row.id;
  await adminDb.insert(accountMappings).values([
    { companyId: ORG, key: "cash", accountId: acc["1000"] },
    { companyId: ORG, key: "inventory", accountId: acc["1300"] },
    { companyId: ORG, key: "payable", accountId: acc["2000"] },
    { companyId: ORG, key: "equity", accountId: acc["3000"] },
    { companyId: ORG, key: "revenue", accountId: acc["4000"] },
    { companyId: ORG, key: "sales_discount", accountId: acc["4010"] },
    { companyId: ORG, key: "sales_return", accountId: acc["4020"] },
    { companyId: ORG, key: "cogs", accountId: acc["5000"] },
    { companyId: ORG, key: "rounding_gain", accountId: acc["9000"] },
    { companyId: ORG, key: "rounding_loss", accountId: acc["9001"] },
  ]);
  const [cash] = await adminDb
    .insert(paymentMethods)
    .values({ companyId: ORG, code: "CASH", name: "Tunai", type: "cash", accountId: acc["1000"], sortOrder: 1 })
    .returning();
  methodId = cash.id;
  const [wh] = await adminDb
    .insert(warehouses)
    .values({ companyId: ORG, code: "WH-API", name: "Gudang API", type: "warehouse", isDefault: true })
    .returning();
  whId = wh.id;
  const [product] = await adminDb
    .insert(products)
    .values({ companyId: ORG, sku: "API-1", name: "Produk API", salePrice: "15000", costPrice: "10000", trackStock: true })
    .returning();
  productId = product.id;
  await adminDb.insert(customers).values({
    companyId: ORG, code: "CUST-API", name: "Pelanggan API",
  });
  await withCompany(ORG, async (tx) => {
    await openCashSession(tx, { companyId: ORG, userId: OWNER, openingCash: 0 });
    await applyStockMovement(tx, {
      companyId: ORG, warehouseId: whId, productId, delta: 5, unitCost: "10000",
      movementType: "purchase", referenceType: "opening", userId: OWNER,
    });
  });
  // Langkah 6: token perangkat kini dari REGISTRY terminal —
  // fixture menanam terminal dengan digest token uji (jalur env
  // BISA_POS_DEVICE_TOKENS sudah dibuang dari kode produksi).
  const [terminal] = await adminDb
    .insert(posTerminals)
    .values({
      companyId: ORG,
      warehouseId: whId,
      name: "Kasir Uji API",
      userId: OWNER,
      tokenDigest: digestOf(TOKEN),
      status: "active",
      pairedAt: new Date(),
    })
    .returning();
  terminalId = terminal.id;
}

function request(path: string, options: { token?: string; body?: unknown } = {}): Request {
  const headers: Record<string, string> = {};
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost:3000${path}`, {
    method: options.body !== undefined ? "POST" : "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function saleItem(clientKey: string) {
  return {
    clientKey,
    warehouseId: whId,
    date: todayISO(),
    lines: [{ productId, qty: 2 }],
    payments: [{ methodId, amount: 30000, tendered: 30000 }],
    queuedAt: new Date().toISOString(),
  };
}

async function onHand(): Promise<number> {
  const [row] = await adminDb
    .select({ qty: stockOnHand.qty })
    .from(stockOnHand)
    .where(and(eq(stockOnHand.companyId, ORG), eq(stockOnHand.productId, productId)));
  return row ? Number(row.qty) : 0;
}

beforeAll(bootstrap);
afterAll(async () => {
  await wipeFixture();
});

describe("API perangkat POS /api/pos/*", () => {
  it("snapshot menolak permintaan tanpa token dan dengan token salah (401)", async () => {
    const noToken = await snapshotGET(request("/api/pos/snapshot"));
    expect(noToken.status).toBe(401);
    const wrongToken = await snapshotGET(request("/api/pos/snapshot", { token: "token-yang-salah-0000" }));
    expect(wrongToken.status).toBe(401);
  });

  it("snapshot ber-token berisi katalog, harga, stok, gudang & metode perusahaan perangkat", async () => {
    const response = await snapshotGET(request("/api/pos/snapshot", { token: TOKEN }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.mode).toBe("full");
    expect(body.data.companyId).toBe(ORG);
    expect(body.data.warehouse.id).toBe(whId);
    const product = body.data.products.find((p: { id: string }) => p.id === productId);
    expect(product).toBeTruthy();
    expect(product.name).toBe("Produk API");
    expect(Number(product.salePrice)).toBe(15000);
    expect(product.stock).toBe(5);
    expect(body.data.paymentMethods.map((m: { name: string }) => m.name)).toContain("Tunai");
    // Langkah 5: blok receipt untuk pembangkit ESC/POS Rust — dari
    // pengaturan cetak perusahaan yang sama dengan nota web.
    expect(body.data.receipt.companyName).toBe("PT Uji API POS");
    expect(body.data.receipt.headerText).toBe("Cabang Uji");
    expect(body.data.receipt.footerText).toBe("Terima kasih — uji API");
    expect(body.data.receipt.receiptPaper).toBe("thermal58");
    expect(body.data.receipt.showCashier).toBe(true);
    expect(body.data.receipt.taxEnabled).toBe(false);
    // Langkah 6: identitas terminal dari registry + direktori nama
    // (kasir & pelanggan) agar struk/UI desktop menampilkan nama.
    expect(body.data.terminal.id).toBe(terminalId);
    expect(body.data.terminal.name).toBe("Kasir Uji API");
    expect(body.data.terminal.companyName).toBe("PT Uji API POS");
    expect(body.data.terminal.warehouse.id).toBe(whId);
    expect(body.data.names.cashiers.map((c: { name: string }) => c.name)).toContain(
      "Pemilik Uji API",
    );
    expect(body.data.names.customers.map((c: { name: string }) => c.name)).toContain(
      "Pelanggan API",
    );
  });

  it("sync ber-token memposting penjualan; kirim ulang clientKey sama → duplicate, tidak dobel", async () => {
    const payload = { items: [saleItem("api-client-key-1")] };
    const first = await syncPOST(request("/api/pos/sync", { token: TOKEN, body: payload }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.ok).toBe(true);
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0].status).toBe("synced");
    expect(firstBody.data[0].saleNumber).toBeTruthy();

    const second = await syncPOST(request("/api/pos/sync", { token: TOKEN, body: payload }));
    const secondBody = await second.json();
    expect(secondBody.data[0].status).toBe("duplicate");
    expect(secondBody.data[0].saleId).toBe(firstBody.data[0].saleId);

    const allSales = await adminDb.select().from(sales).where(eq(sales.companyId, ORG));
    expect(allSales).toHaveLength(1);
    expect(await onHand()).toBe(3);
  });

  it("delta berkursor: hanya baris berubah yang terkirim; nonaktif & hapus keras menjadi tombstone", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    // Normalisasi deterministik: semua penanda perubahan fixture
    // dibuat tua, agar jendela tumpang-tindih delta tidak menyeret
    // sisa aktivitas test sebelumnya.
    await adminDb
      .update(products)
      .set({ updatedAt: twoHoursAgo })
      .where(eq(products.companyId, ORG));
    await adminDb
      .update(stockOnHand)
      .set({ updatedAt: twoHoursAgo })
      .where(eq(stockOnHand.companyId, ORG));

    const [a] = await adminDb
      .insert(products)
      .values({ companyId: ORG, sku: "API-D1", name: "Produk Delta A", salePrice: "1000", costPrice: "500", trackStock: false, updatedAt: twoHoursAgo })
      .returning();
    const [b] = await adminDb
      .insert(products)
      .values({ companyId: ORG, sku: "API-D2", name: "Produk Delta B", salePrice: "2000", costPrice: "900", trackStock: false, updatedAt: twoHoursAgo })
      .returning();

    const snapshotWithCursor = async (cursor?: string) => {
      const path = cursor
        ? `/api/pos/snapshot?cursor=${encodeURIComponent(cursor)}`
        : "/api/pos/snapshot";
      const response = await snapshotGET(request(path, { token: TOKEN }));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      return body.data;
    };

    // Snapshot awal: penuh + kursor diterbitkan.
    const full = await snapshotWithCursor();
    expect(full.mode).toBe("full");
    expect(typeof full.cursor).toBe("string");
    expect(full.products.map((p: { id: string }) => p.id)).toContain(a.id);

    // Ubah harga A persis seperti domain (harga + updated_at).
    await withCompany(ORG, async (tx) => {
      await tx
        .update(products)
        .set({ salePrice: "17500", updatedAt: new Date() })
        .where(eq(products.id, a.id));
    });

    const delta1 = await snapshotWithCursor(full.cursor);
    expect(delta1.mode).toBe("delta");
    expect(delta1.baseCursor).toBe(full.cursor);
    expect(delta1.cursor).not.toBe(full.cursor);
    const deltaIds = delta1.products.map((p: { id: string }) => p.id);
    expect(deltaIds).toContain(a.id);
    expect(deltaIds).not.toContain(b.id);
    expect(deltaIds).not.toContain(productId);
    const changedA = delta1.products.find((p: { id: string }) => p.id === a.id);
    expect(Number(changedA.salePrice)).toBe(17500);
    expect(delta1.removedProductIds).toEqual([]);
    // Metode & gudang tetap utuh di delta (diganti utuh di klien).
    expect(delta1.paymentMethods.map((m: { name: string }) => m.name)).toContain("Tunai");
    // Blok receipt juga utuh di delta (pengaturan cetak bisa berubah
    // kapan pun; klien menggantinya utuh seperti metode).
    expect(delta1.receipt.companyName).toBe("PT Uji API POS");
    expect(delta1.receipt.receiptPaper).toBe("thermal58");

    // Nonaktifkan B → delta berikutnya membawanya sebagai tombstone.
    await withCompany(ORG, async (tx) => {
      await tx
        .update(products)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(products.id, b.id));
    });
    const delta2 = await snapshotWithCursor(delta1.cursor);
    expect(delta2.mode).toBe("delta");
    expect(delta2.removedProductIds).toContain(b.id);
    expect(delta2.products.map((p: { id: string }) => p.id)).not.toContain(b.id);

    // Produk baru C terkirim lewat delta, lalu hapus keras (baris
    // audit product.delete, persis jejak domain) → tombstone.
    const [c] = await adminDb
      .insert(products)
      .values({ companyId: ORG, sku: "API-D3", name: "Produk Delta C", salePrice: "3000", costPrice: "100", trackStock: false })
      .returning();
    const delta3 = await snapshotWithCursor(delta2.cursor);
    expect(delta3.products.map((p: { id: string }) => p.id)).toContain(c.id);
    await adminDb.delete(products).where(eq(products.id, c.id));
    await adminDb.insert(auditLog).values({
      companyId: ORG,
      userId: OWNER,
      action: "product.delete",
      entityType: "product",
      entityId: c.id,
    });
    const delta4 = await snapshotWithCursor(delta3.cursor);
    expect(delta4.mode).toBe("delta");
    expect(delta4.removedProductIds).toContain(c.id);
    expect(delta4.products.map((p: { id: string }) => p.id)).not.toContain(c.id);
  });

  it("kursor tidak valid atau terlalu tua jatuh ke snapshot penuh eksplisit", async () => {
    const invalid = await snapshotGET(
      request("/api/pos/snapshot?cursor=bukan-tanggal", { token: TOKEN }),
    );
    expect(invalid.status).toBe(200);
    expect((await invalid.json()).data.mode).toBe("full");

    const staleCursor = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const stale = await snapshotGET(
      request(`/api/pos/snapshot?cursor=${encodeURIComponent(staleCursor)}`, { token: TOKEN }),
    );
    expect(stale.status).toBe(200);
    expect((await stale.json()).data.mode).toBe("full");
  });

  it("sync menolak tanpa token (401) dan badan tidak valid (400)", async () => {
    const noToken = await syncPOST(request("/api/pos/sync", { body: { items: [saleItem("api-client-key-2")] } }));
    expect(noToken.status).toBe(401);
    const invalid = await syncPOST(
      request("/api/pos/sync", { token: TOKEN, body: { items: [{ clientKey: "pendek" }] } }),
    );
    expect(invalid.status).toBe(400);
    const body = await invalid.json();
    expect(body.code).toBe("VALIDATION");
  });

  it("pairing: kode sekali pakai → token terminal; dipakai ulang & kedaluwarsa ditolak; terminal dicabut → 401", async () => {
    const [terminal2] = await adminDb
      .insert(posTerminals)
      .values({ companyId: ORG, warehouseId: whId, name: "Kasir Pasangan", userId: OWNER })
      .returning();
    const CODE = "UJI12-34567";
    await adminDb.insert(posPairingCodes).values({
      companyId: ORG,
      terminalId: terminal2.id,
      codeDigest: digestOf(CODE),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    const paired = await pairPOST(
      request("/api/pos/pair", { body: { code: CODE } }),
    );
    expect(paired.status).toBe(200);
    const pairedBody = await paired.json();
    expect(pairedBody.ok).toBe(true);
    expect(typeof pairedBody.data.token).toBe("string");
    expect(pairedBody.data.token.length).toBeGreaterThanOrEqual(32);
    expect(pairedBody.data.terminal.id).toBe(terminal2.id);
    expect(pairedBody.data.terminal.name).toBe("Kasir Pasangan");
    const pairedToken = pairedBody.data.token as string;

    // Token hasil pasangan bekerja untuk snapshot…
    const snap = await snapshotGET(
      request("/api/pos/snapshot", { token: pairedToken }),
    );
    expect(snap.status).toBe(200);
    expect((await snap.json()).data.terminal.id).toBe(terminal2.id);

    // …kode yang sama hangus (sekali pakai)…
    const reuse = await pairPOST(request("/api/pos/pair", { body: { code: CODE } }));
    expect(reuse.status).toBe(401);

    // …kode kedaluwarsa ditolak…
    const EXPIRED = "KADAL-UWAR5";
    await adminDb.insert(posPairingCodes).values({
      companyId: ORG,
      terminalId: terminal2.id,
      codeDigest: digestOf(EXPIRED),
      expiresAt: new Date(Date.now() - 60 * 1000),
    });
    const expired = await pairPOST(
      request("/api/pos/pair", { body: { code: EXPIRED } }),
    );
    expect(expired.status).toBe(401);

    // …dan mencabut terminal mematikan tokennya pada panggilan berikutnya.
    await adminDb
      .update(posTerminals)
      .set({ status: "revoked" })
      .where(eq(posTerminals.id, terminal2.id));
    const revoked = await snapshotGET(
      request("/api/pos/snapshot", { token: pairedToken }),
    );
    expect(revoked.status).toBe(401);
  });

  it("intent tutup sesi terminal tercatat sekali sebagai peninjauan — tanpa sesi/jurnal server baru", async () => {
    const sessionsBefore = await adminDb
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.companyId, ORG));
    const journalsBefore = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.companyId, ORG));

    const intent = {
      clientKey: "intent-tutup-sesi-1",
      warehouseId: whId,
      cashierId: OWNER,
      localSessionId: "sesi-lokal-0001",
      openedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
      closedAt: new Date().toISOString(),
      openingCash: 100000,
      expectedCash: 250000,
      countedCash: 247000,
      difference: -3000,
      denominations: [{ denomination: "100000", count: 2 }],
      differenceReason: "Selisih kas kecil",
    };
    const payload = { items: [], sessionIntents: [intent] };
    const first = await syncPOST(request("/api/pos/sync", { token: TOKEN, body: payload }));
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.intentResults).toEqual([
      { clientKey: "intent-tutup-sesi-1", status: "recorded" },
    ]);

    const second = await syncPOST(request("/api/pos/sync", { token: TOKEN, body: payload }));
    const secondBody = await second.json();
    expect(secondBody.intentResults).toEqual([
      { clientKey: "intent-tutup-sesi-1", status: "duplicate" },
    ]);

    const reviews = await adminDb
      .select()
      .from(posTerminalSessionReviews)
      .where(eq(posTerminalSessionReviews.companyId, ORG));
    expect(reviews).toHaveLength(1);
    expect(reviews[0].terminalId).toBe(terminalId);
    expect(Number(reviews[0].difference)).toBe(-3000);

    const sessionsAfter = await adminDb
      .select({ id: cashSessions.id })
      .from(cashSessions)
      .where(eq(cashSessions.companyId, ORG));
    const journalsAfter = await adminDb
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.companyId, ORG));
    expect(sessionsAfter).toHaveLength(sessionsBefore.length);
    expect(journalsAfter).toHaveLength(journalsBefore.length);
  });
});

/**
 * POS Native Langkah 7 — endpoint updater dinamis Tauri
 * GET /api/pos/update/:target/:arch/:version (+ unduhan artefak)
 * diuji lewat handler route sungguhan:
 * - tanpa token → 401;
 * - rollout 100% & versi terminal lebih lama → dokumen updater
 *   JSON benar (versi, url unduhan, tanda tangan dari .sig);
 * - rollout 0% → 204; versi sama → 204;
 * - di bawah versi minimum → tawaran WAJIB walau rollout 0%;
 * - artefak/.sig hilang dari direktori rilis → 204 (bukan janji
 *   kosong); target tak dikenal → 404;
 * - unduhan mengalirkan byte artefak yang sama, ber-token.
 */
describe("API perangkat POS /api/pos/update (Langkah 7)", () => {
  const ARTIFACT_BYTES = "APPIMAGE-UJI-BISA-POS-1.0.0";
  const SIG_TEXT = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSB1amkKUlV1amkxMjM0NTY=";
  let releaseDirPath = "";
  let previousReleaseDir: string | undefined;

  async function setRelease(input: {
    version: string;
    rolloutPercent: number;
    minVersion?: string | null;
  }) {
    await withCompany(ORG, (tx) =>
      setDesktopReleaseSettings(tx, {
        companyId: ORG,
        version: input.version,
        rolloutPercent: input.rolloutPercent,
        minVersion: input.minVersion ?? null,
        notes: "Rilis uji langkah 7",
        updatedBy: OWNER,
      }),
    );
  }

  function checkRequest(version: string, token?: string) {
    return updateGET(request(`/api/pos/update/linux/x86_64/${version}`, { token }), {
      params: Promise.resolve({ target: "linux", arch: "x86_64", version }),
    });
  }

  beforeAll(() => {
    previousReleaseDir = process.env.BISA_POS_RELEASE_DIR;
    releaseDirPath = mkdtempSync(path.join(tmpdir(), "bisa-pos-release-"));
    writeFileSync(path.join(releaseDirPath, "bisa-pos_linux-x86_64.AppImage"), ARTIFACT_BYTES);
    writeFileSync(path.join(releaseDirPath, "bisa-pos_linux-x86_64.AppImage.sig"), SIG_TEXT);
    process.env.BISA_POS_RELEASE_DIR = releaseDirPath;
  });

  afterAll(() => {
    if (previousReleaseDir === undefined) {
      delete process.env.BISA_POS_RELEASE_DIR;
    } else {
      process.env.BISA_POS_RELEASE_DIR = previousReleaseDir;
    }
    rmSync(releaseDirPath, { recursive: true, force: true });
  });

  it("menolak pemeriksaan tanpa token (401) dan target tak dikenal (404)", async () => {
    await setRelease({ version: "1.0.0", rolloutPercent: 100 });
    const noToken = await checkRequest("0.9.0");
    expect(noToken.status).toBe(401);
    const unknown = await updateGET(
      request("/api/pos/update/plan9/x86_64/0.9.0", { token: TOKEN }),
      { params: Promise.resolve({ target: "plan9", arch: "x86_64", version: "0.9.0" }) },
    );
    expect(unknown.status).toBe(404);
  });

  it("rollout 100%: terminal versi lama menerima dokumen updater yang benar", async () => {
    await setRelease({ version: "1.0.0", rolloutPercent: 100 });
    const response = await checkRequest("0.9.0", TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe("1.0.0");
    expect(body.signature).toBe(SIG_TEXT);
    expect(body.mandatory).toBe(false);
    expect(body.url).toBe("http://localhost:3000/api/pos/update/download/linux/x86_64");
    expect(typeof body.pub_date).toBe("string");
  });

  it("rollout 0% → 204, dan versi yang sama → 204", async () => {
    await setRelease({ version: "1.0.0", rolloutPercent: 0 });
    const gated = await checkRequest("0.9.0", TOKEN);
    expect(gated.status).toBe(204);
    await setRelease({ version: "1.0.0", rolloutPercent: 100 });
    const current = await checkRequest("1.0.0", TOKEN);
    expect(current.status).toBe(204);
  });

  it("di bawah versi minimum: tawaran WAJIB walau rollout 0%", async () => {
    await setRelease({ version: "1.0.0", rolloutPercent: 0, minVersion: "0.5.0" });
    const response = await checkRequest("0.4.0", TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.version).toBe("1.0.0");
    expect(body.mandatory).toBe(true);
  });

  it("artefak hilang dari direktori rilis → 204, bukan janji kosong", async () => {
    await setRelease({ version: "1.0.0", rolloutPercent: 100 });
    rmSync(path.join(releaseDirPath, "bisa-pos_linux-x86_64.AppImage.sig"));
    const response = await checkRequest("0.9.0", TOKEN);
    expect(response.status).toBe(204);
    writeFileSync(path.join(releaseDirPath, "bisa-pos_linux-x86_64.AppImage.sig"), SIG_TEXT);
  });

  it("unduhan artefak mengalirkan byte yang sama dan menuntut token", async () => {
    const noToken = await updateDownloadGET(request("/api/pos/update/download/linux/x86_64"), {
      params: Promise.resolve({ target: "linux", arch: "x86_64" }),
    });
    expect(noToken.status).toBe(401);
    const response = await updateDownloadGET(
      request("/api/pos/update/download/linux/x86_64", { token: TOKEN }),
      { params: Promise.resolve({ target: "linux", arch: "x86_64" }) },
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(ARTIFACT_BYTES);
  });

  it("bucket rollout deterministik & keputusan murni konsisten", () => {
    const bucket = rolloutBucket(ORG, terminalId, "1.0.0");
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
    expect(rolloutBucket(ORG, terminalId, "1.0.0")).toBe(bucket);
    // Di atas bucket → tertahan; mandatory menembus rollout berapa pun.
    const settings = { version: "1.0.0", rolloutPercent: bucket, minVersion: null };
    expect(decideDesktopUpdate({ currentVersion: "0.9.0", settings, bucket }).offer).toBe(false);
    expect(
      decideDesktopUpdate({
        currentVersion: "0.9.0",
        settings: { ...settings, rolloutPercent: bucket + 1 },
        bucket,
      }),
    ).toEqual({ offer: true, mandatory: false });
    expect(
      decideDesktopUpdate({
        currentVersion: "0.4.0",
        settings: { version: "1.0.0", rolloutPercent: 0, minVersion: "0.5.0" },
        bucket,
      }),
    ).toEqual({ offer: true, mandatory: true });
    expect(
      decideDesktopUpdate({ currentVersion: "0.9.0", settings: null, bucket }).offer,
    ).toBe(false);
  });
});

/**
 * Program Satuan Kemasan S5 — paritas kemasan POS desktop lewat
 * permukaan HTTP yang sama:
 * - snapshot penuh membawa blok kemasan per produk (isi, harga jual
 *   per kemasan independen, barcode kemasan, aktif, bawaan jual);
 * - sync penjualan desktop 1 Dus memakai kontrak S4 yang sama
 *   (packagingId + isiSnapshot + harga per kemasan di muatan) →
 *   server mencatat baris qty 40 pcs berharga dus, stok −40;
 * - delta berkursor menangkap perubahan kemasan: ubah isi dan
 *   nonaktifkan kemasan sama-sama mengirim ulang produk induknya
 *   dengan blok kemasan terbaru.
 */
describe("API perangkat POS — kemasan desktop (S5)", () => {
  let pkgProductId = "";
  let pkgPackagingId = "";

  beforeAll(async () => {
    const [product] = await adminDb
      .insert(products)
      .values({
        companyId: ORG,
        sku: "API-PKG",
        name: "Produk Kemasan API",
        salePrice: "15000",
        costPrice: "10000",
        trackStock: true,
      })
      .returning();
    pkgProductId = product.id;
    const [packaging] = await adminDb
      .insert(productPackagings)
      .values({
        companyId: ORG,
        productId: pkgProductId,
        name: "Dus",
        isi: "40",
        // Harga dus INDEPENDEN: bukan 40 × Rp15.000 = Rp600.000.
        salePrice: "500000",
        barcode: "8992000000040",
        isDefaultSale: true,
      })
      .returning();
    pkgPackagingId = packaging.id;
    await withCompany(ORG, async (tx) => {
      await applyStockMovement(tx, {
        companyId: ORG,
        warehouseId: whId,
        productId: pkgProductId,
        delta: 100,
        unitCost: "10000",
        movementType: "purchase",
        referenceType: "opening",
        userId: OWNER,
      });
    });
  });

  async function snapshotData(cursor?: string) {
    const path = cursor
      ? `/api/pos/snapshot?cursor=${encodeURIComponent(cursor)}`
      : "/api/pos/snapshot";
    const response = await snapshotGET(request(path, { token: TOKEN }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    return body.data;
  }

  it("snapshot penuh membawa blok kemasan per produk; produk tanpa kemasan membawa array kosong", async () => {
    const data = await snapshotData();
    expect(data.mode).toBe("full");
    const product = data.products.find((p: { id: string }) => p.id === pkgProductId);
    expect(product).toBeTruthy();
    expect(product.packagings).toHaveLength(1);
    const dus = product.packagings[0];
    expect(dus.id).toBe(pkgPackagingId);
    expect(dus.name).toBe("Dus");
    expect(Number(dus.isi)).toBe(40);
    expect(Number(dus.salePrice)).toBe(500000);
    expect(dus.barcode).toBe("8992000000040");
    expect(dus.isActive).toBe(true);
    expect(dus.isDefaultSale).toBe(true);
    const plain = data.products.find((p: { id: string }) => p.id === productId);
    expect(plain.packagings).toEqual([]);
  });

  it("sync penjualan desktop 1 Dus → server mencatat qty 40 & harga dus, stok −40", async () => {
    const payload = {
      items: [
        {
          clientKey: "api-client-key-dus-1",
          warehouseId: whId,
          date: todayISO(),
          lines: [
            {
              productId: pkgProductId,
              qty: 1,
              unitPrice: 500000,
              packagingId: pkgPackagingId,
              isiSnapshot: 40,
            },
          ],
          payments: [{ methodId, amount: 500000, tendered: 500000 }],
          queuedAt: new Date().toISOString(),
        },
      ],
    };
    const response = await syncPOST(request("/api/pos/sync", { token: TOKEN, body: payload }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].status).toBe("synced");

    const lines = await adminDb
      .select()
      .from(saleLines)
      .where(
        and(eq(saleLines.companyId, ORG), eq(saleLines.productId, pkgProductId)),
      );
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].qty)).toBe(40);
    expect(Number(lines[0].qtyInput)).toBe(1);
    expect(Number(lines[0].isiSnapshot)).toBe(40);
    expect(lines[0].packagingId).toBe(pkgPackagingId);
    // Harga tersimpan per satuan dasar dari harga kemasan: 500000/40.
    expect(Number(lines[0].unitPrice)).toBe(12500);

    const [onHandRow] = await adminDb
      .select({ qty: stockOnHand.qty })
      .from(stockOnHand)
      .where(
        and(
          eq(stockOnHand.companyId, ORG),
          eq(stockOnHand.productId, pkgProductId),
        ),
      );
    expect(Number(onHandRow.qty)).toBe(60);
  });

  it("delta berkursor menangkap ubah isi & nonaktifkan kemasan produk induknya", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await adminDb
      .update(products)
      .set({ updatedAt: twoHoursAgo })
      .where(eq(products.companyId, ORG));
    await adminDb
      .update(stockOnHand)
      .set({ updatedAt: twoHoursAgo })
      .where(eq(stockOnHand.companyId, ORG));
    await adminDb
      .update(productPackagings)
      .set({ updatedAt: twoHoursAgo })
      .where(eq(productPackagings.companyId, ORG));

    const full = await snapshotData();
    expect(full.mode).toBe("full");

    await adminDb
      .update(productPackagings)
      .set({ isi: "50", updatedAt: new Date() })
      .where(eq(productPackagings.id, pkgPackagingId));
    const delta1 = await snapshotData(full.cursor);
    expect(delta1.mode).toBe("delta");
    const changed = delta1.products.find((p: { id: string }) => p.id === pkgProductId);
    expect(changed).toBeTruthy();
    expect(Number(changed.packagings[0].isi)).toBe(50);
    expect(changed.packagings[0].isActive).toBe(true);

    await adminDb
      .update(productPackagings)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(productPackagings.id, pkgPackagingId));
    const delta2 = await snapshotData(delta1.cursor);
    expect(delta2.mode).toBe("delta");
    const deactivated = delta2.products.find((p: { id: string }) => p.id === pkgProductId);
    expect(deactivated).toBeTruthy();
    expect(deactivated.packagings[0].isActive).toBe(false);
  });
});
