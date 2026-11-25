import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { withCompanyReadOnly } from "@/db/tenant";
import { accounts, branches, customerGroups, customers, employees, fixedAssetCategories, products } from "@/db/schema";
import {
  listCategories,
  listCustomerGroups,
  listSuppliers,
  listUnits,
  listWarehouses,
} from "@/server/catalog";
import { ACCOUNT_SECTIONS } from "@/lib/accounting";
import {
  ACCOUNT_MAPPING_KEYS,
  MAPPING_GROUPS,
  MAPPING_LABELS,
} from "@/lib/account-mappings";
import {
  ENTITY_FIELDS,
  IMPORT_ENTITY_LABELS,
  IMPORT_SAMPLES,
  isImportEntity,
} from "@/lib/import-parse";
import { requirePermission } from "@/lib/session";
import { csvResponse, toCsv } from "@/lib/csv";
import { buildImportTemplate, type XlsxCell } from "@/lib/xlsx";
import { customFieldDefinitionsFor } from "@/lib/custom-fields";
import {
  customFieldImportField,
  customFieldImportHeader,
} from "@/lib/import/import-custom-fields";
import { getCompanySettingsRow } from "@/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Reference = { name: string; headers: string[]; rows: XlsxCell[][] };

async function sampleMatrix(csv: string): Promise<{ headers: string[]; rows: XlsxCell[][] }> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(csv, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });
  const headers = (matrix[0] ?? []).map((cell) => String(cell ?? "").trim());
  const rows = matrix
    .slice(1)
    .filter((row) => Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== ""))
    .map((row) => headers.map((_, index) => (row[index] ?? "") as XlsxCell));
  return { headers, rows };
}

/**
 * POS-IMP-03: template stok awal memakai produk nyata milik perusahaan.
 * Contoh statis lama menunjuk produk fiktif, sehingga unduhan pertama
 * selalu gagal validasi. Bila belum ada produk yang layak, sheet Data
 * hanya berisi header (pengguna mengisi sendiri).
 */
async function openingStockSample(companyId: string): Promise<{
  headers: string[];
  rows: XlsxCell[][];
}> {
  const headers = [
    "SKU",
    "Nama Produk",
    "Gudang Saldo Awal",
    "Kuantitas Saldo Awal",
    "Nilai Satuan",
    "Per Tanggal",
  ];
  return withCompanyReadOnly(companyId, async (tx) => {
    const [productRows, warehouseRows] = await Promise.all([
      tx
        .select({ sku: products.sku, name: products.name, costPrice: products.costPrice })
        .from(products)
        .where(
          and(
            eq(products.companyId, companyId),
            eq(products.isActive, true),
            eq(products.trackStock, true),
            eq(products.trackSerial, false),
            eq(products.trackBatch, false),
          ),
        )
        .orderBy(asc(products.name))
        .limit(100),
      listWarehouses(tx, companyId),
    ]);
    const product = productRows.find((row) => Number(row.costPrice) > 0) ?? null;
    const warehouse =
      warehouseRows.find((row) => row.isDefault) ?? warehouseRows[0] ?? null;
    return {
      headers,
      rows: product
        ? [[product.sku, product.name, warehouse?.name ?? "", 10, product.costPrice, ""]]
        : [],
    };
  });
}

