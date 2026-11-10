import { d, lineTax, sum, toDb, type Decimal, type MoneyInput } from "@/lib/money";

/**
 * A-12 (D-23): logika murni modal Catat Transaksi. Fungsi di sini dipakai
 * BERSAMA oleh pratinjau di klien dan posting di server, supaya angka
 * yang dilihat pengguna sebelum menekan Posting selalu persis sama
 * dengan jurnal yang terbentuk — tidak ada dua rumus yang bisa berbeda.
 */

export type QuickEntryKind = "cash_sale" | "expense" | "receive" | "pay" | "transfer";

export const QUICK_ENTRY_KIND_LABELS: Record<QuickEntryKind, string> = {
  cash_sale: "Penjualan tunai",
  expense: "Beban / pembelian",
  receive: "Terima piutang",
  pay: "Bayar utang",
  transfer: "Transfer rekening",
};

/** Bentuk formulir modal; juga bentuk payload draf server (D-23). */
export type QuickEntryPayload = {
  kind: QuickEntryKind;
  date: string;
  amount: string;
  /** Akun kas/bank: tujuan (penjualan tunai, terima piutang), sumber (beban, bayar utang). */
  accountId?: string;
  /** Akun lawan: pendapatan (penjualan tunai) atau beban/aset (beban). */
  counterAccountId?: string;
  /** Pelanggan (terima piutang; opsional juga untuk penjualan tunai
   * sebagai tag pihak baris pendapatan) atau pemasok (bayar utang). */
  partyId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  /** Biaya administrasi bank (hanya jenis transfer; A-21). Draf lama
   * tidak punya field ini — ketiadaannya berarti biaya 0. */
  fee?: string;
  /** Diskon penjualan (hanya jenis penjualan tunai; A-21 R3-05).
   * Draf lama tidak punya field ini — ketiadaannya berarti diskon 0. */
  discount?: string;
  /** Nomor referensi/bukti (transfer, terima piutang, bayar utang;
   * A-21 R3-08). Draf lama tidak punya field ini. */
  reference?: string;
  /** Pemasok untuk beban mode terutang (hanya jenis expense;
   * A-21 R3-11). Terisi = beban diakui sebagai utang ke pemasok ini
   * dan akun pembayaran tidak dipakai. Draf lama tidak punya field
   * ini — ketiadaannya berarti beban tunai seperti sebelumnya. */
  expenseSupplierId?: string;
  /** Potongan pajak pembayaran utang FIFO (hanya jenis pay; A-21
   * Tahap R3-A R3-06): jenis + tarif referensi + nominal TOTAL yang
   * didistribusikan domain mengikuti urutan dokumen. Draf lama tidak
   * punya field ini — ketiadaannya berarti tanpa potongan. */
  withholdingType?: "pph23" | "pph42";
  withholdingRate?: string;
  withholdingAmount?: string;
  taxIncluded?: boolean;
  notes?: string;
};

/** Ringkasan hasil posting yang dikembalikan aksi & disimpan untuk replay idempoten. */
export type QuickEntryPostResult = {
  kind: QuickEntryKind;
  /** Nomor dokumen/jurnal yang terbentuk, urut sesuai prosesnya. */
  numbers: string[];
  allocations?: { number: string | null; amount: string }[];
  /** FIX-R2 Tahap 3 (RV2-01): peringatan penjaga saldo kas/bank (mode
   * warn) dari jurnal-jurnal yang diposting jalur ini. */
  warnings?: string[];
};

/**
 * Belah nominal bruto penjualan tunai menjadi pendapatan bersih + PPN
 * keluaran. Pajak dihitung dengan `lineTax` inklusif yang sama seperti
 * POS (pajak = bruto × tarif / (100 + tarif)), dan bersih adalah sisa
 * pengurangannya — jadi bersih + pajak selalu tepat sama dengan bruto
 * pada ketelitian Decimal penuh.
 */
export function splitCashSale(
  gross: MoneyInput,
  ratePercent: MoneyInput,
  taxIncluded: boolean,
): { tax: Decimal; net: Decimal } {
  const total = d(gross);
  if (!taxIncluded) return { tax: d(0), net: total };
  const tax = lineTax({ net: total, rate: ratePercent, inclusive: true });
  return { tax, net: total.minus(tax) };
}

