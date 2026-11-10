"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";
import { saveAccountAction } from "@/server/actions/accounting/akun-pemetaan";
import { ACCOUNT_SECTIONS, CASH_FLOW_GROUPS, type AccountSection, type CashFlowGroup } from "@/lib/accounting";
import {
  defaultPsak118Tags,
  EXPENSE_FUNCTIONS,
  EXPENSE_NATURES,
  PSAK118_CATEGORIES,
  type ExpenseFunction,
  type ExpenseNature,
  type Psak118Category,
} from "@/lib/akuntansi/psak118";
import { formatIDR } from "@/lib/money";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { Modal } from "@/components/blocks/modal";

/**
 * A-27 B4: ringkasan pratinjau dampak akun (dari getAccountImpact di
 * server/account-impact.ts — halaman yang merakit, formulir hanya
 * menampilkan). `partial` = halaman daftar (saldo & tanda sistem saja;
 * ikatan rinci ada di halaman detail). Penjaga sesungguhnya tetap di
 * server; ringkasan ini untuk keputusan pengguna sebelum menyimpan.
 */
export type AccountImpactSummary = {
  balance: string;
  journalLineCount: number | null;
  mappingLabels: string[];
  paymentMethods: { label: string; isActive: boolean }[];
  discountGroupNames: string[];
  childrenCount: number | null;
  isSystem: boolean;
  partial?: boolean;
};

export type AccountInput = {
  id?: string;
  code: string;
  name: string;
  type: string;
  normalBalance: string;
  parentId?: string | null;
  section?: string | null;
  cashFlowGroup?: string | null;
  // A-27 B3: kelas kas/bank + rincian bank (kolom B1).
  cashBankKind?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankBranch?: string | null;
  bankAccountHolder?: string | null;
  currency?: string | null;
  // A-27 B5: tagging PSAK 118 + penanda kontra (kolom B5).
  psak118Category?: string | null;
  expenseNature?: string | null;
  expenseFunction?: string | null;
  isContra?: boolean;
  contraOf?: string | null;
  description?: string | null;
  isPostable?: boolean;
  isActive: boolean;
};

const CASH_BANK_KINDS = [
  { value: "", label: "Bukan kas/bank" },
  { value: "cash", label: "Kas" },
  { value: "bank", label: "Bank" },
  { value: "clearing", label: "Kliring / Settlement" },
];

const CURRENCIES = ["IDR", "USD", "SGD", "EUR", "JPY", "CNY", "MYR", "AUD", "HKD", "GBP"];

const TYPES = [
  { value: "asset", label: "Aset" },
  { value: "liability", label: "Liabilitas" },
  { value: "equity", label: "Ekuitas" },
  { value: "revenue", label: "Pendapatan" },
  { value: "expense", label: "Beban" },
  { value: "cogs", label: "Harga pokok penjualan" },
];

