/**
 * A-26 Q7 (K-07): pecahan `quick-entry-modal.tsx` per bagian form
 * Catat Transaksi. Nama ekspor, props, dan perilaku identik dengan
 * berkas asal; JSX dipindah apa adanya.
 */
"use client";

import type { Dispatch, SetStateAction } from "react";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { DateField } from "@/components/date-field";
import { AccountCombobox } from "@/components/akuntansi/account-combobox";
import { d, formatIDR } from "@/lib/money";
import { WITHHOLDING_CORE_NOTE } from "@/lib/payment-settlement";
import { fieldClass, labelClass } from "@/components/akuntansi/field-classes";
import { formatRate, type Bootstrap, type FormState } from "./form-state";

/** Kolom bidang isian per jenis transaksi (kolom kiri form). */
export function KindFields(props: {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  bootstrap: Bootstrap;
  setAmountValid: Dispatch<SetStateAction<boolean>>;
  setDiscountValid: Dispatch<SetStateAction<boolean>>;
  setFeeValid: Dispatch<SetStateAction<boolean>>;
  partyOutstanding: Bootstrap["customers"][number] | Bootstrap["suppliers"][number] | null;
  amountExceedsParty: boolean | null;
  showTaxOption: boolean;
  taxAccountForKind: Bootstrap["taxInputAccount"] | Bootstrap["taxOutputAccount"];
}) {
  const { form, set, bootstrap, setAmountValid, setDiscountValid, setFeeValid, partyOutstanding, amountExceedsParty, showTaxOption, taxAccountForKind } = props;
  return (
        <div className="min-w-0 space-y-2.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1">
              <span className={labelClass}>Tanggal</span>
              <DateField
                value={form.date}
                onChange={(value) => set("date", value)}
                className={fieldClass}
              />
            </label>
            <label className="space-y-1">
              <span className={labelClass}>Jumlah</span>
              <MoneyInput
                value={form.amount}
                onChange={(value) => set("amount", value)}
                onValidityChange={setAmountValid}
                aria-label="Jumlah transaksi"
                className="h-9 text-[12px]"
              />
            </label>
          </div>

          {form.kind === "expense" ? (
            <label className="block space-y-1">
              <span className={labelClass}>Mode pembayaran</span>
              <select
                value={form.expenseMode}
                onChange={(event) => set("expenseMode", event.target.value as "cash" | "accrual")}
                className={fieldClass}
                aria-label="Mode pembayaran beban"
              >
                <option value="cash">Tunai — dibayar sekarang</option>
                <option value="accrual" disabled={bootstrap.supplierOptions.length === 0}>
                  Terutang — belum dibayar (menjadi utang pemasok)
                </option>
              </select>
            </label>
          ) : null}

          {form.kind === "cash_sale" || form.kind === "expense" || form.kind === "receive" || form.kind === "pay" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {form.kind === "expense" && form.expenseMode === "accrual" ? (
                <label className="space-y-1">
                  <span className={labelClass}>Terutang ke pemasok</span>
                  <select
                    value={form.expenseSupplierId}
                    onChange={(event) => set("expenseSupplierId", event.target.value)}
                    className={fieldClass}
                    aria-label="Pemasok beban terutang"
                  >
                    <option value="">— pilih pemasok —</option>
                    {bootstrap.supplierOptions.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.code} · {supplier.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="space-y-1">
                  <span className={labelClass}>
                    {form.kind === "expense" || form.kind === "pay" ? "Dibayar dari (kas / bank)" : "Masuk ke (kas / bank)"}
                  </span>
                  <AccountCombobox
                    accounts={bootstrap.cashAccounts}
                    value={form.accountId}
                    onChange={(value) => set("accountId", value)}
                    aria-label="Akun kas/bank"
                  />
                </label>
              )}
              {form.kind === "cash_sale" ? (
                <label className="space-y-1">
                  <span className={labelClass}>Akun pendapatan</span>
                  <AccountCombobox
                    accounts={bootstrap.revenueAccounts}
                    value={form.counterAccountId}
                    onChange={(value) => set("counterAccountId", value)}
                    aria-label="Akun pendapatan"
                  />
                </label>
              ) : null}
              {form.kind === "expense" ? (
                <label className="space-y-1">
                  {/* A-22 K4 (UX-06): label disamakan dengan halaman
                      Beban — sejak A-21 R3-15 daftar akun modal ini
                      memang hanya tipe expense (listExpenseAccounts)
                      dan domain menolak akun non-beban; label lama
                      "Akun beban / aset" menjanjikan yang tidak ada. */}
                  <span className={labelClass}>Akun beban</span>
                  <AccountCombobox
                    accounts={bootstrap.expenseAccounts}
                    value={form.counterAccountId}
                    onChange={(value) => set("counterAccountId", value)}
                    aria-label="Akun beban"
                  />
                </label>
              ) : null}
              {form.kind === "receive" || form.kind === "pay" ? (
                <label className="space-y-1">
                  <span className={labelClass}>{form.kind === "receive" ? "Pelanggan" : "Pemasok"}</span>
                  <select
                    value={form.partyId}
                    onChange={(event) => set("partyId", event.target.value)}
                    className={fieldClass}
                    aria-label={form.kind === "receive" ? "Pelanggan" : "Pemasok"}
                  >
                    <option value="">— pilih {form.kind === "receive" ? "pelanggan" : "pemasok"} —</option>
                    {(form.kind === "receive" ? bootstrap.customers : bootstrap.suppliers).map((party) => (
                      <option key={party.id} value={party.id}>
                        {party.name} — sisa {formatIDR(party.totalOutstanding)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          {form.kind === "cash_sale" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Diskon (opsional)</span>
                <MoneyInput
                  value={form.discount}
                  onChange={(value) => set("discount", value)}
                  onValidityChange={setDiscountValid}
                  aria-label="Diskon penjualan"
                  className="h-9 text-[12px]"
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Pelanggan (opsional)</span>
                <select
                  value={form.partyId}
                  onChange={(event) => set("partyId", event.target.value)}
                  className={fieldClass}
                  aria-label="Pelanggan penjualan tunai"
                >
                  <option value="">— tanpa pelanggan —</option>
                  {bootstrap.customerOptions.map((customer) => (
                    <option key={customer.id} value={customer.id}>
                      {customer.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          {form.kind === "transfer" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1">
                <span className={labelClass}>Dari rekening</span>
                <AccountCombobox
                  accounts={bootstrap.cashAccounts}
                  value={form.fromAccountId}
                  onChange={(value) => set("fromAccountId", value)}
                  aria-label="Rekening asal"
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Ke rekening</span>
                <AccountCombobox
                  accounts={bootstrap.cashAccounts}
                  value={form.toAccountId}
                  onChange={(value) => set("toAccountId", value)}
                  aria-label="Rekening tujuan"
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Biaya transfer</span>
                <MoneyInput
                  value={form.fee}
                  onChange={(value) => set("fee", value)}
                  onValidityChange={setFeeValid}
                  aria-label="Biaya transfer"
                  className="h-9 text-[12px]"
                />
              </label>
              <label className="space-y-1">
                <span className={labelClass}>Referensi (opsional)</span>
                <input
                  value={form.reference}
                  onChange={(event) => set("reference", event.target.value)}
                  className={fieldClass}
                  placeholder="No. bukti / referensi transfer"
                  aria-label="Referensi transfer"
                />
              </label>
            </div>
          ) : null}

          {form.kind === "receive" || form.kind === "pay" ? (
            <label className="block space-y-1">
              <span className={labelClass}>Referensi / no. bukti (opsional)</span>
              <input
                value={form.reference}
                onChange={(event) => set("reference", event.target.value)}
                className={fieldClass}
                placeholder="Mis. nomor transfer, cek, atau VA"
                aria-label="Referensi pembayaran"
              />
            </label>
          ) : null}

          {form.kind === "pay" && bootstrap.withholdingEnabled ? (
            <div className="space-y-2 rounded-md border border-border p-2">
              <span className={labelClass}>Potongan pajak (withholding) — total pembayaran ini</span>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="space-y-1">
                  <span className={labelClass}>Jenis</span>
                  <select
                    value={form.withholdingType}
                    onChange={(event) => set("withholdingType", event.target.value)}
                    className={fieldClass}
                    aria-label="Jenis potongan pajak"
                  >
                    <option value="pph23">PPh 23</option>
                    <option value="pph42">PPh 4(2)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Tarif (%)</span>
                  {/* Validasi 3 (F-02): PercentInput bersama (pola yang
                      sama dengan payment-form) — string kanonis persen. */}
                  <PercentInput
                    value={form.withholdingRate}
                    onChange={(value) => set("withholdingRate", value)}
                    placeholder="Opsional"
                    aria-label="Tarif potongan pajak"
                    className="h-9 text-[12px]"
                  />
                </label>
                <label className="space-y-1">
                  <span className={labelClass}>Nominal potongan</span>
                  <MoneyInput
                    value={form.withholdingAmount}
                    onChange={(value) => set("withholdingAmount", value)}
                    aria-label="Nominal potongan pajak"
                    className="h-9 text-[12px]"
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Potongan didistribusikan mengikuti urutan dokumen (tertua dulu) dan dibekukan di tiap pembayaran; kas keluar tiap dokumen berkurang sebesar irisannya. {WITHHOLDING_CORE_NOTE} Kosongkan bila tidak dipotong.
              </p>
            </div>
          ) : null}

          {partyOutstanding ? (
            <p className={`text-[11px] ${amountExceedsParty ? "font-medium text-tone-amber" : "text-muted-foreground"}`}>
              Total {form.kind === "receive" ? "piutang" : "utang"} terbuka {partyOutstanding.name}:{" "}
              <span className="num font-medium">{formatIDR(partyOutstanding.totalOutstanding)}</span> — pembayaran
              dialokasikan ke dokumen tertua dulu (FIFO).
              {amountExceedsParty
                ? ` Kelebihan ${formatIDR(d(form.amount || "0").minus(d(partyOutstanding.totalOutstanding)).toNumber())} menjadi kredit ${form.kind === "receive" ? "pelanggan" : "pemasok"} (uang muka).`
                : ""}
            </p>
          ) : null}

          {showTaxOption ? (
            taxAccountForKind ? (
              <label className="flex items-center gap-2 text-[12px]">
                <input
                  type="checkbox"
                  checked={form.taxIncluded}
                  onChange={(event) => set("taxIncluded", event.target.checked)}
                  className="size-3.5"
                />
                Termasuk PPN {formatRate(bootstrap.taxRate)}%
              </label>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Opsi termasuk PPN tidak tersedia: akun {form.kind === "expense" ? "PPN Masukan" : "PPN Keluaran"} belum dipetakan di Pengaturan.
              </p>
            )
          ) : null}

          {form.kind === "cash_sale" ? (
            <p className="text-[11px] text-muted-foreground">
              Penjualan tunai ini mencatat pendapatan tanpa stok — untuk penjualan barang, gunakan POS.
            </p>
          ) : null}

          {form.kind === "expense" ? (
            <p className="text-[11px] text-muted-foreground">
              Kemampuan mencatatnya sama dengan halaman Beban (mode tunai/terutang, PPN, akun
              beban yang sama). Riwayat lengkap & pembatalan beban ada di halaman Beban.
            </p>
          ) : null}

          <label className="block space-y-1">
            <span className={labelClass}>
              {form.kind === "expense" ? "Keterangan (wajib)" : "Catatan (opsional)"}
            </span>
            <input
              value={form.notes}
              onChange={(event) => set("notes", event.target.value)}
              className={fieldClass}
              placeholder={form.kind === "expense" ? "Contoh: listrik toko bulan ini" : "Opsional"}
            />
          </label>
        </div>
  );
}
