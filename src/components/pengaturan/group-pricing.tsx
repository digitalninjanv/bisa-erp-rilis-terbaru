"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Tags } from "lucide-react";
import { toast } from "sonner";
import { formatIDR, roundTo, type RoundDirection } from "@/lib/money";
import { Pagination } from "@/components/blocks/pagination";
import { Field } from "@/components/blocks/field";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";
import { Modal } from "@/components/blocks/modal";
import { SearchForm } from "@/components/blocks/search-form";
import { fieldClass } from "@/components/blocks/field-classes";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import { requireFilled, runActionResult, useActionRunner } from "@/components/use-action-runner";
import { clearGroupProductPricesAction, deleteCustomerGroupAction, saveCustomerGroupAction, saveGroupProductPriceAction } from "@/server/actions/settings/kelompok-harga";

export type GroupRecord = {
  id: string;
  name: string;
  roundingStep: number;
  roundingDirection: string;
  roundCashTotal: boolean;
  discountAccountId: string | null;
  isActive: boolean;
  productCount: number;
};

export type GroupPriceRowView = {
  id: string;
  sku: string;
  name: string;
  categoryName: string | null;
  salePrice: string;
  ruleType: "normal" | "percent" | "fixed";
  ruleValue: string;
  groupPrice: number;
};

const STEPS = [0, 100, 500, 1000];
const DIRECTIONS: { value: RoundDirection; label: string }[] = [
  { value: "down", label: "Ke bawah" },
  { value: "up", label: "Ke atas" },
  { value: "nearest", label: "Terdekat" },
];

