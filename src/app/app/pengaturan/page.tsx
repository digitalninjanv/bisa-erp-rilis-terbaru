import { withCompanyReadOnly } from "@/db/tenant";
import { getSettingsPageData, listCategories, listGroupProductPrices } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { parsePageParam } from "@/lib/pagination";
import { PageHeader } from "@/components/blocks/page-header";
import {
  BranchForm,
  CustomFieldsForm,
  DocumentNumberingForm,
  MappingEditor,
  ModuleSettingsForm,
  PaymentMethodForm,
  PaymentMethodRowActions,
  PrintSettingsForm,
  QrisUploader,
  SettingsForm,
  WarehouseForm,
  WarehouseRowActions,
} from "@/components/pengaturan/settings-forms";
import { CustomerGroupManager, GroupPriceTable } from "@/components/pengaturan/group-pricing";
import { SettingsPageFrame } from "@/components/pengaturan/settings-page-frame";
import {
  AdjustmentReasonsEditor,
  OpnameCycleEditor,
} from "@/components/pengaturan/warehouse-ops-config";
import { resolveAdjustmentReasons } from "@/lib/adjustment-reasons";
import { sanitizeOpnameCycleConfig } from "@/lib/opname-cycle";

export const metadata = { title: "Pengaturan" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "umum", label: "Umum" },
  // A-28 UI-2 (UX-D01): tab "Nota & printer" DILEBUR ke "Cetak" —
  // pengaturan cetak kini satu pintu. Tautan lama ?tab=nota diarahkan
  // ke tab cetak di bawah agar tidak mendarat di halaman kosong.
  { key: "cetak", label: "Cetak" },
  { key: "nomor", label: "Penomoran" },
  { key: "pembayaran", label: "Metode pembayaran" },
  { key: "grup", label: "Kelompok harga" },
  { key: "lokasi", label: "Gudang & cabang" },
  { key: "akun", label: "Pemetaan akun" },
  { key: "modul", label: "Modul" },
  { key: "kolom", label: "Kolom kustom" },
];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; group?: string; q?: string; page?: string }>;
}) {
  const params = await searchParams;
  const requestedTab = params.tab === "nota" ? "cetak" : params.tab;
  const tab = TABS.some((row) => row.key === requestedTab) ? requestedTab! : "umum";
  const ctx = await requirePermissionPage("settings.manage");

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const base = await getSettingsPageData(tx, ctx.company.id);

    const selectedGroup = base.groups.find((row) => row.id === params.group) ?? base.groups[0] ?? null;
    const priceData =
      tab === "grup" && selectedGroup
        ? await listGroupProductPrices(tx, {
            companyId: ctx.company.id,
            groupId: selectedGroup.id,
            roundingStep: selectedGroup.roundingStep,
            roundingDirection: selectedGroup.roundingDirection as "down" | "up" | "nearest",
            q: params.q,
            page: parsePageParam(params.page),
            pageSize: 20,
          })
        : null;

    return {
      ...base,
      selectedGroup,
      priceData,
      // A-24 T3: kategori untuk editor frekuensi opname (tab lokasi).
      categories: tab === "lokasi" ? await listCategories(tx, ctx.company.id) : [],
    };
  });

  if (!data.settings) {
    return (
      <div>
        <PageHeader eyebrow="Pengaturan" title="Pengaturan" description="Konfigurasi perusahaan belum tersedia." />
      </div>
    );
  }

  const settings = data.settings;
  const accountName = (id: string | null) => data.accounts.find((row) => row.id === id)?.name ?? "—";
  const warehouseName = (id: string | null) => data.warehouses.find((row) => row.id === id)?.name ?? "—";

  return (
    <div>
      <PageHeader
        eyebrow="Pengaturan"
        title="Pengaturan"
        description="Identitas perusahaan, pajak, pembulatan, nota, metode pembayaran, kelompok harga, gudang, cabang, pemetaan akun otomatis, modul aktif, dan kolom kustom."
      />

      {/* A-25 U6 (PNG-01): deretan chip tab DIBUANG. Validasi 2
          (V-02): daftar seksi di dalam halaman ikut DIBUANG —
          daftar yang sama dirender sidebar cangkang, jadi navigasi
          pengaturan kini benar-benar tunggal di sidebar (desktop)
          & drawer (mobile). URL ?tab= dipertahankan persis agar
          tautan lama tetap berlaku; bingkai halaman hanya membawa
          kontrak seksi + bilah simpan. */}
      <SettingsPageFrame
        saveLabel={tab === "nomor" ? "Simpan penomoran" : undefined}
      >
      {tab === "umum" ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
          <SettingsForm
            warehouses={data.warehouses.map((row) => ({ id: row.id, name: row.name }))}
            settings={{
              legalName: settings.legalName,
              taxId: settings.taxId ?? "",
              address: settings.address ?? "",
              phone: settings.phone ?? "",
              roundingMode: settings.roundingMode,
              qrisImage: settings.qrisImage,
              allowNegativeStock: settings.allowNegativeStock,
              taxRate: settings.taxRate,
              taxEnabled: settings.taxEnabled,
              withholdingEnabled: settings.withholdingEnabled,
              writeoffMaxAmount: settings.writeoffMaxAmount ?? "",
              payableDefaultTermDays: settings.payableDefaultTermDays,
              receivableDefaultTermDays: settings.receivableDefaultTermDays,
              reservationDefaultExpiryDays: settings.reservationDefaultExpiryDays,
              expiryWarningDays: settings.expiryWarningDays,
              cashNegativePolicy: settings.cashNegativePolicy as "allow" | "warn" | "block",
              posSessionDifferenceTolerance: settings.posSessionDifferenceTolerance ?? "0",
              posDiscountThresholdPercent: String(Number(settings.posDiscountThresholdPercent)),
              adjustmentApprovalThreshold: settings.adjustmentApprovalThreshold ?? "",
              posOfflineEnabled: settings.posOfflineEnabled,
              transferTwoStepEnabled: settings.transferTwoStepEnabled,
              prApprovalThreshold: settings.prApprovalThreshold ?? "",
              reportNotes: settings.reportNotes ?? "",
              defaultWarehouseId: settings.defaultWarehouseId,
            }}
          />
          <QrisUploader current={settings.qrisImage} />
        </div>
      ) : null}

      {tab === "cetak" ? (
        <PrintSettingsForm
          initial={{
            printTemplate: settings.printTemplate,
            printLogoUrl: settings.printLogoUrl ?? "",
            printAccentColor: settings.printAccentColor,
            printFont: settings.printFont,
            printHeaderText: settings.printHeaderText ?? "",
            printFooterText: settings.printFooterText ?? "",
            printShowSignature: settings.printShowSignature,
            printShowQr: settings.printShowQr,
            printReceiptPaper: settings.printReceiptPaper,
            printDocumentPaper: settings.printDocumentPaper,
            printShowCashier: settings.printShowCashier,
            printShowTax: settings.printShowTax,
            printShowCustomer: settings.printShowCustomer,
            printShowSession: settings.printShowSession,
            printShowBranding: settings.printShowBranding,
            printSignatureLabels: settings.printSignatureLabels ?? {},
          }}
          company={{
            legalName: settings.legalName,
            address: settings.address ?? "",
            phone: settings.phone ?? "",
          }}
        />
      ) : null}

      {tab === "nomor" ? (
        <DocumentNumberingForm initial={settings.documentNumbering ?? null} />
      ) : null}

      {tab === "modul" ? (
        <ModuleSettingsForm initial={settings.enabledModules ?? null} />
      ) : null}

      {tab === "kolom" ? (
        <CustomFieldsForm initial={settings.customFields ?? null} />
      ) : null}

      {tab === "pembayaran" ? (
        (() => {
          // A-27 B3 (menutup F-02): pilihan akun metode TIDAK lagi
          // dibatasi 3 akun terpetakan kas/bank/qris. Semesta pilihan
          // = semua akun postable + aktif beserta KELASNYA; formulir
          // menyaring per tipe metode (tunai→cash, transfer→bank,
          // QRIS→clearing, kredit→akun pemetaan piutang, kredit
          // pelanggan→akun pemetaannya). Formulir ubah per baris juga
          // memuat akun metode itu sendiri agar nilai saat ini tampil
          // walau akunnya kini nonaktif/tak berkelas.
          const baseMethodAccounts = data.accounts
            .filter((row) => row.isPostable && row.isActive)
            .map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type, cashBankKind: row.cashBankKind }));
          const accountsForMethod = (accountId: string | null) => {
            if (!accountId || baseMethodAccounts.some((row) => row.id === accountId)) {
              return baseMethodAccounts;
            }
            const own = data.accounts.find((row) => row.id === accountId);
            return own
              ? [...baseMethodAccounts, { id: own.id, code: own.code, name: own.name, type: own.type, cashBankKind: own.cashBankKind }]
              : baseMethodAccounts;
          };
          const receivableAccountId = data.mappings.find((mapping) => mapping.key === "receivable")?.accountId ?? null;
          const customerCreditAccountId = data.mappings.find((mapping) => mapping.key === "customer_credit")?.accountId ?? null;
          const methodTypeLabels: Record<string, string> = {
            cash: "Tunai",
            bank: "Transfer bank",
            qris: "QRIS",
            credit: "Kredit / tempo",
            customer_credit: "Kredit pelanggan (retur)",
          };
          return (
            <section className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                <div>
                  <h2 className="text-[13px] font-semibold">Metode pembayaran</h2>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Metode aktif tampil di layar kasir dan menentukan akun penerimaan. Kode tidak bisa diubah sesudah dibuat; metode yang sudah dipakai transaksi hanya bisa dinonaktifkan, tidak dihapus.</p>
                </div>
                <PaymentMethodForm accounts={baseMethodAccounts} receivableAccountId={receivableAccountId} customerCreditAccountId={customerCreditAccountId} />
              </div>
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Kode</th>
                      <th>Nama</th>
                      <th>Jenis</th>
                      <th>Akun</th>
                      <th>Instruksi</th>
                      <th>Urutan</th>
                      <th>Status</th>
                      <th className="text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.methods.map((row) => (
                      <tr key={row.id}>
                        <td className="num text-[11px] text-muted-foreground">{row.code}</td>
                        <td className="text-[12px] font-medium">
                          {row.name}
                          {row.feeEnabled ? (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              Fee {row.feeType === "percent" ? `${row.feeValue}%` : `Rp${Number(row.feeValue).toLocaleString("id-ID")}`} / transaksi
                            </span>
                          ) : null}
                        </td>
                        <td className="text-[11px]">{methodTypeLabels[row.type] ?? row.type}</td>
                        <td className="num text-[11px]">{accountName(row.accountId)}</td>
                        <td className="max-w-[280px] truncate text-[11px] text-muted-foreground">{row.instructions ?? "—"}</td>
                        <td className="num text-[11px]">{row.sortOrder}</td>
                        <td>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.isActive ? "bg-tone-green-soft text-tone-green" : "bg-muted text-muted-foreground"}`}>
                            {row.isActive ? "Aktif" : "Nonaktif"}
                          </span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <PaymentMethodForm
                              accounts={accountsForMethod(row.accountId)}
                              receivableAccountId={receivableAccountId}
                              customerCreditAccountId={customerCreditAccountId}
                              method={{
                                id: row.id,
                                code: row.code,
                                name: row.name,
                                type: row.type,
                                accountId: row.accountId,
                                instructions: row.instructions,
                                sortOrder: row.sortOrder,
                                feeEnabled: row.feeEnabled,
                                feeType: row.feeType,
                                feeValue: row.feeValue,
                              }}
                            />
                            <PaymentMethodRowActions id={row.id} name={row.name} isActive={row.isActive} />
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.methods.length === 0 ? (
                      <tr><td colSpan={8} className="py-6 text-center text-[11px] text-muted-foreground">Belum ada metode pembayaran.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })()
      ) : null}

      {tab === "grup" ? (
        <div className="space-y-3">
          <CustomerGroupManager
            groups={data.groups}
            accounts={data.accounts
              .filter((row) => row.type === "revenue" && row.normalBalance === "debit" && row.isPostable)
              .map((row) => ({ id: row.id, code: row.code, name: row.name }))}
            selectedGroupId={data.selectedGroup?.id ?? null}
          />
          {data.selectedGroup && data.priceData ? (
            <GroupPriceTable
              group={data.selectedGroup}
              rows={data.priceData.rows}
              total={data.priceData.total}
              page={data.priceData.page}
              pageSize={data.priceData.pageSize}
              q={params.q}
            />
          ) : null}
        </div>
      ) : null}

      {tab === "lokasi" ? (
        <>
        <div className="grid gap-3 xl:grid-cols-2">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Gudang</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Gudang default dipakai untuk stok awal dan transaksi POS.</p>
              </div>
              <WarehouseForm branches={data.branches.map((row) => ({ id: row.id, name: row.name }))} />
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Cabang</th><th>Status</th><th className="text-right">Aksi</th></tr>
                </thead>
                <tbody>
                  {data.warehouses.map((row) => (
                    <tr key={row.id}>
                      <td className="num text-[11px] text-muted-foreground">{row.code}</td>
                      <td className="text-[12px] font-medium">
                        {row.name}
                        {row.isDefault ? <span className="ml-1.5 rounded-full bg-tone-green-soft px-1.5 py-0.5 text-[11px] font-semibold text-tone-green">Utama</span> : null}
                      </td>
                      <td className="text-[11px] capitalize">{row.type}</td>
                      <td className="text-[11px]">{data.branches.find((b) => b.id === row.branchId)?.name ?? "—"}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.isActive ? "bg-tone-green-soft text-tone-green" : "bg-muted text-muted-foreground"}`}>
                          {row.isActive ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <WarehouseForm
                            branches={data.branches.map((b) => ({ id: b.id, name: b.name }))}
                            warehouse={{
                              id: row.id,
                              code: row.code,
                              name: row.name,
                              type: row.type,
                              branchId: row.branchId,
                              isDefault: row.isDefault,
                              isActive: row.isActive,
                            }}
                          />
                          <WarehouseRowActions id={row.id} name={row.name} isActive={row.isActive} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <h2 className="text-[13px] font-semibold">Cabang</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">Cabang mengelompokkan gudang dan sesi kas.</p>
              </div>
              <BranchForm />
            </div>
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr><th>Kode</th><th>Nama</th><th>Telepon</th><th>Alamat</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data.branches.map((row) => (
                    <tr key={row.id}>
                      <td className="num text-[11px] text-muted-foreground">{row.code}</td>
                      <td className="text-[12px] font-medium">
                        {row.name}
                        {row.isDefault ? <span className="ml-1.5 rounded-full bg-tone-green-soft px-1.5 py-0.5 text-[11px] font-semibold text-tone-green">Utama</span> : null}
                      </td>
                      <td className="num text-[11px]">{row.phone ?? "—"}</td>
                      <td className="max-w-[220px] truncate text-[11px] text-muted-foreground">{row.address ?? "—"}</td>
                      <td>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${row.isActive ? "bg-tone-green-soft text-tone-green" : "bg-muted text-muted-foreground"}`}>
                          {row.isActive ? "Aktif" : "Nonaktif"}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {data.branches.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-[11px] text-muted-foreground">Belum ada cabang.</td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* A-24 T3 (G3+G4): konfigurasi operasional gudang —
            alasan penyesuaian terkonfigurasi & pengingat siklus
            opname, tersimpan per perusahaan. */}
        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <AdjustmentReasonsEditor
            initialReasons={resolveAdjustmentReasons(settings.adjustmentReasons)}
            isCustom={settings.adjustmentReasons != null}
          />
          <OpnameCycleEditor
            warehouses={data.warehouses.map((row) => ({ id: row.id, name: row.name }))}
            categories={data.categories.map((row) => ({ id: row.id, name: row.name }))}
            initialConfig={sanitizeOpnameCycleConfig(settings.opnameCycle)}
          />
        </div>
        </>
      ) : null}

      {tab === "akun" ? (
        <div className="space-y-3">
          <MappingEditor
            mappings={data.mappings.map((row) => ({ key: row.key, accountId: row.accountId }))}
            accounts={data.accounts.map((row) => ({ id: row.id, code: row.code, name: row.name, type: row.type }))}
          />
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-[11px] text-muted-foreground">
            Gudang default saat ini: <span className="font-medium text-foreground">{warehouseName(settings.defaultWarehouseId)}</span>.
            Ubah di tab Umum. Akun yang belum dipetakan akan menggagalkan transaksi terkait dengan pesan yang jelas.
          </div>
        </div>
      ) : null}
      </SettingsPageFrame>
    </div>
  );
}
