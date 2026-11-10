import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { adminDb, adminSql } from "@/db/admin";
import { account, member, organization, user } from "@/db/schema";

/**
 * SIM-2 Fase S6 (SEC-05): parser XLSX diganti dari npm 0.18.5 (membawa
 * CVE-2023-30533 prototype pollution & CVE-2024-22363 ReDoS yang tak
 * tertambal di npm) ke rilis vendor SheetJS 0.20.3 dari CDN resmi —
 * API identik, nol perubahan kode rute. Test ini mengunci perilaku
 * rute parse terhadap versi baru: berkas sah terparse, berkas rusak
 * ditolak anggun, berkas bermusuhan tidak mencemari Object.prototype,
 * dan gerbang import.manage tetap berlaku (403 tanpa izin).
 */

const sessionState = vi.hoisted(() => ({ role: "owner" as string }));

vi.mock("@/lib/session", async () => {
  const perms = await vi.importActual<typeof import("@/lib/permissions")>("@/lib/permissions");
  const requirePermission = async (permission: never) => {
    const ctx = {
      company: { id: "01900000-0000-7000-8000-00000000cc11" },
      user: { id: "01900000-0000-7000-8000-00000000cc21" },
      role: sessionState.role,
      permissions: perms.permissionsFor(sessionState.role),
    };
    perms.assertCan(ctx, permission);
    return ctx;
  };
  return { requirePermission, requirePermissionInModule: requirePermission, requireAuth: requirePermission };
});

import { POST } from "@/app/api/import/parse/route";

const ORG = "01900000-0000-7000-8000-00000000cc11";
const OWNER = "01900000-0000-7000-8000-00000000cc21";

async function wipeFixture() {
  await adminSql.begin(async (tx) => {
    await tx.unsafe("SET session_replication_role = replica");
    await tx.unsafe(`DELETE FROM import_rows WHERE company_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM import_jobs WHERE company_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM member WHERE organization_id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM organization WHERE id = $1`, [ORG]);
    await tx.unsafe(`DELETE FROM account WHERE user_id = $1`, [OWNER]);
    await tx.unsafe(`DELETE FROM "user" WHERE id = $1`, [OWNER]);
  });
}

function uploadRequest(fileName: string, content: Buffer | string): Request {
  const form = new FormData();
  form.set("entity", "products");
  form.set("file", new File([content as BlobPart], fileName));
  return new Request("http://localhost/api/import/parse", { method: "POST", body: form });
}

function workbookBuffer(rows: unknown[][]): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Produk");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

beforeAll(async () => {
  await wipeFixture();
  await adminDb.insert(user).values({
    id: OWNER, name: "Uji Impor", email: "owner@impor.id", emailVerified: true, role: "owner",
  });
  await adminDb.insert(account).values({
    id: crypto.randomUUID(), accountId: OWNER, providerId: "credential", userId: OWNER, password: "x",
  });
  await adminDb.insert(organization).values({
    id: ORG, name: "Impor Mart", slug: "impor-mart", createdAt: new Date(),
  });
  await adminDb.insert(member).values({
    id: crypto.randomUUID(), organizationId: ORG, userId: OWNER, role: "owner", createdAt: new Date(),
  });
});
afterAll(wipeFixture);

describe("SEC-05 — rute parse dengan SheetJS 0.20.3", () => {
  it("versi parser yang terpasang adalah 0.20.3 (kedua CVE tertambal)", () => {
    expect(XLSX.version).toBe("0.20.3");
  });

  it("berkas XLSX sah terparse: job dibuat, baris tersimpan, mapping disarankan", async () => {
    sessionState.role = "owner";
    const response = await POST(
      uploadRequest("produk.xlsx", workbookBuffer([
        ["SKU", "Nama", "Harga Jual"],
        ["IMP-001", "Produk Impor Satu", "15000"],
        ["IMP-002", "Produk Impor Dua", "27500"],
      ])),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { jobId: string; totalRows: number; headers: string[] };
    expect(body.totalRows).toBe(2);
    expect(body.headers).toEqual(["SKU", "Nama", "Harga Jual"]);
    const rows = await adminSql`SELECT data FROM import_rows WHERE job_id = ${body.jobId} ORDER BY row_number`;
    expect(rows).toHaveLength(2);
    expect((rows[0].data as Record<string, string>)["SKU"]).toBe("IMP-001");
  });

  it("berkas CSV sah tetap terparse lewat jalur yang sama", async () => {
    sessionState.role = "owner";
    const response = await POST(
      uploadRequest("produk.csv", "SKU,Nama,Harga Jual\nIMP-003,Produk CSV,9000\n"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totalRows: number };
    expect(body.totalRows).toBe(1);
  });

  it("berkas rusak ditolak anggun dengan 400, bukan 500", async () => {
    sessionState.role = "owner";
    const response = await POST(
      uploadRequest("rusak.xlsx", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef, 0x00, 0x11])),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Gagal membaca file");
  });

  it("berkas bermusuhan (__proto__ sebagai data) tidak mencemari Object.prototype", async () => {
    sessionState.role = "owner";
    const response = await POST(
      uploadRequest("jahat.xlsx", workbookBuffer([
        ["__proto__", "constructor", "Nama"],
        ["polluted", "polluted", "Produk Jahat"],
      ])),
    );
    expect(response.status).toBe(200);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  it("tanpa import.manage (akuntan) rute menolak 403 sebelum membaca berkas", async () => {
    sessionState.role = "accountant";
    const response = await POST(
      uploadRequest("produk.xlsx", workbookBuffer([["SKU", "Nama"], ["IMP-009", "X"]])),
    );
    expect(response.status).toBe(403);
  });
});
