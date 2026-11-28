import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Kontrak UX jurnal manual: memo per baris, salin jurnal, dan pintasan
 * simpan yang tidak menghilangkan guard keseimbangan/periode.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (relative: string) => readFileSync(path.join(ROOT, "src", relative), "utf8");

describe("UX jurnal manual", () => {
  const form = source("components/akuntansi/journal-entry-form.tsx");

  it("mengekspos memo per baris dan mengirimkannya ke server", () => {
    expect(form).toContain("Memo baris");
    expect(form).toContain("line.description");
    expect(form).toContain("description: line.description");
  });

  it("menyediakan salin jurnal dari detail ke form baru", () => {
    const detail = source("app/app/akuntansi/(akuntansi)/jurnal/[id]/page.tsx");
    const history = source("components/akuntansi/journal-history-table.tsx");
    const newPage = source("app/app/akuntansi/(akuntansi)/jurnal/baru/page.tsx");
    expect(detail).toContain("Duplikat");
    expect(detail).toContain("/app/akuntansi/jurnal/baru?from=");
    expect(history).toContain("Duplikat");
    expect(history).toContain("/app/akuntansi/jurnal/baru?from=");
    expect(newPage).toContain("getJournalDetail");
    expect(newPage).toContain("params.from");
    expect(form).toContain("copyFrom");
    expect(source("server/reports/journal.ts")).toContain("accountId: journalLines.accountId");
  });

  it("menampilkan approval dan lampiran bukti di detail jurnal", () => {
    const detail = source("app/app/akuntansi/(akuntansi)/jurnal/[id]/page.tsx");
    const actions = source("components/akuntansi/journal-draft-actions.tsx");
    const attachments = source("components/akuntansi/document-attachments.tsx");
    expect(detail).toContain("DocumentAttachments");
    expect(detail).toContain("approvalStatus");
    expect(actions).toContain("approveJournalDraftAction");
    expect(actions).toContain("rejectJournalDraftAction");
    expect(attachments).toContain("deleteAttachmentAction");
    expect(attachments).toContain("Lampiran bukti");
  });

  it("pengaturan menyediakan ambang approval jurnal", () => {
    expect(source("components/pengaturan/forms/identitas-pajak.tsx")).toContain(
      "journalApprovalThreshold",
    );
  });

  it("mendukung Ctrl/Cmd+Enter untuk posting dan Ctrl/Cmd+S untuk draf", () => {
    expect(form).toContain("metaKey");
    expect(form).toContain("ctrlKey");
    expect(form).toContain('"Enter"');
    expect(form).toContain('"s"');
  });
});
