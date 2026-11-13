// FIX-ARS Tahap 5 (ARS2-01): tipe bersama terminal POS — dipindah apa adanya
// dari pos-terminal.tsx agar hook & panel hasil ekstraksi dapat memakainya
// tanpa impor melingkar ke komponen induk.

/** Program Satuan Kemasan S4: kemasan aktif produk untuk terminal. */
export type PackagingOption = {
  id: string;
  name: string;
  /** Isi ke satuan dasar (string numeric dari master). */
  isi: string;
  /** Harga jual per kemasan; null = jatuh ke isi × harga satuan dasar. */
  salePrice: string | null;
  barcode: string | null;
  isDefaultSale: boolean;
};

export type ProductOption = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  salePrice: string;
  stock: number;
  // POS-1: produk jasa (trackStock=false) tidak pernah "habis".
  trackStock: boolean;
  trackSerial?: boolean;
  unitCode: string;
  /** S4: kemasan aktif produk (pemilih satuan baris + resolusi pindai). */
  packagings?: PackagingOption[];
  /** S4: terisi bila kata cari/pindaian cocok persis dengan barcode
   *  kemasan produk ini — baris yang ditambahkan adalah kemasan itu. */
  matchedPackagingId?: string | null;
};

/** FIX-GDG Tahap 4 (butir b): reservasi aktif yang dapat ditautkan. */
export type TerminalReservation = {
  id: string;
  number: string;
  warehouseId: string;
  productId: string;
  productName: string;
  productSku: string;
  qty: string;
  expiresAt: string | null;
  reason: string | null;
};

// POS-1 (D-19): pelanggan yang ditangkap untuk penjualan utang.
export type CustomerOption = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  creditLimit: number;
};

export type Method = {
  id: string;
  code: string;
  name: string;
  type: string;
  instructions: string | null;
  // A-21 Tahap R3-A (R3-01): konfigurasi tarif fee/MDR metode
  // (opsional agar muatan offline lama tetap valid).
  feeEnabled?: boolean;
  feeType?: string;
  feeValue?: string;
};

export type CartItem = {
  productId: string;
  /**
   * Jumlah dalam BENTUK MASUKAN baris: satuan dasar bila
   * packagingId kosong, atau jumlah kemasan ("1" = 1 Dus) bila
   * terisi (S4). Konversi ke satuan dasar terjadi di quote server.
   */
  qty: number;
  discountType?: "percent" | "nominal" | null;
  discountValue?: number;
  /** SIM-2 S7B-2 Batch 5: seri terpilih per unit (produk track_serial). */
  serialNumbers?: string[];
  /** S4: kemasan baris; null/absen = satuan dasar. */
  packagingId?: string | null;
};

/** S4: identitas baris keranjang = (produk, kemasan). */
export function cartLineKey(line: { productId: string; packagingId?: string | null }): string {
  return `${line.productId}|${line.packagingId ?? ""}`;
}

/** S4: faktor isi baris dari katalog lokal (1 untuk satuan dasar). */
export function cartLineIsi(
  line: { packagingId?: string | null },
  product: ProductOption | undefined,
): number {
  if (!line.packagingId) return 1;
  const pack = product?.packagings?.find((row) => row.id === line.packagingId);
  const isi = Number(pack?.isi ?? 1);
  return Number.isFinite(isi) && isi > 0 ? isi : 1;
}

/** S4: qty satuan dasar baris (qty input × isi) untuk penilaian stok & seri. */
export function cartLineBaseQty(line: CartItem, product: ProductOption | undefined): number {
  return line.qty * cartLineIsi(line, product);
}

export type PaymentEntry = {
  amount: string;
  tendered: string;
  reference: string;
  /** A-21 Tahap R3-A (R3-01): fee final per pembayaran (string kosong = bawaan konfigurasi). */
  fee?: string;
};

export type PosTerminalProps = {
  companyId: string;
  userId: string;
  companyName: string;
  warehouseId: string;
  warehouses: { id: string; name: string; code: string }[];
  methods: Method[];
  creditMethod: { id: string; name: string } | null;
  debtMethod: { id: string; name: string } | null;
  initialProducts: ProductOption[];
  qrisImage: string | null;
  groups: { id: string; name: string; roundingStep: number; roundingDirection: string; roundCashTotal: boolean }[];
  sessionOpen: boolean;
  sessionId?: string | null;
  heldCount: number;
  resumeId: string | null;
  posOfflineEnabled?: boolean;
  offlineTaxRate?: number;
  offlineRoundingMode?: string;
  receivableDefaultTermDays?: number;
  reservations?: TerminalReservation[];
};
