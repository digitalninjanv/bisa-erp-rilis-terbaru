import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { asc, eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { withCompanyReadOnly } from "@/db/tenant";
import { accounts, customers, products } from "@/db/schema";
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

function sampleMatrix(csv: string): { headers: string[]; rows: XlsxCell[][] } {
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
  opening_stock: [
    "Produk harus sudah ada dan dicocokkan dari SKU atau nama.",
    "Qty wajib > 0 dan biaya satuan wajib. Tanggal memakai format YYYY-MM-DD.",
    "Gudang harus sudah ada; bila kolom gudang kosong, wizard memakai gudang yang dipilih.",
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

  if (format === "csv") {
    if (customFields.length === 0) return csvResponse(sample.fileName, sample.csv);
    const sampleData = sampleMatrix(sample.csv);
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

  const sampleData = sampleMatrix(sample.csv);
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
  return new Response(
    new Uint8Array(
      buildImportTemplate({
        entityLabel: IMPORT_ENTITY_LABELS[entity],
        headers: [...sampleData.headers, ...customFields.map(customFieldImportHeader)],
        exampleRows: sampleData.rows.map((row) => [...row, ...customFields.map(() => "")]),
        fields: [...ENTITY_FIELDS[entity], ...customFields.map(customFieldImportField)],
        instructions: [...(INSTRUCTIONS[entity] ?? []), ...customFieldInstructions],
        references,
      }),
    ),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fileBase}.xlsx"`,
        "Cache-Control": "no-store",
      },
    },
  );
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
