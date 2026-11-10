import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import RootError from "@/app/error";
import GlobalError from "@/app/global-error";

// =====================================================================
// Program Rekayasa — R3 K-6: batas kesalahan root & global harus
// merender bingkai aplikasi berbahasa produk (sebelumnya tidak ada —
// kegagalan di luar segmen /app jatuh ke batas bawaan framework).
// Render statis pola A4: judul & teks produk hadir; varian "Akses
// ditolak" meneruskan pesan penolakan.
// =====================================================================

describe("K-6 — error.tsx root", () => {
  it("merender judul & teks produk untuk kesalahan umum", () => {
    const html = renderToStaticMarkup(
      createElement(RootError, { error: new Error("ledakan tak terduga") }),
    );
    expect(html).toContain("Terjadi kesalahan");
    expect(html).toContain("Halaman gagal dimuat");
    expect(html).toContain("Kembali ke beranda");
    expect(html).not.toContain("ledakan tak terduga");
  });

  it("varian akses ditolak meneruskan pesan penolakan", () => {
    const html = renderToStaticMarkup(
      createElement(RootError, { error: new Error("Tidak punya akses ke modul ini.") }),
    );
    expect(html).toContain("Akses ditolak");
    expect(html).toContain("Tidak punya akses ke modul ini.");
  });
});

describe("K-6 — global-error.tsx", () => {
  it("merender dokumen html/body sendiri dengan teks produk", () => {
    const html = renderToStaticMarkup(
      createElement(GlobalError, { error: new Error("layout runtuh") }),
    );
    expect(html).toContain('<html lang="id">');
    expect(html).toContain("<body>");
    expect(html).toContain("Terjadi kesalahan");
    expect(html).toContain("Kembali ke beranda");
  });
});
