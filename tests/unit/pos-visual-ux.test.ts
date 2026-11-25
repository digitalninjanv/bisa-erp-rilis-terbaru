import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression visual/UX POS 2026-11-23.
 *
 * Kontrak sumber untuk perbaikan yang sulit diuji tanpa browser:
 * urutan formulir retur, footer pembayaran di luar kartu, kartu mutasi,
 * tabel riwayat sesi ringkas, focus trap ConfirmDialog, dan target
 * sentuh halaman pendukung.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (relative: string) => readFileSync(path.join(ROOT, "src", relative), "utf8");

describe("POS visual/UX — formulir retur", () => {
  const form = source("components/pos/return-form.tsx");

  it("membaca urutan 1 barang → 2 kondisi → 3 alasan → 4 penyelesaian", () => {
    const items = form.indexOf("1 · Barang yang diretur");
    const condition = form.indexOf("2 · Kondisi dan penanganan barang");
    const reason = form.indexOf("3 · Alasan retur");
    const settlement = form.indexOf("4 · Penyelesaian");
    expect(items).toBeGreaterThan(-1);
    expect(condition).toBeGreaterThan(items);
    expect(reason).toBeGreaterThan(condition);
    expect(settlement).toBeGreaterThan(reason);
  });

  it("menjelaskan syarat tombol nonaktif dan tidak memakai footer sticky", () => {
    expect(form).toContain("missingRequirements");
    expect(form).toContain("Lengkapi: {missingRequirements.join");
    expect(form).not.toContain("sticky bottom-0 z-10 -mx-4");
  });

  it("memakai kontrol sentuh 44px untuk qty, alasan, dan penyelesaian", () => {
    expect(form).toContain('wrapperClassName="h-11 w-20 shrink-0"');
    expect(form).toContain("h-11 rounded-full");
    expect(form).toContain('className="h-11 w-full rounded-md border border-input bg-background px-3 text-[13px]"');
  });
});

describe("POS visual/UX — panel pembayaran", () => {
  const panel = source("components/pos/payment-panel.tsx");

  it("menaruh footer Bayar/Tahan di luar kartu dan tetap sticky", () => {
    expect(panel).toContain("Footer sengaja di luar kartu");
    expect(panel).toContain("sticky bottom-0 z-10 grid");
    expect(panel).not.toContain("sticky bottom-0 -mx-4 -mb-4");
  });

  it("mempertahankan target input F4 dan tombol Bayar 48px", () => {
    expect(panel).toContain("pos-tendered-input");
    expect(panel).toContain("h-12 items-center justify-center gap-2 rounded-md bg-[var(--pos-action)]");
  });

  it("menampilkan dua metode alternatif tanpa membuka Metode lain", () => {
    expect(panel).toContain("quickMethods");
    expect(panel).toContain("aria-label={`Pilih ${method.name}`}");
  });

  it("sheet mobile memakai bottom sheet native dan bar menampilkan item terakhir", () => {
    const terminal = source("components/pos/pos-terminal.tsx");
    const bar = source("components/pos/terminal/mobile-pay-bar.tsx");
    expect(terminal).toContain('side="bottom"');
    expect(terminal).toContain('height: "92dvh"');
    expect(terminal).toContain("lastItemName=");
    expect(bar).toContain("lastItemName");
  });
});

describe("POS visual/UX — tabel & sesi", () => {
  const session = source("components/pos/session-manager.tsx");
  const history = source("components/pos/session-history-list.tsx");

  it("Mutasi kas punya fallback kartu dan region yang bisa difokus", () => {
    expect(session).toContain('role="region"');
    expect(session).toContain('aria-label="Mutasi kas"');
    expect(session).toContain("formatDateTime(row.createdAt)");
    expect(session).not.toContain("row.createdAt.slice(0, 16)");
  });

  it("riwayat sesi tidak lagi memaksa kolom Status terpisah", () => {
    expect(history).not.toContain("<th scope=\"col\">Status</th>");
    expect(history).toContain("Mutasi");
    expect(history).toContain("masuk / keluar");
    expect(history).toContain("SessionStatusBadge status={row.status}");
  });

  it("tanggal sesi memakai formatter id-ID yang sama", () => {
    expect(session).toContain("Dibuka {formatDateTime(session.openedAt)}");
  });
});

describe("POS visual/UX — dialog & shell", () => {
  const dialog = source("components/blocks/confirm-dialog.tsx");
  const palette = source("components/shell/command-palette.tsx");
  const switcher = source("components/shell/app-switcher.tsx");

  it("ConfirmDialog menahan Tab dan memulihkan fokus", () => {
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("last.focus()");
    expect(dialog).toContain("previousFocusRef");
    expect(dialog).toContain("h-11 rounded-md");
  });

  it("pencarian global disembunyikan di POS mobile dan labelnya cocok", () => {
    expect(palette).toContain("hideOnPosMobile");
    expect(palette).toContain('aria-label="Cari apa saja — Ctrl K"');
  });

  it("pemicu modul menyertakan nama & tagline yang terlihat", () => {
    expect(switcher).toContain("aria-label={`Navigasi aplikasi — ${active.name} ${active.tagline}`}");
  });
});

describe("POS visual/UX — target sentuh bersama", () => {
  it("date field dan filter memakai 44px di layar kecil", () => {
    const date = source("components/date-field.tsx");
    expect(date).toContain("h-11 w-full");
    expect(date).toContain("w-11 place-items-center");
    const list = source("components/blocks/data-list.tsx");
    expect(list).toContain("h-11 w-full");
    expect(list).toContain("lg:h-9");
  });

  it("pagination dan row menu memakai 44px di bawah lg", () => {
    expect(source("components/blocks/pagination.tsx")).toContain("size-11");
    expect(source("components/blocks/row-menu.tsx")).toContain("size-11");
  });

  it("pencarian produk punya tombol hapus dan empty state recovery", () => {
    const catalog = source("components/pos/terminal/product-catalog.tsx");
    expect(catalog).toContain('aria-label="Hapus pencarian produk"');
    expect(catalog).toContain("Hapus pencarian");
  });
});