export function CustomerGroupManager({
  groups,
  accounts,
  selectedGroupId,
}: {
  groups: GroupRecord[];
  accounts: { id: string; code: string; name: string }[];
  selectedGroupId: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState<{
    id?: string;
    name: string;
    roundingStep: number;
    roundingDirection: RoundDirection;
    roundCashTotal: boolean;
    discountAccountId: string;
  } | null>(null);
  // G2 (FRM-05): busy + pemeriksaan hasil kini helper submit bersama.
  const { busy, run } = useActionRunner();
  const [removing, setRemoving] = useState<GroupRecord | null>(null);

  function openCreate() {
    setForm({
      name: "",
      roundingStep: 0,
      roundingDirection: "down",
      roundCashTotal: false,
      discountAccountId: accounts[0]?.id ?? "",
    });
  }

  function openEdit(group: GroupRecord) {
    setForm({
      id: group.id,
      name: group.name,
      roundingStep: group.roundingStep,
      roundingDirection: (group.roundingDirection as RoundDirection) ?? "down",
      roundCashTotal: group.roundCashTotal,
      discountAccountId: group.discountAccountId ?? "",
    });
  }

  async function submit() {
    if (!form) {
      toast.error("Nama kelompok wajib diisi.");
      return;
    }
    if (!requireFilled(form.name, "Nama kelompok wajib diisi.")) return;
    const data = await run(saveCustomerGroupAction({
      id: form.id,
      name: form.name,
      roundingStep: form.roundingStep,
      roundingDirection: form.roundingDirection,
      roundCashTotal: form.roundCashTotal,
      discountAccountId: form.discountAccountId || null,
    }));
    if (data === null) return;
    toast.success("Kelompok disimpan.");
    setForm(null);
    router.refresh();
  }

  async function remove(group: GroupRecord) {
    const data = await run(deleteCustomerGroupAction(group.id));
    setRemoving(null);
    if (data === null) return;
    toast.success("Kelompok dihapus.");
    if (selectedGroupId === group.id) router.push("/app/pengaturan?tab=grup");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Tags className="size-3.5 text-muted-foreground" /> Kelompok harga
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Harga khusus hanya berlaku saat kelompok dipilih di kasir. Tanpa kelompok = harga normal.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium transition-colors hover:bg-muted"
        >
          <Plus className="size-3.5" /> Kelompok baru
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">Belum ada kelompok harga.</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {groups.map((group) => (
            <li
              key={group.id}
              className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 ${
                selectedGroupId === group.id ? "bg-muted/40" : ""
              }`}
            >
              <div className="min-w-0">
                <p className="text-[12px] font-medium">
                  {group.name}
                  {!group.isActive ? (
                    <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">Nonaktif</span>
                  ) : null}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {group.productCount} produk beraturan · pembulatan {group.roundingStep === 0 ? "tanpa" : group.roundingStep.toLocaleString("id-ID")}
                  {group.roundingStep > 0
                    ? ` ${group.roundingDirection === "down" ? "ke bawah" : group.roundingDirection === "up" ? "ke atas" : "terdekat"}`
                    : ""}
                  {group.roundCashTotal ? " · total tunai dibulatkan" : ""}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Link
                  href={`/app/pengaturan?tab=grup&group=${group.id}`}
                  className={`inline-flex h-8 items-center gap-1 rounded border px-2 text-[11px] font-medium ${
                    selectedGroupId === group.id
                      ? "border-primary/50 bg-primary-soft font-medium text-primary"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  <Tags className="size-3" /> Atur harga
                </Link>
                {/* G3 (UX4-01): Ubah + Hapus masuk menu ⋯; "Atur
                    harga" tetap tautan terlihat karena ia navigasi
                    utama baris ini, bukan aksi atas barisnya. */}
                <RowMenu
                  label={`Aksi untuk kelompok ${group.name}`}
                  items={[
                    { key: "edit", label: "Ubah" },
                    { key: "delete", label: "Hapus kelompok", danger: true, disabled: busy },
                  ]}
                  onAction={(key) => {
                    if (key === "edit") openEdit(group);
                    if (key === "delete") setRemoving(group);
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Hapus kelompok "${removing.name}" beserta aturan harganya?` : ""}
        description="Kelompok dan seluruh aturan harga di dalamnya akan dihapus."
        confirmLabel="Hapus kelompok"
        danger
        busy={busy}
        onConfirm={() => {
          if (removing) void remove(removing);
        }}
        onCancel={() => setRemoving(null)}
      />

      {form ? (
        <Modal
          title={form.id ? "Ubah kelompok" : "Kelompok baru"}
          onClose={() => setForm(null)}
          onSubmit={() => void submit()}
          busy={busy}
        >
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Nama kelompok" className="sm:col-span-2">
                <input
                  autoFocus
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className={fieldClass}
                  placeholder="Kampus, Sekolah, Mahasiswa…"
                />
              </Field>
              <Field label="Kelipatan harga">
                <select
                  value={form.roundingStep}
                  onChange={(event) => setForm({ ...form, roundingStep: Number(event.target.value) })}
                  className={fieldClass}
                >
                  {STEPS.map((step) => (
                    <option key={step} value={step}>
                      {step === 0 ? "Tanpa pembulatan" : `Rp ${step.toLocaleString("id-ID")}`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Arah pembulatan">
                <select
                  value={form.roundingDirection}
                  onChange={(event) => setForm({ ...form, roundingDirection: event.target.value as RoundDirection })}
                  className={fieldClass}
                >
                  {DIRECTIONS.map((row) => (
                    <option key={row.value} value={row.value}>{row.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Akun diskon penjualan">
                <select
                  value={form.discountAccountId}
                  onChange={(event) => setForm({ ...form, discountAccountId: event.target.value })}
                  className={fieldClass}
                >
                  <option value="">Ikuti pemetaan akun</option>
                  {accounts.map((row) => (
                    <option key={row.id} value={row.id}>{row.code} · {row.name}</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-end gap-2 pb-1 text-[12px]">
                <input
                  type="checkbox"
                  checked={form.roundCashTotal}
                  onChange={(event) => setForm({ ...form, roundCashTotal: event.target.checked })}
                />
                Bulatkan total tunai
              </label>
            </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function GroupPriceTable({
  group,
  rows,
  total,
  page,
  pageSize,
  q,
}: {
  group: GroupRecord;
  rows: GroupPriceRowView[];
  total: number;
  page: number;
  pageSize: number;
  q?: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Record<string, { ruleType: "normal" | "percent" | "fixed"; value: string }>>({});
  // G2 (FRM-05): status sibuk clearAll kini runner bersama.
  const { busy: clearing, run: runClear } = useActionRunner();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const direction = (group.roundingDirection as RoundDirection) ?? "down";

  const preview = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const edit = editing[row.id];
      const ruleType = edit?.ruleType ?? row.ruleType;
      const ruleValue = edit?.value ?? row.ruleValue;
      const normal = Number(row.salePrice);
      if (ruleType === "normal") {
        map.set(row.id, normal);
        continue;
      }
      const raw =
        ruleType === "percent"
          ? normal * (1 - Number(ruleValue) / 100)
          : Number(ruleValue);
      const bounded = Math.min(Math.max(raw, 0), normal);
      map.set(row.id, roundTo(bounded, group.roundingStep, direction).toNumber());
    }
    return map;
  }, [rows, editing, group.roundingStep, direction]);

  function setRow(id: string, ruleType: "normal" | "percent" | "fixed", value?: string) {
    setEditing((current) => ({
      ...current,
      [id]: { ruleType, value: value ?? current[id]?.value ?? "0" },
    }));
  }

  // A-25 U6 (POLA-05): tombol Simpan per baris produk dibuang —
  // tabel ini saver seksi SettingsLayout yang menyimpan semua
  // baris berubah lewat saveGroupProductPriceAction yang sama.
  async function saveAll() {
    const changed = rows.filter((row) => {
      const edit = editing[row.id];
      return edit && (edit.ruleType !== row.ruleType || edit.value !== row.ruleValue);
    });
    const failures: string[] = [];
    for (const row of changed) {
      const edit = editing[row.id]!;
      // G2 (FRM-05): pemeriksaan hasil per baris kini inti bersama
      // (toast error per kegagalan, sama seperti pola tangan lama).
      const data = await runActionResult(saveGroupProductPriceAction({
        groupId: group.id,
        productId: row.id,
        ruleType: edit.ruleType,
        value: edit.value || "0",
      }));
      if (data === null) {
        failures.push(row.id);
      } else {
        setEditing((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
      }
    }
    if (failures.length > 0) {
      throw new Error(`Harga gagal disimpan untuk ${failures.length} produk.`);
    }
    if (changed.length > 0) router.refresh();
  }

  const { setDirty } = useSettingsSection("grup-harga", saveAll);

  useEffect(() => {
    setDirty(
      rows.some((row) => {
        const edit = editing[row.id];
        return edit && (edit.ruleType !== row.ruleType || edit.value !== row.ruleValue);
      }),
    );
  }, [editing, rows, setDirty]);

  async function clearAll() {
    const data = await runClear(clearGroupProductPricesAction(group.id));
    setConfirmingClear(false);
    if (data === null) return;
    toast.success("Semua aturan harga dihapus.");
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">Atur harga · {group.name}</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Harga normal, aturan per produk, dan harga kelompok setelah pembulatan Rp{" "}
            {group.roundingStep.toLocaleString("id-ID")}{" "}
            {direction === "down" ? "ke bawah" : direction === "up" ? "ke atas" : "terdekat"}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmingClear(true)}
          disabled={clearing || group.productCount === 0}
          className="h-8 rounded border border-border px-2 text-[11px] text-muted-foreground hover:bg-muted disabled:opacity-50"
        >
          {clearing ? "Menghapus…" : "Kosongkan aturan"}
        </button>
        <ConfirmDialog
          open={confirmingClear}
          title={`Hapus semua aturan harga pada kelompok "${group.name}"?`}
          description="Produk kembali memakai harga normal. Aturan yang sudah dipakai transaksi lama tidak berubah."
          confirmLabel="Kosongkan aturan"
          danger
          busy={clearing}
          onConfirm={() => void clearAll()}
          onCancel={() => setConfirmingClear(false)}
        />
      </div>

      <div className="border-b border-border px-3 py-2">
        <SearchForm action="/app/pengaturan" q={q} placeholder="Cari nama, SKU, atau barcode…" hidden={{ tab: "grup", group: group.id }}>
          <span className="text-[11px] text-muted-foreground">{total.toLocaleString("id-ID")} produk</span>
        </SearchForm>
      </div>

      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Produk</th>
              <th className="text-right">Harga normal</th>
              <th>Aturan</th>
              <th className="text-right">Nilai</th>
              <th className="text-right">Harga grup</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const edit = editing[row.id];
              const ruleType = edit?.ruleType ?? row.ruleType;
              const value = edit?.value ?? row.ruleValue;
              const groupPrice = preview.get(row.id) ?? row.groupPrice;
              const dirty = Boolean(edit) && (edit.ruleType !== row.ruleType || edit.value !== row.ruleValue);
              return (
                <tr key={row.id}>
                  <td>
                    <p className="text-[12px] font-medium">{row.name}</p>
                    <p className="num text-[10px] text-muted-foreground">
                      {row.sku}
                      {row.categoryName ? ` · ${row.categoryName}` : ""}
                    </p>
                  </td>
                  <td className="num text-right text-[12px]">{formatIDR(row.salePrice)}</td>
                  <td>
                    <select
                      value={ruleType}
                      onChange={(event) =>
                        setRow(row.id, event.target.value as "normal" | "percent" | "fixed", value)
                      }
                      className="h-9 rounded border border-input bg-background px-1.5 text-[11px]"
                      aria-label={`Aturan harga ${row.name}`}
                    >
                      <option value="normal">Normal</option>
                      <option value="percent">Diskon %</option>
                      <option value="fixed">Harga tetap</option>
                    </select>
                  </td>
                  <td className="text-right">
                    {ruleType === "normal" ? (
                      <span className="num text-[11px] text-muted-foreground">—</span>
                    ) : ruleType === "percent" ? (
                      /* Validasi 3 (F-02): nilai aturan sadar-mode —
                         persen memakai PercentInput, harga tetap
                         MoneyInput (pola feeValue A-28 T4). Preview &
                         simpan mem-parse string kanonis yang sama. */
                      <PercentInput
                        value={value}
                        onChange={(next) => setRow(row.id, ruleType, next)}
                        className="h-9 w-24 text-[11px]"
                        aria-label={`Nilai ${row.name}`}
                      />
                    ) : (
                      <MoneyInput
                        value={value}
                        onChange={(next) => setRow(row.id, ruleType, next)}
                        className="h-9 w-24 text-[11px]"
                        aria-label={`Nilai ${row.name}`}
                      />
                    )}
                  </td>
                  <td className="num text-right text-[12px] font-semibold">
                    {ruleType === "normal" ? formatIDR(row.salePrice) : formatIDR(groupPrice)}
                  </td>
                  <td className="text-right">
                    {dirty ? (
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium">
                        <span aria-hidden className="size-1.5 rounded-full bg-tone-amber" />
                        Berubah
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-center text-[11px] text-muted-foreground">
                  Tidak ada produk ditemukan.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/app/pengaturan"
        params={{ tab: "grup", group: group.id, q }}
      />
    </div>
  );
}
