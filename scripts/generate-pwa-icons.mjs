// A-24 T6B — pembangkit ikon PWA terminal (public/icon-192.png &
// public/icon-512.png) tanpa dependensi grafis apa pun: encoder PNG
// minimal di atas node:zlib. Motif: etalase toko geometris (atap
// bergaris + badan + pintu) putih di atas warna primer aplikasi
// (#714b67, globals.css --primary) — digambar prosedural dalam ruang
// 512 lalu diskalakan, supaya kedua ukuran konsisten.
//
// Jalankan: node scripts/generate-pwa-icons.mjs
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BG = [0x71, 0x4b, 0x67, 0xff];
const FG = [0xff, 0xff, 0xff, 0xff];

function pixelAt(x, y) {
  // Atap bergaris: pita trapesium y 150..218, menyempit ke bawah,
  // garis vertikal berselang putih/latar selebar 28.
  if (y >= 150 && y < 218) {
    const inset = 106 + ((y - 150) / 68) * 20;
    if (x >= inset && x < 512 - inset) {
      return Math.floor(x / 28) % 2 === 0 ? FG : BG;
    }
  }
  // Badan toko: persegi putih y 218..392, x 146..366.
  if (x >= 146 && x < 366 && y >= 218 && y < 392) {
    // Pintu tengah bawah.
    if (x >= 228 && x < 284 && y >= 284) return BG;
    // Dua jendela.
    if (y >= 248 && y < 308 && ((x >= 164 && x < 212) || (x >= 300 && x < 348))) return BG;
    return FG;
  }
  return BG;
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    crc32.table = table;
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(Math.floor((x / size) * 512), Math.floor((y / size) * 512));
      const off = rowStart + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const target = path.join(ROOT, "public", `icon-${size}.png`);
  fs.writeFileSync(target, encodePng(size));
  console.log(`tertulis ${target}`);
}
