import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { withCompanyReadOnly } from "@/db/tenant";
import { importJobs } from "@/db/schema";
import { getSettings, listLinkedJournalsBySourceIds, listWarehouses, pickDefaultWarehouseId } from "@/server/catalog";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import { requirePermissionPage } from "@/lib/session";
import { IMPORT_ENTITY_LABELS, type ImportEntity } from "@/lib/import-parse";
import { PageHeader } from "@/components/blocks/page-header";
import { ImportWizard } from "@/components/gudang/import-wizard";
import { MasterImportWizard } from "@/components/gudang/import-master-wizard";

export const metadata = { title: "Impor data" };
export const dynamic = "force-dynamic";

const ENTITY_TABS: { key: ImportEntity; hint: string }[] = [
  { key: "products", hint: "Ekspor Accurate dikenali otomatis: Harga Jual dari Def. Hrg. Jual Satuan #1, stok dari Kuantitas Saldo Awal, multi-satuan Satuan #2..#5 menjadi kemasan, dan Jenis Barang/Non Aktif/Lacak seri/batch menjadi atribut. Filter Siap impor hanya menampilkan baris lengkap (SKU, Nama, Barcode, Satuan, Harga beli > 0, Harga jual > 0); baris lain ada di Belum lengkap dan tidak dapat dipilih. Kolom kemasan ERP (Kemasan, Isi Kemasan, harga, barcode, status, bawaan) tetap tersedia sebagai daftar paralel berpisah titik koma." },
  { key: "suppliers", hint: "Kolom: Kode/No. Pemasok, Nama, Telepon, Email, Alamat, NPWP, Bank, Termin/Syarat, Catatan. Nama yang sudah ada dilewati; kode kosong dibuatkan otomatis." },
  { key: "customers", hint: "Kolom: Kode/No. Pelanggan, Nama, Telepon, Email, Alamat, Kategori Harga, Batas Piutang, Termin/Syarat, NPWP, Catatan. Kelompok harga ditulis dengan namanya dan harus sudah ada." },
  { key: "accounts", hint: "Kolom: Kode, Nama, Tipe, Saldo Normal, Bagian, Keterangan. Tipe Accurate (Aktiva, Kewajiban Lancar, Cash/Bank, COGS, dll.) diterjemahkan otomatis; kode yang sudah ada dilewati. Hierarki akun induk tidak diimpor — untuk perusahaan berjalan, petakan ke COA ERP yang ada." },
  { key: "categories", hint: "Kolom: Nama Kategori, Induk Kategori, Status. Induk harus sudah ada (atau impor induk lebih dulu); kategori dengan nama sama dilewati. Contoh: Minuman → Kopi & Teh." },
  { key: "units", hint: "Kolom: Kode Satuan, Nama Satuan, Status. Kode ditulis huruf besar (PCS, BOX, KG); kode/nama yang sudah ada dilewati. Satuan dipakai di produk dan transaksi." },
  { key: "account_mappings", hint: "Kolom: Kunci pemetaan, Kode akun. Kunci harus dari daftar resmi (sheet Referensi di template); kode akun harus sudah ada. Baris dengan kunci yang sudah dipetakan akan memperbarui akunnya." },
  { key: "branches", hint: "Kolom: Kode, Nama, Alamat, Telepon, Status. Kode kosong dibuat otomatis (CBG-###); cabang dengan kode/nama sama dilewati. Cabang adalah induk gudang." },
  { key: "warehouses", hint: "Kolom: Kode, Nama, Tipe, Kode Cabang, Status. Tipe: Gudang/Toko/Karantina. Kode kosong dibuat otomatis (GD-###); kode/nama yang sudah ada dilewati. Kode cabang harus sudah ada." },
  { key: "payment_methods", hint: "Kolom: Kode, Nama, Tipe, Kode Akun, Instruksi, Status. Tipe: Tunai/Bank/QRIS/Kredit/Piutang. Kode kosong dibuat otomatis (PM-###); kode yang sudah ada dilewati. Kode akun harus ada di bagan akun." },
  { key: "customer_groups", hint: "Kolom: Nama Kelompok, Tipe Diskon, Nilai Diskon, Pembulatan, Arah Pembulatan, Bulatkan Total Tunai, Status. Tipe diskon: Percent/Amount. Nama yang sudah ada dilewati." },
  { key: "employees", hint: "Kolom: Kode, Nama, Jabatan, Gaji Pokok, Tunjangan, Potongan, Tanggal Masuk, NIK, Status PTKP, Status. Kode kosong dibuat otomatis (EMP-###); kode/NIK yang sudah ada dilewati." },
  { key: "fixed_assets", hint: "Kolom: Nama Aset, Kategori, Tanggal Perolehan, Harga Perolehan, Nilai Residu, Umur Manfaat (bulan), Kode Akun Sumber, Catatan. Jurnal perolehan dibuat otomatis; aset dengan nama+tanggal+harga sama dilewati." },
  { key: "opening_stock", hint: "Kolom: SKU/Kode Barang, Nama Produk, Gudang Saldo Awal, Kuantitas Saldo Awal, Nilai Satuan, Per Tanggal. Produk harus sudah ada. Impor dikelompokkan per gudang dan tanggal, dan SKU yang sudah diimpor di gudang yang sama akan dilewati. Gunakan angka 0 untuk stok nol." },
  { key: "opening_payables", hint: "Kolom: Nama Pemasok, Tanggal, Jatuh Tempo, Jumlah, Referensi. Pemasok harus sudah ada (dicocokkan dari nama atau kode); setiap baris menjadi satu dokumen saldo awal utang dengan jurnal pembukanya." },
  { key: "opening_receivables", hint: "Kolom: Nama Pelanggan, Tanggal, Jatuh Tempo, Jumlah, Referensi. Pelanggan harus sudah ada (dicocokkan dari nama atau kode); setiap baris menjadi satu dokumen saldo awal piutang dengan jurnal pembukanya." },
];

