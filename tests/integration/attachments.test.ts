import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminDb, adminSql } from "@/db/admin";
import { journalEntries } from "@/db/schema";
import { withCompany } from "@/db/tenant";
import {
  deleteAttachment,
  getAttachment,
  listAttachments,
  saveAttachment,
} from "@/server/attachments";
import { wipeCompanyFixture } from "../helpers/wipe-company";

const ORG = "01900000-0000-7000-8000-00000000d601";
const USER = "01900000-0000-7000-8000-00000000d611";
const OTHER = "01900000-0000-7000-8000-00000000d612";
const ENTRY = "01900000-0000-7000-8000-00000000d621";
const BASE64 = Buffer.from("bukti transfer uji").toString("base64");

beforeAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [USER, OTHER]);
  await adminDb.insert(journalEntries).values({
    id: ENTRY,
    companyId: ORG,
    number: "JE-ATTACH-1",
    date: "2026-11-01",
    description: "Jurnal lampiran uji",
    sourceType: "manual",
    status: "draft",
    createdBy: USER,
  });
});

afterAll(async () => {
  await wipeCompanyFixture(adminSql, ORG, [USER, OTHER]);
});

describe("lampiran bukti dokumen", () => {
  it("menyimpan, membaca, dan menghapus lampiran jurnal", async () => {
    const saved = await withCompany(ORG, (tx) =>
      saveAttachment(tx, {
        companyId: ORG,
        userId: USER,
        entityType: "journal_entry",
        entityId: ENTRY,
        fileName: "transfer.pdf",
        mimeType: "application/pdf",
        contentBase64: BASE64,
      }),
    );
    expect(saved.fileName).toBe("transfer.pdf");

    const list = await withCompany(ORG, (tx) =>
      listAttachments(tx, ORG, "journal_entry", ENTRY),
    );
    expect(list.map((row) => row.id)).toContain(saved.id);

    const row = await withCompany(ORG, (tx) => getAttachment(tx, ORG, saved.id));
    expect(Buffer.from(row.contentBase64, "base64").toString()).toBe("bukti transfer uji");

    await withCompany(ORG, (tx) =>
      deleteAttachment(tx, {
        companyId: ORG,
        userId: USER,
        id: saved.id,
        canManage: false,
      }),
    );
    expect(await withCompany(ORG, (tx) => listAttachments(tx, ORG, "journal_entry", ENTRY))).toEqual([]);
  });

  it("menolak jenis berkas yang tidak diizinkan", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        saveAttachment(tx, {
          companyId: ORG,
          userId: USER,
          entityType: "journal_entry",
          entityId: ENTRY,
          fileName: "script.js",
          mimeType: "text/javascript",
          contentBase64: BASE64,
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("pengguna lain tanpa izin kelola tidak dapat menghapus lampiran orang lain", async () => {
    const saved = await withCompany(ORG, (tx) =>
      saveAttachment(tx, {
        companyId: ORG,
        userId: USER,
        entityType: "journal_entry",
        entityId: ENTRY,
        fileName: "foto.png",
        mimeType: "image/png",
        contentBase64: BASE64,
      }),
    );
    await expect(
      withCompany(ORG, (tx) =>
        deleteAttachment(tx, {
          companyId: ORG,
          userId: OTHER,
          id: saved.id,
          canManage: false,
        }),
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("menolak lampiran untuk jurnal perusahaan lain", async () => {
    await expect(
      withCompany(ORG, (tx) =>
        saveAttachment(tx, {
          companyId: ORG,
          userId: USER,
          entityType: "journal_entry",
          entityId: "01900000-0000-7000-8000-00000000ffff",
          fileName: "x.pdf",
          mimeType: "application/pdf",
          contentBase64: BASE64,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
