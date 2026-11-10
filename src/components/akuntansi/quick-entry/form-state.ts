/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` — tipe & helper
 * murni keadaan form Catat Transaksi (bootstrap, draf, bawaan).
 */
import {
  ArrowRightLeft,
  Banknote,
  HandCoins,
  NotebookPen,
  ReceiptText,
  type LucideIcon,
} from "lucide-react";
import type { getQuickEntryBootstrapAction } from "@/server/actions/quick-entry";
import type { ComboboxAccount } from "@/components/akuntansi/account-combobox";
import { d } from "@/lib/money";
import { todayISO } from "@/lib/format";
import {
  type QuickEntryKind,
  type QuickEntryPayload,
} from "@/lib/quick-entry";

export type Bootstrap = Extract<
  Awaited<ReturnType<typeof getQuickEntryBootstrapAction>>,
  { ok: true }
>["data"];

export type DraftRow = Bootstrap["drafts"][number];

export type FormState = {
  kind: QuickEntryKind;
  date: string;
  amount: string;
  accountId: string;
  counterAccountId: string;
  partyId: string;
  fromAccountId: string;
  toAccountId: string;
  /** Biaya transfer (hanya jenis transfer; A-21). */
  fee: string;
  /** Diskon penjualan (hanya jenis penjualan tunai; A-21 R3-05). */
  discount: string;
  /** Referensi/bukti (transfer, terima piutang, bayar utang; R3-08). */
  reference: string;
  /** Potongan pajak TOTAL bayar utang FIFO (A-21 Tahap R3-A R3-06);
   * hanya tampil bila saklar perusahaan aktif. */
  withholdingType: string;
  withholdingRate: string;
  withholdingAmount: string;
  /** Mode beban (hanya jenis expense; A-21 R3-11): tunai atau
   * terutang ke pemasok. */
  expenseMode: "cash" | "accrual";
  /** Pemasok beban terutang (hanya jenis expense mode terutang). */
  expenseSupplierId: string;
  taxIncluded: boolean;
  notes: string;
};

export const KIND_TABS: { kind: QuickEntryKind; icon: LucideIcon }[] = [
  { kind: "cash_sale", icon: Banknote },
  { kind: "expense", icon: ReceiptText },
  { kind: "receive", icon: HandCoins },
  { kind: "pay", icon: NotebookPen },
  { kind: "transfer", icon: ArrowRightLeft },
];

export const EMPTY_FORM: FormState = {
  kind: "cash_sale",
  date: "",
  amount: "",
  accountId: "",
  counterAccountId: "",
  partyId: "",
  fromAccountId: "",
  toAccountId: "",
  fee: "",
  discount: "",
  reference: "",
  withholdingType: "pph23",
  withholdingRate: "",
  withholdingAmount: "",
  expenseMode: "cash",
  expenseSupplierId: "",
  taxIncluded: false,
  notes: "",
};

export function accountLabel(accounts: ComboboxAccount[], id: string): string | undefined {
  const found = accounts.find((account) => account.id === id);
  return found ? `${found.code} — ${found.name}` : undefined;
}

export function formatRate(rate: string): string {
  return d(rate || "0").toString();
}

export function withDefaults(form: FormState, bootstrap: Bootstrap): FormState {
  const next = { ...form };
  if (!next.date) next.date = bootstrap.today;
  if (!next.accountId) next.accountId = bootstrap.cashAccounts[0]?.id ?? "";
  if (!next.fromAccountId) next.fromAccountId = bootstrap.cashAccounts[0]?.id ?? "";
  if (!next.toAccountId) {
    next.toAccountId =
      bootstrap.cashAccounts.find((account) => account.id !== next.fromAccountId)?.id ??
      bootstrap.cashAccounts[0]?.id ??
      "";
  }
  if (!next.counterAccountId) {
    next.counterAccountId =
      next.kind === "expense"
        ? (bootstrap.expenseAccounts[0]?.id ?? "")
        : (bootstrap.defaultRevenueAccountId ?? bootstrap.revenueAccounts[0]?.id ?? "");
  }
  if (next.kind === "receive" && !next.partyId) next.partyId = bootstrap.customers[0]?.id ?? "";
  if (next.kind === "pay" && !next.partyId) next.partyId = bootstrap.suppliers[0]?.id ?? "";
  if (next.kind === "expense" && next.expenseMode === "accrual" && !next.expenseSupplierId) {
    next.expenseSupplierId = bootstrap.supplierOptions[0]?.id ?? "";
  }
  return next;
}

export function payloadToForm(payload: QuickEntryPayload): FormState {
  return {
    kind: payload.kind,
    date: payload.date || todayISO(),
    amount: payload.amount || "",
    accountId: payload.accountId ?? "",
    counterAccountId: payload.counterAccountId ?? "",
    partyId: payload.partyId ?? "",
    fromAccountId: payload.fromAccountId ?? "",
    toAccountId: payload.toAccountId ?? "",
    // Draf lama tanpa field biaya → kosong (= 0), bukan undefined crash.
    fee: payload.fee ?? "",
    discount: payload.discount ?? "",
    reference: payload.reference ?? "",
    // Draf lama tanpa potongan → kosong (= tanpa potongan).
    withholdingType: payload.withholdingType ?? "pph23",
    withholdingRate: payload.withholdingRate ?? "",
    withholdingAmount: payload.withholdingAmount ?? "",
    // Draf lama tanpa pemasok beban → mode tunai seperti sebelumnya.
    expenseSupplierId: payload.expenseSupplierId ?? "",
    expenseMode: payload.expenseSupplierId ? "accrual" : "cash",
    taxIncluded: payload.taxIncluded ?? false,
    notes: payload.notes ?? "",
  };
}
