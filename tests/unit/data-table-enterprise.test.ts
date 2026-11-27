import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  DataTable,
  DataTableFloatingBar,
} from "@/components/blocks/data-table";

type TestRow = {
  id: string;
  name: string;
  sku: string;
};

const columnHelper = createColumnHelper<TestRow>();

const testColumns = [
  columnHelper.accessor("name", {
    header: "Nama Produk",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("sku", {
    header: "SKU",
    cell: (info) => info.getValue(),
  }),
];

function TestTableComponent({ data }: { data: TestRow[] }) {
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: testColumns,
    getCoreRowModel: getCoreRowModel(),
  });

  return createElement(DataTable<TestRow>, { table, density: "compact" });
}

describe("DATA-TABLE-ENTERPRISE: Floating Action Bar", () => {
  it("tidak merender apa pun saat selectedCount === 0", () => {
    const html = renderToStaticMarkup(
      createElement(DataTableFloatingBar, {
        selectedCount: 0,
        onClearSelection: () => {},
      }),
    );
    expect(html).toBe("");
  });

  it("merender floating action dock saat selectedCount > 0", () => {
    const html = renderToStaticMarkup(
      createElement(
        DataTableFloatingBar,
        {
          selectedCount: 5,
          totalCount: 100,
          onClearSelection: () => {},
        },
        createElement("button", { type: "button" }, "Aksi Massal"),
      ),
    );
    expect(html).toContain("5");
    expect(html).toContain("terpilih dari 100");
    expect(html).toContain("Aksi Massal");
  });
});

describe("DATA-TABLE-ENTERPRISE: Core DataTable Component", () => {
  it("merender baris data dan kepala tabel dengan benar", () => {
    const rows: TestRow[] = [
      { id: "1", name: "Beras Premium 5kg", sku: "BRS-001" },
      { id: "2", name: "Minyak Goreng 2L", sku: "MYK-002" },
    ];

    const html = renderToStaticMarkup(createElement(TestTableComponent, { data: rows }));
    expect(html).toContain("Nama Produk");
    expect(html).toContain("SKU");
    expect(html).toContain("Beras Premium 5kg");
    expect(html).toContain("BRS-001");
    expect(html).toContain("Minyak Goreng 2L");
  });

  it("merender empty state saat baris data kosong", () => {
    const html = renderToStaticMarkup(createElement(TestTableComponent, { data: [] }));
    expect(html).toContain("Tidak ada data yang ditemukan.");
  });
});

describe("DATA-TABLE-ENTERPRISE: Responsive & aksesibilitas", () => {
  function ResponsiveTable({ data }: { data: TestRow[] }) {
    // eslint-disable-next-line react-hooks/incompatible-library
    const table = useReactTable({
      data,
      columns: testColumns,
      getCoreRowModel: getCoreRowModel(),
    });
    return createElement(DataTable<TestRow>, {
      table,
      density: "normal",
      ariaLabel: "Tabel produk uji",
      mobileCard: (row) =>
        createElement("div", { "data-mobile-card": row.id }, `${row.name} — kartu`),
    });
  }

  it("merender region tabel yang fokusabel dan kartu mobile", () => {
    const rows: TestRow[] = [{ id: "1", name: "Beras Premium 5kg", sku: "BRS-001" }];
    const html = renderToStaticMarkup(createElement(ResponsiveTable, { data: rows }));
    expect(html).toContain('role="region"');
    expect(html).toContain('aria-label="Tabel produk uji"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-mobile-card="1"');
    expect(html).toContain("Beras Premium 5kg — kartu");
    expect(html).toContain("BRS-001");
  });

  it("menampilkan empty state di kartu mobile saat data kosong", () => {
    const html = renderToStaticMarkup(createElement(ResponsiveTable, { data: [] }));
    expect(html).toContain("Tidak ada data yang ditemukan.");
  });
});
