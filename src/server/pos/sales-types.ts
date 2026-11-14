// FIX-ARS Tahap 4: bagian dari pemecahan src/server/pos.ts mengikuti jahitan
// domain yang sudah ada di dalamnya. Perilaku tidak berubah;
// jalur impor publik tetap lewat src/server/pos.ts.
// A-26 Q8b: tipe masukan penjualan dipusatkan di berkas daun ini agar
// pecahan sales-* saling mengimpor tanpa siklus type.

import type { CartLineInput } from "./quote";

export type PaymentInput = {
  methodId: string;
  amount: string | number;
  tendered?: string | number;
  reference?: string;
  /**
   * A-21 Tahap R3-A (R3-01): fee/MDR final untuk pembayaran ini.
   * Kosong = bawaan konfigurasi metode (0 bila fee metode nonaktif);
   * terisi = keputusan kasir di panel pembayaran, divalidasi terhadap
   * konfigurasi metode (fee pada metode nonaktif ditolak).
   */
  fee?: string | number;
};


export type CreateSaleInput = {
  companyId: string;
  userId: string;
  warehouseId: string;
  customerId?: string | null;
  // POS-1 (D-19): jatuh tempo penjualan utang — wajib bila ada porsi
  // piutang; ditegakkan di blok piutang di bawah.
  dueDate?: string | null;
  groupId?: string | null;
  date: string;
  lines: CartLineInput[];
  payments: PaymentInput[];
  notes?: string;
  idempotencyKey: string;
  /** Fingerprint payload bisnis asli untuk membedakan retry identik dari penggunaan ulang key. */
  idempotencyFingerprint?: string;
  // POS-DISC-01: diteruskan ke quoteCart (izin `pos.discount` aktor).
  canDiscount?: boolean;
  // FIX-POS Tahap 2 (POS3-02): sesi kas target yang eksplisit —
  // sesi ASAL penjualan offline. Bila diisi, sesi dikunci dan
  // divalidasi milik userId (kasir asal); pencarian sesi terbuka
  // milik aktor tidak dipakai. HANYA jalur server (sinkronisasi &
  // peninjauan offline) yang boleh mengisinya.
  sessionId?: string;
  // FIX-POS Tahap 2 (POS3-03): mode penyelesaian offline untuk sesi
  // asal yang SUDAH TERTUTUP. Sesi tertutup tidak dapat diubah: tidak
  // ada mutasi kas baru ke dalamnya (expectedCash-nya tidak bergerak
  // lagi), dan kaki kas tunai jurnal dialihkan lebih dulu ke akun
  // selisih kas lebih sesi itu sampai `overageLimit` — uang fisiknya
  // sudah terjurnal sebagai kas lebih saat sesi ditutup, jadi
  // mendebit Kas lagi akan menghitung uang yang sama dua kali.
  offlineSettlement?: { overageLimit?: string | number };
  // FIX-POS Tahap 2 (POS3-04): diteruskan ke quoteCart — posting
  // pada harga snapshot struk offline (lihat QuoteContext).
  frozenPrices?: boolean;
  // FIX-GDG Tahap 2 (GDG1-09): reservasi yang dipenuhi penjualan ini
  // (lihat QuoteContext.reservationId); dikonsumsi atomik di ekor.
  reservationId?: string | null;
  /** Mengizinkan produk non-aktif untuk sinkronisasi transaksi offline historis (POS-008). */
  allowInactiveProducts?: boolean;
};
