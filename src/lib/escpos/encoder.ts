import type { PaperWidth, PrintAlignment } from "./types";

/**
 * Pure TypeScript ESC/POS Binary Encoder.
 * Berjalan di peramban (client-side) maupun Node.js/Edge tanpa dependensi native.
 */
export class EscPosEncoder {
  private buffer: number[] = [];
  private widthChars: number;

  constructor(paperWidth: PaperWidth = "58mm") {
    this.widthChars = paperWidth === "80mm" ? 48 : 32;
    this.init();
  }

  /** Inisialisasi printer (ESC @) */
  init(): this {
    this.buffer.push(0x1b, 0x40);
    return this;
  }

  /** Atur perataan teks (ESC a n) */
  align(alignment: PrintAlignment): this {
    const val = alignment === "center" ? 1 : alignment === "right" ? 2 : 0;
    this.buffer.push(0x1b, 0x61, val);
    return this;
  }

  /** Tebal teks (ESC E n) */
  bold(enable = true): this {
    this.buffer.push(0x1b, 0x45, enable ? 1 : 0);
    return this;
  }

  /** Ukuran teks (GS ! n) */
  size(doubleWidth = false, doubleHeight = false): this {
    let n = 0;
    if (doubleWidth) n |= 0x10;
    if (doubleHeight) n |= 0x01;
    this.buffer.push(0x1d, 0x21, n);
    return this;
  }

  /** Tulis teks tanpa ganti baris */
  text(str: string): this {
    // Normalisasi unicode dan transliterasi tanda baca umum ke ASCII
    const normalized = str
      .replace(/[\u2014\u2013]/g, "-")
      .replace(/\u2022/g, "*")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\u2026/g, "...")
      .replace(/\u00b0/g, " deg")
      .replace(/\u00d7/g, "x")
      .replace(/\u00f7/g, "/")
      .replace(/\u00b1/g, "+/-")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i);
      // Teks tidak boleh membawa byte kontrol: ESC/POS memakai ESC/GS
      // sebagai awal perintah (mis. potong kertas). Newline ditangani
      // line(), bukan text().
      this.buffer.push(code < 0x20 || code === 0x7f ? 0x20 : code < 128 ? code : 0x20);
    }
    return this;
  }

  /** Tulis teks diikuti ganti baris (LF) */
  line(str = ""): this {
    this.text(str);
    this.buffer.push(0x0a);
    return this;
  }

  /** Garis pemisah horizontal penuh sesuai lebar kertas */
  divider(char = "-"): this {
    this.line(char.repeat(this.widthChars));
    return this;
  }

  /**
   * Baris 2 kolom rata kiri dan kanan (misal: "Item XYZ", "Rp 15.000").
   * Bila teks kiri terlalu panjang, teks kiri akan dipecah ke baris tersendiri.
   */
  row(left: string, right: string): this {
    const rightLen = right.length;
    const maxLeftLen = this.widthChars - rightLen - 1;

    if (maxLeftLen <= 0) {
      this.line(left);
      this.align("right").line(right).align("left");
      return this;
    }

    if (left.length <= maxLeftLen) {
      const spaces = this.widthChars - left.length - rightLen;
      this.line(left + " ".repeat(Math.max(1, spaces)) + right);
    } else {
      // Teks kiri terlalu panjang: tulis teks kiri di baris pertama,
      // lalu baris kedua berisi spasi + teks kanan
      this.line(left);
      this.align("right").line(right).align("left");
    }
    return this;
  }

  /**
   * Baris 3 kolom (Kiri, Tengah, Kanan).
   */
  row3(col1: string, col2: string, col3: string): this {
    const total = this.widthChars;
    const len3 = col3.length;
    const remaining = total - len3;
    const len1 = col1.length;
    const len2 = col2.length;
    const spaces1 = Math.max(1, Math.floor((remaining - len1 - len2) / 2));
    const spaces2 = Math.max(1, total - len1 - spaces1 - len2 - len3);
    this.line(col1 + " ".repeat(spaces1) + col2 + " ".repeat(spaces2) + col3);
    return this;
  }

  /** Pakan kertas beberapa baris (ESC d n) */
  feed(lines = 3): this {
    this.buffer.push(0x1b, 0x64, Math.min(255, Math.max(1, lines)));
    return this;
  }

  /** Buka laci kasir via pulsa RJ11 (ESC p 0 t1 t2) */
  pulseDrawer(): this {
    this.buffer.push(0x1b, 0x70, 0x00, 0x19, 0xfa);
    return this;
  }

  /** Potong kertas (GS V 66 0: cut with feed) */
  cut(): this {
    this.feed(3);
    this.buffer.push(0x1d, 0x56, 0x42, 0x00);
    return this;
  }

  /** Set margin kiri dalam dots (GS L nL nH) */
  leftMargin(dots = 0): this {
    const d = Math.max(0, Math.min(65535, Math.floor(dots)));
    const nL = d % 256;
    const nH = Math.floor(d / 256);
    this.buffer.push(0x1d, 0x4c, nL, nH);
    return this;
  }

  /**
   * Cetak QR Code sederhana menggunakan perintah ESC/POS native (Model 2).
   */
  qrCode(content: string): this {
    if (!content) return this;
    const textBytes: number[] = [];
    for (let i = 0; i < content.length; i++) {
      textBytes.push(content.charCodeAt(i) & 0xff);
    }
    const len = textBytes.length + 3;
    const pL = len % 256;
    const pH = Math.floor(len / 256);

    // 1. Model: Model 2
    this.buffer.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    // 2. Module size (Ukuran): 4
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x04);
    // 3. Error correction level: L (7%)
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x30);
    // 4. Store data in symbol storage area
    this.buffer.push(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30, ...textBytes);
    // 5. Print the symbol data in symbol storage area
    this.buffer.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
    return this;
  }

  /** Hasil encode dalam bentuk Uint8Array untuk dikirim ke stream Bluetooth / USB */
  encode(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}
