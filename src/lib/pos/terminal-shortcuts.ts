/**
 * A-28 UI-1 (UX-B03): peta pintasan keyboard terminal POS — satu-satunya
 * sumber kebenaran bagi handler global terminal (use-terminal-shortcuts)
 * dan daftar bantuan yang dilihat kasir (terminal/shortcut-help).
 *
 * Pilihan kunci menghindari tabrakan yang diketahui:
 * - F5 (muat ulang), F11 (layar penuh), F12 (devtools) milik browser.
 * - Ctrl+K sudah menjadi palet perintah global; Ctrl/Cmd tidak dipakai.
 * - Penangkap scanner wedge mengabaikan tombol non-karakter dan
 *   tombol bermodifier, jadi tombol fungsi & Alt tidak mengganggunya.
 * - F7 dihindari (dialog caret browsing di sebagian browser).
 */
export type TerminalShortcutAction =
  | "focus-search"
  | "focus-tendered"
  | "exact-cash"
  | "hold"
  | "pay"
  | "toggle-mode";

export type TerminalShortcutKeyEvent = {
  key: string;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

/**
 * Petakan satu keydown menjadi aksi terminal, atau null bila bukan
 * pintasan. Ctrl/Cmd selalu ditolak (milik browser/palet perintah);
 * satu-satunya pintasan bermodifier adalah Alt+M (ganti mode).
 */
export function resolveTerminalShortcut(
  event: TerminalShortcutKeyEvent,
): TerminalShortcutAction | null {
  if (event.ctrlKey || event.metaKey) return null;
  if (event.altKey) {
    return event.key.toLowerCase() === "m" ? "toggle-mode" : null;
  }
  switch (event.key) {
    case "F2":
      return "focus-search";
    case "F4":
      return "focus-tendered";
    case "F10":
      return "exact-cash";
    case "F8":
      return "hold";
    case "F9":
      return "pay";
    default:
      return null;
  }
}

/**
 * Daftar pintasan yang ditampilkan ke kasir lewat tombol bantuan "?"
 * di terminal. Baris tanpa padanan di resolveTerminalShortcut adalah
 * pintasan lokal (kotak cari & dialog) yang ditangani komponennya
 * sendiri — tercantum di sini agar kasir menemukan semuanya di satu
 * tempat.
 */
export const TERMINAL_SHORTCUT_HELP: { keys: string; label: string }[] = [
  { keys: "F2", label: "Fokus ke kotak cari / pindai barcode" },
  { keys: "↓ / ↑", label: "Pindah sorotan pada hasil pencarian" },
  { keys: "Enter", label: "Pilih produk tersorot (dari kotak cari)" },
  { keys: "F4", label: "Fokus ke kolom Diterima (tunai tunggal)" },
  { keys: "F10", label: "Uang Pas — Diterima sebesar total (tunai tunggal)" },
  { keys: "F8", label: "Tahan pesanan" },
  { keys: "F9", label: "Bayar / selesaikan transaksi" },
  { keys: "Alt+M", label: "Ganti mode pembayaran Tunggal / Campuran" },
  { keys: "Esc", label: "Bersihkan pencarian / tutup dialog" },
];