const INSTRUCTIONS: Record<string, string[]> = {
  products:
    [
      "SKU wajib unik. Barcode sebaiknya diisi dan diformat sebagai teks agar nol di depan tidak hilang.",
      "Kategori, satuan, dan pemasok harus sudah ada (atau diimpor lebih dulu).",
      "Harga beli, harga jual, dan stok minimum ditulis angka tanpa Rp dan tanpa titik ribuan.",
      "Stok Awal > 0 membuat dokumen stok awal saat commit; kosongkan bila belum ada stok.",
      "Kolom Kemasan/Isi/Harga/Barcode/Status/Bawaan memakai daftar dipisah titik koma (;).",
    ],
  suppliers: [
    "Nama wajib. Kode kosong dibuat otomatis dengan format SUP-###.",
    "Pemasok dengan nama atau kode yang sama dilewati, bukan diduplikasi.",
    "Termin (hari) ditulis angka, mis. 30.",
  ],
  customers: [
    "Nama wajib. Kode kosong dibuat otomatis dengan format CUST-###.",
    "Kelompok harga harus sudah ada; kosongkan bila pelanggan tanpa kelompok.",
    "Batas kredit dan termin ditulis angka.",
  ],
  accounts: [
    "Kode akun wajib unik, ditulis sebagai teks (mis. 1101).",
    "Tipe yang dikenal: asset, liability, equity, revenue, expense, cogs — istilah Accurate seperti Aktiva/Kewajiban juga diterjemahkan.",
    "Saldo normal: debit/kredit. Bagian laporan memakai label yang tertera di sheet Referensi.",
    "Akun dengan kode yang sudah ada dilewati; hierarki induk tidak diimpor dari file ini.",
  ],
  categories: [
    "Nama kategori wajib unik. Induk kategori harus sudah ada; impor induk lebih dulu bila bertingkat.",
    "Status: Aktif/Nonaktif. Kosong dianggap Aktif.",
  ],
  units: [
    "Kode satuan wajib unik dan otomatis ditulis huruf besar (PCS, BOX, KG).",
    "Nama satuan wajib. Kode atau nama yang sudah ada dilewati.",
  ],
  account_mappings: [
    "Kunci pemetaan wajib memakai kunci yang tertera di sheet Referensi (mis. cash, bank, payable).",
    "Kode akun harus sudah ada di bagan akun. Baris dengan kunci yang sudah dipetakan akan MEMPERBARUI akunnya.",
    "Satu kunci hanya boleh muncul sekali dalam file.",
  ],
  branches: [
    "Nama cabang wajib. Kode kosong dibuat otomatis dengan format CBG-###.",
    "Cabang dengan kode atau nama yang sama dilewati, bukan diduplikasi.",
    "Status: Aktif/Nonaktif. Kosong dianggap Aktif.",
  ],
  warehouses: [
    "Nama gudang wajib. Kode kosong dibuat otomatis dengan format GD-###.",
    "Kode cabang harus sudah ada; kosongkan bila gudang tidak terikat cabang.",
    "Tipe: Gudang, Toko, atau Karantina (kosong = Gudang).",
    "Gudang dengan kode atau nama yang sama dilewati.",
  ],
  payment_methods: [
    "Nama metode wajib. Kode kosong dibuat otomatis dengan format PM-###.",
    "Tipe: Tunai, Bank, QRIS, Kredit, atau Piutang (kosong = Tunai).",
    "Kode akun opsional, tetapi bila diisi harus sudah ada di bagan akun.",
    "Metode dengan kode atau nama yang sama dilewati.",
  ],
  customer_groups: [
    "Nama kelompok harga wajib dan harus unik.",
    "Tipe diskon: Percent (0–100) atau Amount (nominal rupiah).",
    "Pembulatan = kelipatan harga; arah: down/up/nearest.",
    "Bulatkan Total Tunai: Ya/Tidak. Status: Aktif/Nonaktif.",
  ],
  employees: [
    "Nama karyawan wajib; kode kosong dibuat otomatis dengan format EMP-###.",
    "Gaji pokok/tunjangan/potongan berupa angka ≥ 0.",
    "Tanggal masuk wajib YYYY-MM-DD bila diisi.",
    "Karyawan dengan kode atau NIK yang sama dilewati.",
  ],
  fixed_assets: [
    "Nama, tanggal perolehan, harga perolehan, dan kode akun sumber wajib.",
    "Umur manfaat (bulan) wajib bila kategori tidak punya bawaan.",
    "Jurnal perolehan dibuat otomatis oleh aturan akuntansi yang sama dengan form aset.",
    "Aset dengan nama+tanggal+harga yang sama dilewati (idempoten).",
  ],
  opening_stock: [
    "Produk harus sudah ada dan dicocokkan dari SKU atau nama.",
    "Qty wajib diisi dalam SATUAN DASAR produk (PCS/kg/...); isi 0 untuk saldo nol.",
    "Biaya satuan wajib untuk qty selain 0. Bila stok memang gratis, centang \"Izinkan biaya 0\" di wizard sebelum validasi.",
    "Gudang dan tanggal opsional; bila kosong, wizard memakai gudang/tanggal cut-off yang dipilih. Format tanggal YYYY-MM-DD.",
  ],
  opening_payables: [
    "Pemasok harus sudah ada dan dicocokkan dari nama atau kode.",
    "Tanggal wajib (YYYY-MM-DD), jumlah wajib > 0, referensi membantu mencegah duplikat.",
  ],
  opening_receivables: [
    "Pelanggan harus sudah ada dan dicocokkan dari nama atau kode.",
    "Tanggal wajib (YYYY-MM-DD), jumlah wajib > 0, referensi membantu mencegah duplikat.",
  ],
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ entity: string }> },
) {
  const { entity } = await params;
  if (!isImportEntity(entity)) {
    return NextResponse.json({ error: "Jenis impor tidak dikenal." }, { status: 404 });
  }
  const ctx = await requirePermission("import.manage");
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const sample = IMPORT_SAMPLES[entity];
  const customEntity = entity === "suppliers" ? "supplier" : entity === "customers" ? "customer" : null;
  const customFields = customEntity
    ? await withCompanyReadOnly(ctx.company.id, async (tx) => {
        const settings = await getCompanySettingsRow(tx, ctx.company.id);
        return customFieldDefinitionsFor(settings?.customFields, customEntity);
      })
    : [];
  const openingSample =
    entity === "opening_stock" ? await openingStockSample(ctx.company.id) : null;

  if (format === "csv") {
    if (openingSample) {
      return csvResponse(sample.fileName, toCsv(openingSample.headers, openingSample.rows));
    }
    if (customFields.length === 0) return csvResponse(sample.fileName, sample.csv);
    const sampleData = await sampleMatrix(sample.csv);
    const headers = [...sampleData.headers, ...customFields.map(customFieldImportHeader)];
    const rows = sampleData.rows.map((row) => [...row, ...customFields.map(() => "")]);
    return csvResponse(sample.fileName, toCsv(headers, rows));
  }

  const references = await withCompanyReadOnly(ctx.company.id, async (tx): Promise<Reference[]> => {
    if (entity === "products") {
      const [categories, units, suppliers] = await Promise.all([
        listCategories(tx, ctx.company.id),
        listUnits(tx, ctx.company.id),
        listSuppliers(tx, ctx.company.id),
      ]);
      return [
        { name: "Kategori", headers: ["Nama kategori"], rows: categories.map((row) => [row.name]) },
        { name: "Satuan", headers: ["Kode", "Nama"], rows: units.map((row) => [row.code, row.name]) },
        { name: "Pemasok", headers: ["Nama pemasok"], rows: suppliers.map((row) => [row.name]) },
      ];
    }
    if (entity === "customers") {
      const groups = await listCustomerGroups(tx, ctx.company.id);
      return [{ name: "Kelompok harga", headers: ["Nama kelompok"], rows: groups.map((row) => [row.name]) }];
    }
    if (entity === "accounts") {
      return [
        {
          name: "Referensi akun",
          headers: ["Jenis referensi", "Nilai"],
          rows: [
            ...["asset", "liability", "equity", "revenue", "expense", "cogs"].map(
              (value) => ["Tipe akun", value] as XlsxCell[],
            ),
            ...Object.entries(ACCOUNT_SECTIONS).map(
              ([key, label]) => ["Bagian laporan", `${key} — ${label}`] as XlsxCell[],
            ),
            ["Saldo normal", "debit / kredit"],
          ],
        },
      ];
    }
    if (entity === "categories") {
      const categories = await listCategories(tx, ctx.company.id);
      const byId = new Map(categories.map((row) => [row.id, row.name]));
      return [
        {
          name: "Kategori",
          headers: ["Nama kategori", "Induk"],
          rows: categories.map((row) => [row.name, row.parentId ? byId.get(row.parentId) ?? "" : ""]),
        },
      ];
    }
    if (entity === "branches") {
      const rows = await tx
        .select({ code: branches.code })
        .from(branches)
        .where(eq(branches.companyId, ctx.company.id))
        .orderBy(asc(branches.code));
      return [{ name: "Cabang", headers: ["Kode cabang"], rows: rows.map((row) => [row.code]) }];
    }
    if (entity === "warehouses") {
      const rows = await tx
        .select({ code: branches.code, name: branches.name })
        .from(branches)
        .where(eq(branches.companyId, ctx.company.id))
        .orderBy(asc(branches.code));
      return [{ name: "Cabang", headers: ["Kode cabang", "Nama cabang"], rows: rows.map((row) => [row.code, row.name]) }];
    }
    if (entity === "employees") {
      const rows = await tx
        .select({ code: employees.code, name: employees.name })
        .from(employees)
        .where(eq(employees.companyId, ctx.company.id))
        .orderBy(asc(employees.code));
      return [{ name: "Karyawan", headers: ["Kode", "Nama"], rows: rows.map((row) => [row.code, row.name]) }];
    }
    if (entity === "fixed_assets") {
      const [categories, assetAccounts] = await Promise.all([
        tx
          .select({ code: fixedAssetCategories.code, name: fixedAssetCategories.name })
          .from(fixedAssetCategories)
          .where(eq(fixedAssetCategories.companyId, ctx.company.id))
          .orderBy(asc(fixedAssetCategories.code)),
        tx
          .select({ code: accounts.code, name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.isActive, true)))
          .orderBy(asc(accounts.code)),
      ]);
      return [
        {
          name: "Kategori aset",
          headers: ["Kode kategori", "Nama kategori"],
          rows: categories.map((row) => [row.code, row.name]),
        },
        {
          name: "Akun",
          headers: ["Kode akun", "Nama akun"],
          rows: assetAccounts.map((row) => [row.code, row.name]),
        },
      ];
    }
    if (entity === "payment_methods") {
      const accountRows = await tx
        .select({ code: accounts.code, name: accounts.name, type: accounts.type })
        .from(accounts)
        .where(and(eq(accounts.companyId, ctx.company.id), eq(accounts.isActive, true)))
        .orderBy(asc(accounts.code));
      return [
        {
          name: "Akun",
          headers: ["Kode akun", "Nama akun", "Tipe"],
          rows: accountRows.map((row) => [row.code, row.name, row.type]),
        },
      ];
    }
    if (entity === "customer_groups") {
      const rows = await tx
        .select({ name: customerGroups.name })
        .from(customerGroups)
        .where(eq(customerGroups.companyId, ctx.company.id))
        .orderBy(asc(customerGroups.name));
      return [{ name: "Kelompok", headers: ["Nama kelompok"], rows: rows.map((row) => [row.name]) }];
    }
    if (entity === "account_mappings") {
      const accountRows = await tx
        .select({ code: accounts.code, name: accounts.name })
        .from(accounts)
        .where(eq(accounts.companyId, ctx.company.id))
        .orderBy(asc(accounts.code));
      const groupByKey = new Map<string, string>();
      for (const group of MAPPING_GROUPS) {
        for (const key of group.keys) groupByKey.set(key, group.title);
      }
      return [
        {
          name: "Kunci Pemetaan",
          headers: ["Kunci", "Label", "Grup"],
          rows: ACCOUNT_MAPPING_KEYS.map((key) => [
            key,
            MAPPING_LABELS[key] ?? key,
            groupByKey.get(key) ?? "",
          ]),
        },
        {
          name: "Akun",
          headers: ["Kode akun", "Nama akun"],
          rows: accountRows.map((row) => [row.code, row.name]),
        },
      ];
    }
    if (entity === "opening_stock") {
      const [productRows, warehouses] = await Promise.all([
        tx
          .select({ sku: products.sku, name: products.name })
          .from(products)
          .where(eq(products.companyId, ctx.company.id))
          .orderBy(asc(products.name)),
        listWarehouses(tx, ctx.company.id),
      ]);
      return [
        { name: "Produk", headers: ["SKU", "Nama produk"], rows: productRows.map((row) => [row.sku, row.name]) },
        { name: "Gudang", headers: ["Nama gudang"], rows: warehouses.map((row) => [row.name]) },
      ];
    }
    if (entity === "opening_payables" || entity === "opening_receivables") {
      const table = entity === "opening_payables" ? "Pemasok" : "Pelanggan";
      const rows =
        entity === "opening_payables"
          ? (await listSuppliers(tx, ctx.company.id)).map((row) => [row.name, row.code])
          : await listCustomersReference(tx, ctx.company.id);
      return [{ name: table, headers: ["Nama", "Kode"], rows }];
    }
    return [];
  });

  const sampleData = openingSample ?? (await sampleMatrix(sample.csv));
  const fileBase = sample.fileName.replace(/\.csv$/i, "");
  const customFieldInstructions = customFields.map((field) => {
    const type =
      field.type === "select"
        ? ` Pilihan yang diterima: ${(field.options ?? []).join(", ")}.`
        : field.type === "date"
          ? " Gunakan format YYYY-MM-DD."
          : field.type === "number"
            ? " Isi dengan angka yang valid."
            : "";
    return `Kolom kustom ${field.label}.${type}${field.required ? " Kolom kosong tetap dapat diimpor dan akan diberi catatan untuk dilengkapi." : ""}`;
  });
  const workbook = await buildImportTemplate({
    entityLabel: IMPORT_ENTITY_LABELS[entity],
    headers: [...sampleData.headers, ...customFields.map(customFieldImportHeader)],
    exampleRows: sampleData.rows.map((row) => [...row, ...customFields.map(() => "")]),
    fields: [...ENTITY_FIELDS[entity], ...customFields.map(customFieldImportField)],
    instructions: [...(INSTRUCTIONS[entity] ?? []), ...customFieldInstructions],
    references,
  });
  return new Response(new Uint8Array(workbook), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Daftar pelanggan ringkas untuk sheet referensi saldo awal piutang. */
async function listCustomersReference(
  tx: Tx,
  companyId: string,
): Promise<XlsxCell[][]> {
  const rows = await tx
    .select({ name: customers.name, code: customers.code })
    .from(customers)
    .where(eq(customers.companyId, companyId))
    .orderBy(asc(customers.name));
  return rows.map((row) => [row.name, row.code]);
}
