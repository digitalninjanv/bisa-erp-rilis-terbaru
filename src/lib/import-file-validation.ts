import { AppError } from "@/lib/errors";

/**
 * SEC-008 — validasi berkas impor sebelum parser membaca isi.
 *
 * - Batas body 20 MB ditegakkan saat streaming (bukan hanya header
 *   Content-Length), sehingga klien tanpa header tetap tidak bisa
 *   memaksa server membaca body raksasa.
 * - Magic bytes menentukan format sebenarnya; ekstensi yang tidak cocok
 *   ditolak agar file biner tidak disamarkan sebagai CSV.
 * - XLSX adalah ZIP: batas jumlah entri, total ukuran terdekompresi, dan
 *   rasio kompresi mencegah zip bomb.
 */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 2_000;
export const MAX_ZIP_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
export const MAX_ZIP_COMPRESSION_RATIO = 100;

export type ImportFileKind = "xlsx" | "xls" | "csv";

export class ImportFileTooLargeError extends Error {
  constructor() {
    super(`Ukuran file maksimum ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB.`);
    this.name = "ImportFileTooLargeError";
  }
}

const ZIP_MAGICS = [
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.from([0x50, 0x4b, 0x07, 0x08]),
];
const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.length >= magic.length && buffer.subarray(0, magic.length).equals(magic);
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

function looksLikeText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 16_384));
  if (sample.includes(0)) return false;
  // CSV sah tidak boleh berisi byte kontrol selain tab/CR/LF.
  let control = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32) || byte === 127) control += 1;
  }
  if (control > Math.max(2, sample.length * 0.01)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

type ZipInfo = { entries: number; totalUncompressed: number; totalCompressed: number };

function readZipInfo(buffer: Buffer): ZipInfo {
  if (buffer.length < 22) {
    throw new AppError("VALIDATION", "Berkas XLSX tidak valid (ZIP terlalu pendek).");
  }
  const min = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let i = buffer.length - 22; i >= min; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new AppError("VALIDATION", "Berkas XLSX tidak valid (direktori ZIP tidak ditemukan).");
  }
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0) {
    throw new AppError("VALIDATION", "Berkas XLSX tidak berisi lembar kerja.");
  }
  if (entries > MAX_ZIP_ENTRIES) {
    throw new AppError(
      "VALIDATION",
      `Berkas XLSX memiliki terlalu banyak entri (${entries}); maksimum ${MAX_ZIP_ENTRIES}.`,
    );
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new AppError("VALIDATION", "Berkas XLSX tidak valid (direktori ZIP melewati akhir berkas).");
  }

  let offset = cdOffset;
  let count = 0;
  let totalUncompressed = 0;
  let totalCompressed = 0;
  const end = cdOffset + cdSize;
  while (offset + 46 <= end) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressed = buffer.readUInt32LE(offset + 20);
    const uncompressed = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    totalCompressed += compressed;
    totalUncompressed += uncompressed;
    count += 1;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (count === 0) {
    throw new AppError("VALIDATION", "Berkas XLSX tidak valid (tidak ada entri ZIP yang terbaca).");
  }
  if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
    throw new AppError(
      "VALIDATION",
      `Isi XLSX terlalu besar setelah dekompresi (maksimum ${Math.round(MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024)}MB).`,
    );
  }
  if (totalCompressed > 0 && totalUncompressed / totalCompressed > MAX_ZIP_COMPRESSION_RATIO) {
    throw new AppError("VALIDATION", "Rasio kompresi XLSX mencurigakan (kemungkinan zip bomb).");
  }
  return { entries, totalUncompressed, totalCompressed };
}

/**
 * Validasi format berdasarkan magic bytes + ekstensi. Mengembalikan
 * format yang terdeteksi; melempar AppError VALIDATION bila tidak sah.
 */
export function validateImportFile(buffer: Buffer, fileName: string): { kind: ImportFileKind } {
  if (buffer.length === 0) {
    throw new AppError("VALIDATION", "Berkas kosong.");
  }
  const ext = extensionOf(fileName);
  if (!["xlsx", "xls", "csv"].includes(ext)) {
    throw new AppError("VALIDATION", "Format berkas harus XLSX, XLS, atau CSV.");
  }

  if (ZIP_MAGICS.some((magic) => startsWith(buffer, magic))) {
    if (ext !== "xlsx") {
      throw new AppError("VALIDATION", "Isi berkas adalah ZIP/XLSX, bukan format yang sesuai ekstensi.");
    }
    readZipInfo(buffer);
    return { kind: "xlsx" };
  }

  if (startsWith(buffer, OLE_MAGIC)) {
    if (ext !== "xls") {
      throw new AppError("VALIDATION", "Isi berkas adalah XLS lama, bukan format yang sesuai ekstensi.");
    }
    return { kind: "xls" };
  }

  if (ext === "csv" && looksLikeText(buffer)) {
    return { kind: "csv" };
  }

  throw new AppError(
    "VALIDATION",
    "Isi berkas tidak dikenali atau tidak cocok dengan ekstensinya. Gunakan XLSX, XLS, atau CSV yang valid.",
  );
}

/**
 * Baca multipart dengan batas byte saat streaming. Content-Length tetap
 * diperiksa route sebagai fast-path; fungsi ini menutup klien chunked
 * yang tidak mengirim header panjang.
 */
export async function readFormDataWithLimit(
  request: Request,
  maxBytes = MAX_IMPORT_BYTES,
): Promise<FormData> {
  const body = request.body;
  if (!body) return request.formData();

  let total = 0;
  const limited = body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new ImportFileTooLargeError());
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );

  const init = {
    method: "POST",
    headers: request.headers,
    body: limited,
    duplex: "half",
  } as RequestInit & { duplex: "half" };

  try {
    return await new Request(request.url, init).formData();
  } catch (error) {
    if (error instanceof ImportFileTooLargeError || total > maxBytes) {
      throw new ImportFileTooLargeError();
    }
    throw error;
  }
}
