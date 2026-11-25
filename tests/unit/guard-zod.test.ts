import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { AppError, guard, zodValidationMessage } from "@/lib/errors";
import { parseInput } from "@/lib/action-validation";

// FIX-ARS Tahap 1 (ARS1-03): 62 titik `.parse()` mentah di lapisan
// actions melempar ZodError mentah; guard() dulu hanya mengenal AppError
// dan pelanggaran unik, sehingga kesalahan input biasa tampil sebagai
// INTERNAL "Terjadi kesalahan pada server" (kelas bug A-13). guard()
// kini memetakan ZodError -> VALIDATION dengan formatter isu yang sama
// dengan parseInput, menutup seluruh 62 titik dari satu tempat.

const itemSchema = z.object({
  name: z.string().min(1, "Nama wajib diisi."),
  lines: z
    .array(z.object({ qty: z.number().positive("Qty harus lebih dari 0.") }))
    .min(1, "Minimal satu baris."),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("guard() memetakan ZodError -> VALIDATION", () => {
  it("skema nyata yang gagal .parse() memberi VALIDATION + pesan field, bukan INTERNAL", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await guard(async () => {
      itemSchema.parse({ name: "", lines: [{ qty: 1 }] });
      return "tidak sampai";
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("Nama wajib diisi.");
      expect(result.message).not.toContain("Terjadi kesalahan pada server");
    }
  });

  it("isu pada baris `lines` diberi awalan nomor baris, sama seperti parseInput", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await guard(async () => {
      itemSchema.parse({ name: "Ok", lines: [{ qty: -2 }] });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("VALIDATION");
      expect(result.message).toContain("Baris 1: Qty harus lebih dari 0.");
    }
  });

  it("pesan validasi tidak membocorkan stack atau path berkas internal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await guard(async () => {
      itemSchema.parse({ name: "", lines: [] });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).not.toMatch(/\n\s+at\s/);
      expect(result.message).not.toContain("src/");
      expect(result.message).not.toContain("ZodError");
    }
  });

  it("ZodError tidak dicatat sebagai error server tak terduga", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await guard(async () => {
      itemSchema.parse({ name: "", lines: [{ qty: 1 }] });
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("guard() — perilaku lama tidak berubah", () => {
  it("AppError diteruskan apa adanya", async () => {
    const result = await guard(async () => {
      throw new AppError("FORBIDDEN", "Tidak berhak.");
    });
    expect(result).toEqual({ ok: false, code: "FORBIDDEN", message: "Tidak berhak." });
  });

  it("pelanggaran unik 23505 terbungkus cause tetap CONFLICT berpesan Indonesia", async () => {
    const inner = Object.assign(new Error("duplicate key"), {
      code: "23505",
      constraint: "products_company_sku_uq",
    });
    const result = await guard(async () => {
      throw new Error("Failed query", { cause: inner });
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("CONFLICT");
      expect(result.message).toContain("SKU produk");
    }
  });

  it("error generik tetap INTERNAL tanpa membocorkan teks error asli ke pengguna", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await guard(async () => {
      throw new Error("detail internal: koneksi ke 10.0.0.9 gagal");
    });
    expect(result).toEqual({
      ok: false,
      code: "INTERNAL",
      message: "Terjadi kesalahan pada server. Coba lagi.",
    });
  });
});

describe("zodValidationMessage + parseInput berbagi formatter yang sama", () => {
  it("mengembalikan null untuk error non-Zod", () => {
    expect(zodValidationMessage(new Error("biasa"))).toBeNull();
    expect(zodValidationMessage(null)).toBeNull();
    expect(zodValidationMessage("string")).toBeNull();
  });

  it("pesan dari guard() identik dengan pesan AppError dari parseInput untuk input yang sama", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const bad = { name: "", lines: [{ qty: 0 }] };
    let parseMessage = "";
    try {
      parseInput(itemSchema, bad);
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      parseMessage = (error as AppError).message;
    }
    const result = await guard(async () => itemSchema.parse(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBe(parseMessage);
    expect(parseMessage).toContain("Nama wajib diisi.");
    expect(parseMessage).toContain("Baris 1: Qty harus lebih dari 0.");
  });
});

describe("guard() mempertahankan control flow Next.js", () => {
  it("melempar ulang NEXT_REDIRECT agar redirect login tidak menjadi INTERNAL", async () => {
    const redirectError = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    await expect(
      guard(async () => {
        throw redirectError;
      }),
    ).rejects.toBe(redirectError);
  });

  it("melempar ulang NEXT_NOT_FOUND", async () => {
    const notFoundError = Object.assign(new Error("NEXT_NOT_FOUND"), {
      digest: "NEXT_NOT_FOUND",
    });
    await expect(
      guard(async () => {
        throw notFoundError;
      }),
    ).rejects.toBe(notFoundError);
  });
});