export function AccountForm({
  account,
  parents = [],
  impact = null,
}: {
  account?: AccountInput;
  parents?: { id: string; code: string; name: string }[];
  impact?: AccountImpactSummary | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(account?.code ?? "");
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState(account?.type ?? "asset");
  const [normalBalance, setNormalBalance] = useState(account?.normalBalance ?? "debit");
  const [parentId, setParentId] = useState(account?.parentId ?? "");
  const [section, setSection] = useState(account?.section ?? "");
  const [cashFlowGroup, setCashFlowGroup] = useState(account?.cashFlowGroup ?? "");
  const [cashBankKind, setCashBankKind] = useState(account?.cashBankKind ?? "");
  const [bankName, setBankName] = useState(account?.bankName ?? "");
  const [bankAccountNumber, setBankAccountNumber] = useState(account?.bankAccountNumber ?? "");
  const [bankBranch, setBankBranch] = useState(account?.bankBranch ?? "");
  const [bankAccountHolder, setBankAccountHolder] = useState(account?.bankAccountHolder ?? "");
  const [currency, setCurrency] = useState(account?.currency ?? "IDR");
  // A-27 B5: state tagging — nilai tersimpan menang; akun baru (atau
  // akun lama yang belum tertag) diawali bawaan deterministik dari
  // tipe/section, sama seperti yang diterapkan server.
  const initialTags = defaultPsak118Tags(account?.type ?? "asset", account?.section ?? null);
  const [psak118Category, setPsak118Category] = useState(
    account?.psak118Category ?? initialTags.psak118Category ?? "",
  );
  const [expenseNature, setExpenseNature] = useState(
    account?.expenseNature ?? initialTags.expenseNature ?? "",
  );
  const [expenseFunction, setExpenseFunction] = useState(
    account?.expenseFunction ?? initialTags.expenseFunction ?? "",
  );
  const [isContra, setIsContra] = useState(account?.isContra ?? false);
  const [contraOf, setContraOf] = useState(account?.contraOf ?? "");
  const [description, setDescription] = useState(account?.description ?? "");
  const [isPostable, setIsPostable] = useState(account?.isPostable ?? true);
  const [isActive, setIsActive] = useState(account?.isActive ?? true);
  // A-27 B4: konfirmasi eksplisit penonaktifan bersaldo (F-05).
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);

  // A-27 B5: tag PSAK 118 hanya bermakna per keluarga tipe — kategori
  // utk akun laba rugi, sifat/fungsi utk akun beban.
  const isIncomeType = ["revenue", "cogs", "expense"].includes(type);
  const isExpenseType = ["cogs", "expense"].includes(type);

  // A-27 B4: keadaan dampak yang relevan selama dialog terbuka —
  // penonaktifan yang sedang dicoba & saldo akun menurut server.
  const balanceNonZero = impact ? Number(impact.balance) !== 0 : false;
  const deactivatingNow = Boolean(account) && !isActive && (account?.isActive ?? true);
  const showBalanceConfirm = deactivatingNow && balanceNonZero;
  const impactBindings: string[] = impact
    ? [
        ...(impact.mappingLabels.length > 0
          ? [`Pemetaan akun: ${impact.mappingLabels.join(", ")}`]
          : []),
        ...(impact.paymentMethods.length > 0
          ? [
              `Metode pembayaran: ${impact.paymentMethods
                .map((row) => `${row.label}${row.isActive ? "" : " (nonaktif)"}`)
                .join(", ")}`,
            ]
          : []),
        ...(impact.discountGroupNames.length > 0
          ? [`Akun diskon kelompok harga: ${impact.discountGroupNames.join(", ")}`]
          : []),
        ...((impact.childrenCount ?? 0) > 0
          ? [`Induk dari ${impact.childrenCount} sub-akun`]
          : []),
      ]
    : [];

  async function submit() {
    // UI-008 & UI-010: Validasi spesifik per field dan aturan panjang minimum
    if (!code.trim()) {
      toast.error("Kode akun wajib diisi.");
      return;
    }
    if (name.trim().length < 2) {
      toast.error("Nama akun wajib diisi (minimal 2 karakter).");
      return;
    }
    // A-27 B3: cerminan validasi server khusus kelas — kelas bank
    // tanpa rincian tidak ada gunanya disimpan.
    if (cashBankKind && type !== "asset") {
      toast.error("Akun berkelas kas/bank wajib bertipe Aset.");
      return;
    }
    if (cashBankKind === "bank" && (!bankName.trim() || !bankAccountNumber.trim())) {
      toast.error("Akun berkelas Bank wajib diisi nama bank dan nomor rekening.");
      return;
    }
    setBusy(true);
    const result = await saveAccountAction({
      id: account?.id,
      code,
      name,
      type: type as "asset" | "liability" | "equity" | "revenue" | "expense" | "cogs",
      normalBalance: normalBalance as "debit" | "credit",
      parentId: parentId || null,
      section: (section || null) as AccountSection | null,
      cashFlowGroup: (cashFlowGroup || null) as CashFlowGroup | null,
      cashBankKind: (cashBankKind || null) as "cash" | "bank" | "clearing" | null,
      bankName: cashBankKind === "bank" ? bankName : null,
      bankAccountNumber: cashBankKind === "bank" ? bankAccountNumber : null,
      bankBranch: cashBankKind === "bank" ? bankBranch || null : null,
      bankAccountHolder: cashBankKind === "bank" ? bankAccountHolder || null : null,
      currency: cashBankKind === "bank" ? currency : null,
      // A-27 B5: tag dikirim hanya utk tipe yang membawanya; tipe lain
      // mengirim null eksplisit (server juga menolak yang tak koheren).
      psak118Category: isIncomeType ? ((psak118Category || null) as Psak118Category | null) : null,
      expenseNature: isExpenseType ? ((expenseNature || null) as ExpenseNature | null) : null,
      expenseFunction: isExpenseType ? ((expenseFunction || null) as ExpenseFunction | null) : null,
      isContra,
      contraOf: isContra ? contraOf || null : null,
      description: description || null,
      isPostable,
      isActive,
      confirmDeactivateWithBalance: confirmDeactivate,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Akun disimpan.");
    setOpen(false);
    if (!account) {
      setCode("");
      setName("");
      const resetTags = defaultPsak118Tags(type, section || null);
      setPsak118Category(resetTags.psak118Category ?? "");
      setExpenseNature(resetTags.expenseNature ?? "");
      setExpenseFunction(resetTags.expenseFunction ?? "");
      setIsContra(false);
      setContraOf("");
      setCashBankKind("");
      setBankName("");
      setBankAccountNumber("");
      setBankBranch("");
      setBankAccountHolder("");
      setCurrency("IDR");
    }
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          account
            ? "inline-flex h-8 items-center gap-1 rounded border border-border bg-card px-2 text-[11px] hover:bg-muted"
            : "inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        }
      >
        {account ? <Save className="size-3" /> : <Plus className="size-3.5" />}
        {account ? "Ubah" : "Akun baru"}
      </button>

      {open ? (
        <Modal
          title={account ? "Ubah akun" : "Akun baru"}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
          busy={busy}
        >
        <div className="space-y-4">
            {/* Fieldset 1: Identitas Akun */}
            <fieldset className="rounded-lg border border-border/70 p-3.5">
              <legend className="px-1.5 text-xs font-semibold text-foreground">1 · Identitas Akun</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelClass}>Kode akun</span>
                  <input value={code} onChange={(event) => setCode(event.target.value)} className={fieldClass} placeholder="1100" />
                  {account ? (
                    <span className="block text-[10px] leading-tight text-muted-foreground">
                      Dapat diubah — jurnal tetap merujuk akun ini; perubahan tercatat di riwayat akun.
                    </span>
                  ) : null}
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Nama akun</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className={labelClass}>Deskripsi akun</span>
                  <input value={description} onChange={(event) => setDescription(event.target.value)} className={fieldClass} placeholder="Opsional" />
                </label>
              </div>
            </fieldset>

            {/* Fieldset 2: Klasifikasi & Kategori */}
            <fieldset className="rounded-lg border border-border/70 p-3.5">
              <legend className="px-1.5 text-xs font-semibold text-foreground">2 · Klasifikasi & Kategori</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelClass}>Tipe</span>
                  <select
                    value={type}
                    onChange={(event) => {
                      const next = event.target.value;
                      setType(next);
                      setNormalBalance(next === "asset" || next === "expense" || next === "cogs" ? "debit" : "credit");
                      const nextTags = defaultPsak118Tags(next, section || null);
                      setPsak118Category(nextTags.psak118Category ?? "");
                      setExpenseNature(nextTags.expenseNature ?? "");
                      setExpenseFunction(nextTags.expenseFunction ?? "");
                    }}
                    className={fieldClass}
                  >
                    {TYPES.map((row) => (
                      <option key={row.value} value={row.value}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Saldo normal</span>
                  <select value={normalBalance} onChange={(event) => setNormalBalance(event.target.value)} className={fieldClass}>
                    <option value="debit">Debit</option>
                    <option value="credit">Kredit</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Akun induk</span>
                  <select value={parentId} onChange={(event) => setParentId(event.target.value)} className={fieldClass}>
                    <option value="">Tanpa induk (level atas)</option>
                    {parents
                      .filter((row) => row.id !== account?.id)
                      .map((row) => (
                        <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                      ))}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Kelompok laporan</span>
                  <select value={section} onChange={(event) => setSection(event.target.value)} className={fieldClass}>
                    <option value="">Otomatis dari tipe & kode</option>
                    {(Object.keys(ACCOUNT_SECTIONS) as AccountSection[]).map((key) => (
                      <option key={key} value={key}>{ACCOUNT_SECTIONS[key]}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className={labelClass}>Arus kas</span>
                  <select value={cashFlowGroup} onChange={(event) => setCashFlowGroup(event.target.value)} className={fieldClass}>
                    <option value="">Otomatis</option>
                    {(Object.keys(CASH_FLOW_GROUPS) as CashFlowGroup[]).map((key) => (
                      <option key={key} value={key}>{CASH_FLOW_GROUPS[key]}</option>
                    ))}
                  </select>
                </label>

                {isIncomeType ? (
                  <>
                    <label className="space-y-1">
                      <span className={labelClass}>Kategori PSAK 118</span>
                      <select value={psak118Category} onChange={(event) => setPsak118Category(event.target.value)} className={fieldClass}>
                        <option value="">Belum ditag</option>
                        {(Object.keys(PSAK118_CATEGORIES) as Psak118Category[]).map((key) => (
                          <option key={key} value={key}>{PSAK118_CATEGORIES[key]}</option>
                        ))}
                      </select>
                    </label>
                    {isExpenseType ? (
                      <label className="space-y-1">
                        <span className={labelClass}>Fungsi beban</span>
                        <select value={expenseFunction} onChange={(event) => setExpenseFunction(event.target.value)} className={fieldClass}>
                          <option value="">Belum ditag</option>
                          {(Object.keys(EXPENSE_FUNCTIONS) as ExpenseFunction[]).map((key) => (
                            <option key={key} value={key}>{EXPENSE_FUNCTIONS[key]}</option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="flex items-end pb-1 text-[11px] text-muted-foreground">
                        Kategori presentasi laba rugi PSAK 118 (berlaku 2027). Laporan saat ini belum memakai tag ini.
                      </div>
                    )}
                    {isExpenseType ? (
                      <label className="space-y-1 sm:col-span-2">
                        <span className={labelClass}>Sifat beban</span>
                        <select value={expenseNature} onChange={(event) => setExpenseNature(event.target.value)} className={fieldClass}>
                          <option value="">Belum ditag</option>
                          {(Object.keys(EXPENSE_NATURES) as ExpenseNature[]).map((key) => (
                            <option key={key} value={key}>{EXPENSE_NATURES[key]}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </>
                ) : null}
              </div>
            </fieldset>

            {/* Fieldset 3: Pengaturan Kas / Bank */}
            <fieldset className="rounded-lg border border-border/70 p-3.5">
              <legend className="px-1.5 text-xs font-semibold text-foreground">3 · Pengaturan Kas / Bank</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className={labelClass}>Kelas kas/bank</span>
                  <select
                    value={cashBankKind}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCashBankKind(next);
                      if (next && type !== "asset") {
                        setType("asset");
                        setNormalBalance("debit");
                        setSection("current_asset");
                      }
                    }}
                    className={fieldClass}
                  >
                    {CASH_BANK_KINDS.map((row) => (
                      <option key={row.value} value={row.value}>{row.label}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end pb-1 text-[11px] text-muted-foreground">
                  {cashBankKind
                    ? "Akun ini tampil sebagai akun kas/bank di seluruh aplikasi."
                    : "Hanya akun berkelas yang tampil sebagai kas/bank."}
                </div>
                {cashBankKind === "bank" ? (
                  <>
                    <label className="space-y-1">
                      <span className={labelClass}>Nama bank</span>
                      <input value={bankName} onChange={(event) => setBankName(event.target.value)} className={fieldClass} placeholder="BCA, Mandiri, BRI…" />
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Nomor rekening</span>
                      <input value={bankAccountNumber} onChange={(event) => setBankAccountNumber(event.target.value)} className={fieldClass} placeholder="Nomor rekening" />
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Cabang</span>
                      <input value={bankBranch} onChange={(event) => setBankBranch(event.target.value)} className={fieldClass} placeholder="Opsional" />
                    </label>
                    <label className="space-y-1">
                      <span className={labelClass}>Atas nama</span>
                      <input value={bankAccountHolder} onChange={(event) => setBankAccountHolder(event.target.value)} className={fieldClass} placeholder="Nama pemilik rekening" />
                    </label>
                    <label className="space-y-1 sm:col-span-2">
                      <span className={labelClass}>Mata uang rekening</span>
                      <select value={currency} onChange={(event) => setCurrency(event.target.value)} className={fieldClass}>
                        {CURRENCIES.map((row) => (
                          <option key={row} value={row}>{row}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}
              </div>
            </fieldset>

            {/* Fieldset 4: Status & Kontra */}
            <fieldset className="rounded-lg border border-border/70 p-3.5">
              <legend className="px-1.5 text-xs font-semibold text-foreground">4 · Status & Kontra</legend>
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={isContra} onChange={(event) => setIsContra(event.target.checked)} />
                    Akun kontra (pengurang akun lain)
                  </label>
                  {isContra ? (
                    <select value={contraOf} onChange={(event) => setContraOf(event.target.value)} className={fieldClass}>
                      <option value="">— Akun yang dikontra belum ditentukan —</option>
                      {parents
                        .filter((row) => row.id !== account?.id)
                        .map((row) => (
                          <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                        ))}
                    </select>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={isPostable} onChange={(event) => setIsPostable(event.target.checked)} />
                    Bisa dipakai posting
                  </label>
                  <label className="flex items-center gap-2 text-[12px]">
                    <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
                    Akun aktif
                  </label>
                </div>
                {account && impact && !impact.partial ? (
                  <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[11px] font-semibold">Akun ini dipakai oleh</p>
                    {impact.isSystem ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Akun sistem — dirujuk pemetaan akun dan/atau metode pembayaran; penonaktifan & penghapusan mengikuti penjaga ikatan.
                      </p>
                    ) : null}
                    {impactBindings.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
                        {impactBindings.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                    {impact.journalLineCount !== null ? (
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {impact.journalLineCount} baris jurnal terposting · saldo terakhir {formatIDR(impact.balance)}
                      </p>
                    ) : null}
                    {impactBindings.length === 0 && impact.journalLineCount === 0 ? (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        Belum dirujuk pemetaan, metode, kelompok harga, sub-akun, atau jurnal mana pun.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {showBalanceConfirm ? (
                  <label className="flex items-start gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[11px] leading-snug">
                    <input
                      type="checkbox"
                      checked={confirmDeactivate}
                      onChange={(event) => setConfirmDeactivate(event.target.checked)}
                      className="mt-0.5"
                    />
                    <span>
                      Saya paham akun ini masih bersaldo <strong>{formatIDR(impact!.balance)}</strong>
                      {impact!.journalLineCount !== null ? <> dari {impact!.journalLineCount} baris jurnal</> : null}.
                      Menonaktifkan <strong>tidak memindahkan saldo</strong> — akun hanya disembunyikan dari pemilih dan tidak dapat dipakai posting sampai diaktifkan kembali.
                    </span>
                  </label>
                ) : null}
              </div>
            </fieldset>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