/**
 * A-21 (R3-05): belah penjualan tunai DENGAN diskon — semantik yang
 * sama persis seperti jurnal POS (pos/quote.ts + pos/sales-persist.ts):
 * pajak dihitung atas dasar sesudah diskon, pendapatan tetap dikredit
 * BRUTO (bruto − pajak), diskon didebit ke contra-revenue
 * `sales_discount`, dan kas yang diterima adalah bruto − diskon.
 * Dipakai bersama oleh pratinjau modal dan domain postQuickCashSale
 * (invariant D-23: satu rumus, bukan dua). Diskon 0 menghasilkan
 * angka yang identik dengan splitCashSale atas bruto penuh.
 */
export function splitCashSaleWithDiscount(
  gross: MoneyInput,
  ratePercent: MoneyInput,
  taxIncluded: boolean,
  discount: MoneyInput,
): { tax: Decimal; revenue: Decimal; cash: Decimal; discount: Decimal } {
  const total = d(gross);
  const disc = d(discount);
  const cash = total.minus(disc);
  const { tax, net } = splitCashSale(cash, ratePercent, taxIncluded);
  return { tax, revenue: net.plus(disc), cash, discount: disc };
}

export type FifoDoc = {
  id: string;
  number: string | null;
  outstanding: MoneyInput;
};

/**
 * Alokasi FIFO murni: dokumen diasumsikan SUDAH terurut tertua-dulu oleh
 * pemanggil (server mengurutkan per tanggal + waktu buat); fungsi ini
 * hanya membagi nominal ke dokumen satu per satu sampai habis.
 */
export function allocateFifo<T extends FifoDoc>(
  docs: T[],
  amount: MoneyInput,
): { doc: T; amount: Decimal }[] {
  let remaining = d(amount);
  const portions: { doc: T; amount: Decimal }[] = [];
  for (const doc of docs) {
    if (remaining.lte(0)) break;
    const outstanding = d(doc.outstanding);
    if (outstanding.lte(0)) continue;
    const portion = remaining.gt(outstanding) ? outstanding : remaining;
    portions.push({ doc, amount: portion });
    remaining = remaining.minus(portion);
  }
  return portions;
}

export type QuickEntryPreviewLine = {
  label: string;
  debit: string;
  credit: string;
};

export type QuickEntryPreview = {
  lines: QuickEntryPreviewLine[];
  allocations: { number: string | null; amount: string }[];
  balanced: boolean;
  totalDebit: string;
  totalCredit: string;
};

/**
 * Bangun baris jurnal pratinjau dari pilihan formulir. Label akun datang
 * dari pemanggil (klien punya daftar akun dari bootstrap; server tidak
 * memakai fungsi ini untuk posting riil kecuali penjualan tunai, yang
 * angkanya berasal dari splitCashSale yang sama).
 */