const MASTER_TITLES: Record<Exclude<ImportEntity, "products">, string> = {
  suppliers: "Unggah file pemasok",
  customers: "Unggah file pelanggan",
  accounts: "Unggah file bagan akun",
  categories: "Unggah file kategori produk",
  units: "Unggah file satuan",
  account_mappings: "Unggah file pemetaan akun",
  branches: "Unggah file cabang",
  warehouses: "Unggah file gudang",
  payment_methods: "Unggah file metode pembayaran",
  customer_groups: "Unggah file kelompok harga",
  employees: "Unggah file karyawan",
  fixed_assets: "Unggah file aset tetap",
  opening_stock: "Unggah file stok awal",
  opening_payables: "Unggah file saldo awal utang",
  opening_receivables: "Unggah file saldo awal piutang",
};

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ jenis?: string }>;
}) {
  const ctx = await requirePermissionPage("import.manage");
  const params = await searchParams;
  const entity: ImportEntity =
    params.jenis === "suppliers" ||
    params.jenis === "customers" ||
    params.jenis === "accounts" ||
    params.jenis === "categories" ||
    params.jenis === "units" ||
    params.jenis === "account_mappings" ||
    params.jenis === "branches" ||
    params.jenis === "warehouses" ||
    params.jenis === "payment_methods" ||
    params.jenis === "customer_groups" ||
    params.jenis === "employees" ||
    params.jenis === "fixed_assets" ||
    params.jenis === "opening_stock" ||
    params.jenis === "opening_payables" ||
    params.jenis === "opening_receivables"
      ? params.jenis
      : "products";

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const [warehouses, settings, jobs] = await Promise.all([
      listWarehouses(tx, ctx.company.id),
      getSettings(tx, ctx.company.id),
      tx
        .select({
          id: importJobs.id,
          fileName: importJobs.fileName,
          status: importJobs.status,
          totalRows: importJobs.totalRows,
          successRows: importJobs.successRows,
          failedRows: importJobs.failedRows,
          createdAt: importJobs.createdAt,
        })
        .from(importJobs)
        .where(and(eq(importJobs.companyId, ctx.company.id), eq(importJobs.entity, entity)))
        .orderBy(desc(importJobs.createdAt))
        .limit(10),
    ]);
    // A-24 T4: impor produk yang membawa stok awal membentuk jurnal
    // "opening" bersumber job ini — tautkan dari riwayat impornya.
    const journalsByJob = await listLinkedJournalsBySourceIds(
      tx,
      ctx.company.id,
      jobs.map((job) => job.id),
    );
    const jobsWithJournal = jobs.map((job) => {
      const opening = (journalsByJob.get(job.id) ?? []).find(
        (journal) => journal.sourceType === "opening" && !journal.reversalOfId,
      );
      return { ...job, journalId: opening?.id ?? null, journalNumber: opening?.number ?? null };
    });
    const customEntity = entity === "suppliers" ? "supplier" : entity === "customers" ? "customer" : null;
    return {
      warehouses,
      customFields: customEntity ? customFieldDefinitionsFor(settings?.customFields, customEntity) : [],
      jobs: jobsWithJournal,
      defaultWarehouseId: pickDefaultWarehouseId(warehouses, settings?.defaultWarehouseId),
    };
  });

  const history = data.jobs.map((job) => ({ ...job, createdAt: job.createdAt.toISOString() }));
  const activeTab = ENTITY_TABS.find((tab) => tab.key === entity) ?? ENTITY_TABS[0];

  return (
    <div>
      <PageHeader
        eyebrow="Gudang"
        title="Impor data"
        description="Satu kerangka untuk semua jenis impor: unduh template Excel, petakan kolom, validasi per baris, pilih baris, lalu commit. Setiap jenis punya contoh dan petunjuk kolom di dalam berkas template."
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {ENTITY_TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "products" ? "/app/gudang/impor" : `/app/gudang/impor?jenis=${tab.key}`}
            className={`inline-flex h-8 items-center rounded-md px-3 text-[12px] font-medium ${
              entity === tab.key
                ? "bg-primary-soft font-medium text-primary"
                : "border border-border bg-card hover:bg-muted"
            }`}
          >
            {IMPORT_ENTITY_LABELS[tab.key]}
          </Link>
        ))}
      </div>
      {entity === "products" ? (
        <ImportWizard
          warehouses={data.warehouses}
          defaultWarehouseId={data.defaultWarehouseId}
          history={history}
        />
      ) : (
        <MasterImportWizard
          entity={entity}
          title={MASTER_TITLES[entity]}
          description={activeTab.hint}
          customFields={data.customFields}
          warehouses={data.warehouses}
          defaultWarehouseId={data.defaultWarehouseId}
          history={history}
        />
      )}
    </div>
  );
}
