import { describe, expect, it } from "vitest";
import { statusLabel } from "@/components/blocks/status-badge";

/**
 * A-22 Tahap K4 (UX-12): label status jurnal harus SATU bahasa di
 * daftar, detail, dan CETAK. Daftar & detail memakai StatusBadge;
 * cetak jurnal dulu mencetak status mentah basis data ("posted").
 * statusLabel adalah pemetaan bersama di belakang keduanya.
 */

describe("statusLabel", () => {
  it("status jurnal diterjemahkan seperti lencana daftar/detail", () => {
    expect(statusLabel("posted")).toBe("Terposting");
    expect(statusLabel("draft")).toBe("Draf");
    expect(statusLabel("void")).toBe("Batal");
  });

  it("status tak dikenal dikembalikan apa adanya (tanpa mengarang)", () => {
    expect(statusLabel("status-asing")).toBe("status-asing");
  });
});