export function buildQuickEntryPreview(input: {
  kind: QuickEntryKind;
  amount: MoneyInput;
  cashAccountLabel?: string;
  counterAccountLabel?: string;
  /** Diskon penjualan tunai (R3-05): baris Dr contra-revenue. */
  discount?: MoneyInput;
  discountAccountLabel?: string;
  /** Beban mode terutang (R3-11): label akun utang terpeta — bila
   * diisi, baris kredit pratinjau beban memakai akun utang ini
   * (bukan akun kas/bank), persis jurnal akrual createExpense. */
  expensePayableLabel?: string;
  taxIncluded?: boolean;
  taxRate?: MoneyInput;
  taxAccountLabel?: string;
  taxInputAccountLabel?: string;
  receivableAccountLabel?: string;
  payableAccountLabel?: string;
  /** A-21 (R3-02): label akun kredit pihak untuk baris sisa FIFO. */
  customerCreditAccountLabel?: string;
  supplierCreditAccountLabel?: string;
  fromAccountLabel?: string;
  toAccountLabel?: string;
  /** Biaya transfer (jenis transfer): model yang sama seperti jalur
   * khusus — di atas nominal, ditanggung rekening asal. */
  fee?: MoneyInput;
  feeAccountLabel?: string;
  fifoDocs?: FifoDoc[];
}): QuickEntryPreview {
  const amount = d(input.amount);
  const lines: QuickEntryPreviewLine[] = [];
  let allocations: { number: string | null; amount: string }[] = [];

  const debit = (label: string, value: Decimal) =>
    lines.push({ label, debit: toDb(value), credit: toDb(0) });
  const credit = (label: string, value: Decimal) =>
    lines.push({ label, debit: toDb(0), credit: toDb(value) });

  switch (input.kind) {
    case "cash_sale": {
      // R3-05: belah bersama splitCashSaleWithDiscount — angka yang
      // sama dengan yang diposting domain postQuickCashSale.
      const { tax, revenue, cash, discount } = splitCashSaleWithDiscount(
        amount,
        input.taxRate ?? 0,
        input.taxIncluded ?? false,
        input.discount ?? 0,
      );
      debit(input.cashAccountLabel ?? "Kas / bank", cash);
      if (discount.gt(0)) debit(input.discountAccountLabel ?? "Diskon penjualan", discount);
      credit(input.counterAccountLabel ?? "Pendapatan", revenue);
      if (tax.gt(0)) credit(input.taxAccountLabel ?? "PPN Keluaran", tax);
      break;
    }
    case "expense": {
      // FIX-P1 Tahap 4 (AK4-04): beban "Termasuk PPN" terbelah persis
      // seperti domain createExpense — beban sebesar DPP, PPN Masukan
      // sebesar pajaknya, kas keluar sebesar bruto. Rumus belahnya
      // sama (splitCashSale adalah belah inklusif generik).
      // A-21 (R3-11): mode terutang mengganti baris kredit kas dengan
      // akun utang terpeta — belah pajaknya tidak berubah.
      const { tax, net } = splitCashSale(amount, input.taxRate ?? 0, input.taxIncluded ?? false);
      debit(input.counterAccountLabel ?? "Akun beban", net);
      if (tax.gt(0)) debit(input.taxInputAccountLabel ?? "PPN Masukan", tax);
      credit(input.expensePayableLabel ?? input.cashAccountLabel ?? "Kas / bank", amount);
      break;
    }
    case "receive": {
      // A-21 (R3-02): porsi yang melunasi piutang sebesar total
      // dokumen terbuka; sisanya adalah kredit pelanggan (uang
      // muka) — persis agregat jurnal yang diposting domain
      // (per dokumen + jurnal kredit tersendiri untuk sisanya).
      const docsTotal = (input.fifoDocs ?? []).reduce(
        (acc, doc) => acc.plus(d(doc.outstanding)),
        d(0),
      );
      const allocated = amount.gt(docsTotal) ? docsTotal : amount;
      const leftover = amount.minus(allocated);
      debit(input.cashAccountLabel ?? "Kas / bank", amount);
      if (allocated.gt(0)) credit(input.receivableAccountLabel ?? "Piutang Usaha", allocated);
      if (leftover.gt(0)) credit(input.customerCreditAccountLabel ?? "Kredit Pelanggan", leftover);
      allocations = allocateFifo(input.fifoDocs ?? [], amount).map((portion) => ({
        number: portion.doc.number,
        amount: toDb(portion.amount),
      }));
      break;
    }
    case "pay": {
      // A-21 (R3-02): cermin sisi terima — sisa sesudah utang lunas
      // adalah kredit pemasok (aset), kas keluar tetap sebesar
      // nominal penuh.
      const docsTotal = (input.fifoDocs ?? []).reduce(
        (acc, doc) => acc.plus(d(doc.outstanding)),
        d(0),
      );
      const allocated = amount.gt(docsTotal) ? docsTotal : amount;
      const leftover = amount.minus(allocated);
      if (allocated.gt(0)) debit(input.payableAccountLabel ?? "Utang Usaha", allocated);
      if (leftover.gt(0)) debit(input.supplierCreditAccountLabel ?? "Kredit Pemasok", leftover);
      credit(input.cashAccountLabel ?? "Kas / bank", amount);
      allocations = allocateFifo(input.fifoDocs ?? [], amount).map((portion) => ({
        number: portion.doc.number,
        amount: toDb(portion.amount),
      }));
      break;
    }
    case "transfer": {
      // A-21: bentuk persis jurnal createBankTransfer — Dr tujuan
      // sebesar nominal, Dr biaya administrasi bank (bila ada), Cr
      // asal sebesar nominal + biaya.
      const fee = d(input.fee ?? 0);
      debit(input.toAccountLabel ?? "Rekening tujuan", amount);
      if (fee.gt(0)) debit(input.feeAccountLabel ?? "Biaya administrasi bank", fee);
      credit(input.fromAccountLabel ?? "Rekening asal", amount.plus(fee));
      break;
    }
  }

  const totalDebit = sum(lines.map((line) => line.debit));
  const totalCredit = sum(lines.map((line) => line.credit));
  return {
    lines,
    allocations,
    balanced: totalDebit.equals(totalCredit) && totalDebit.gt(0),
    totalDebit: toDb(totalDebit),
    totalCredit: toDb(totalCredit),
  };
}
