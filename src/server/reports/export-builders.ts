// A-28 Tahap 3 (H-AKT-01): builder ReportTable untuk semua ekspor
// laporan. Setiap builder memanggil fungsi domain laporan yang sama
// persis dengan halaman layar/cetak/CSV warisan (statements, sales,
// ledger, arap) — perakitan baris di sini menggantikan perakitan inline
// yang dulu tersebar di route ekspor, agar CSV & XLSX tidak pernah
// berangkat dari dua definisi berbeda.

import type { Tx } from "@/db";
import { getCompanySettingsRow } from "@/server/settings";
import {
  ageBucketLabel,
  ageDays,
  dueDateStatus,
  paymentStatusLabel,
} from "@/lib/due-date";
import { journalSourceLabel, paymentMethodTypeLabel, todayISO } from "@/lib/format";
import {
  visibleEquityRows,
  visibleStatementLines,
  visibleTrialRows,
} from "@/lib/report-visibility";
import {
  empty,
  money,
  num,
  text,
  type ReportCell,
  type ReportRow,
  type ReportTable,
} from "./export-table";
import {
  getBalanceSheet,
  getCashFlow,
  getEquityStatement,
  getIncomeStatement,
  getTrialBalance,
} from "./statements";
import {
  getPaymentBreakdown,
  getSalesByCashier,
  getSalesByCategory,
  getSalesByDay,
  getSalesSummary,
  getTopProducts,
} from "./sales";
import { getLedger, listAccounts, resolveDefaultLedgerAccountId } from "./ledger";
import { listPayables, listReceivables } from "./arap";
import { getVatReport } from "./vat";

function blankRow(width: number): ReportRow {
  return { kind: "blank", cells: Array.from({ length: width }, () => empty()) };
}

type StatementLineLike = { code: string; name: string; accountId: string; amount: number };

/** Satu seksi laporan satu periode: judul, baris akun terindentasi, total. */
function statementSection(
  heading: string,
  rows: StatementLineLike[],
  totalLabel: string,
  total: number,
  hideZero: boolean,
): ReportRow[] {
  const visible = visibleStatementLines(rows, [], hideZero);
  return [
    { kind: "section", cells: [text(heading), empty(), empty()] },
    ...visible.map(
      (row): ReportRow => ({
        kind: "data",
        indent: 1,
        indentCol: 1,
        cells: [text(row.code), text(row.name), money(row.amount)],
      }),
    ),
    {
      kind: "total",
      cells: [empty(), text(totalLabel), money(total)],
    },
  ];
}

function summaryRow(kind: ReportRow["kind"], label: string, current: number): ReportRow {
  return { kind, cells: [empty(), text(label), money(current)] };
}

async function companyLine(tx: Tx, companyId: string, fallback: string): Promise<string> {
  const settings = await getCompanySettingsRow(tx, companyId);
  return settings?.legalName ?? fallback;
}

/* ------------------------------------------------------------------ */
/* Laporan berkala (/api/export/report)                                */
/* ------------------------------------------------------------------ */

export async function buildReportExportTable(
  tx: Tx,
  company: { id: string; name: string },
  type: string,
  from: string,
  to: string,
  // A-28 UI-3 (AKT-09): perilaku akun hampa yang sama dengan layar &
  // cetak — bawaan tersembunyi; rute meneruskan saklar `nol=1`
  // pengguna sebagai hideZero=false. Total tidak pernah berubah.
  options?: { hideZero?: boolean },
): Promise<ReportTable> {
  const hideZero = options?.hideZero ?? true;
  const companyName = await companyLine(tx, company.id, company.name);
  const range = { from: `${from}T00:00:00`, to: `${to}T23:59:59` };
  const periodSubtitle = `Periode ${from} s/d ${to}`;
  // Satu periode: semua ekspor laporan tidak lagi memuat kolom pembanding.
  const statementWidths = [10, 52, 20];

  if (type === "ppn") {
    const data = await getVatReport(tx, company.id, { from, to });
    const headers = [
      "Tanggal",
      "Jurnal",
      "Sumber",
      "Dokumen",
      "Keterangan",
      "DPP",
      "PPN Masukan",
      "PPN Keluaran",
    ];
    return {
      sheetName: "Buku PPN",
      company: companyName,
      title: "Buku PPN",
      subtitle: periodSubtitle,
      csvFirstRow: headers.map((header) => text(header)),
      titleRow: [text("Buku PPN"), text(periodSubtitle)],
      headerRow: headers.map((header) => text(header)),
      xlsxHeaders: headers,
      widths: [12, 18, 22, 20, 40, 17, 17, 17],
      csvWidth: 8,
      rows: [
        ...data.lines.map(
          (row): ReportRow => ({
            kind: "data",
            cells: [
              text(row.date),
              text(row.number),
              text(journalSourceLabel(row.sourceType)),
              text(row.sourceNumber || "—"),
              text(row.description || "—"),
              row.dpp != null ? money(row.dpp) : empty(),
              row.direction === "input" ? money(row.amount) : empty(),
              row.direction === "output" ? money(row.amount) : empty(),
            ],
          }),
        ),
        blankRow(8),
        {
          kind: "total",
          cells: [empty(), empty(), empty(), empty(), text("Total PPN Masukan"), empty(), money(data.input), empty()],
        },
        {
          kind: "total",
          cells: [empty(), empty(), empty(), empty(), text("Total PPN Keluaran"), empty(), empty(), money(data.output)],
        },
        {
          kind: "grand",
          cells: [
            empty(),
            empty(),
            empty(),
            empty(),
            text(data.net > 0 ? "PPN kurang bayar" : data.net < 0 ? "PPN lebih bayar" : "PPN neto"),
            empty(),
            money(Math.abs(data.net)),
            empty(),
          ],
        },
      ],
    };
  }

  if (type === "neraca") {
    const data = await getBalanceSheet(tx, company.id, to);
    return {
      sheetName: "Neraca",
      company: companyName,
      title: "Laporan Posisi Keuangan",
      subtitle: `Per ${to}`,
      csvFirstRow: [text(companyName)],
      titleRow: [text("Laporan Posisi Keuangan"), text(`Per ${to}`)],
      headerRow: [text("Kode"), text("Akun"), empty()],
      xlsxHeaders: ["Kode", "Akun", "Jumlah"],
      widths: statementWidths,
      csvWidth: 3,
      rows: [
        ...statementSection("ASET LANCAR", data.currentAssets, "Total aset lancar", data.totalCurrentAssets, hideZero),
        ...statementSection("ASET TIDAK LANCAR", data.nonCurrentAssets, "Total aset tidak lancar", data.totalNonCurrentAssets, hideZero),
        summaryRow("grand", "Total aset", data.totalAssets),
        blankRow(3),
        ...statementSection("LIABILITAS JANGKA PENDEK", data.currentLiabilities, "Total liabilitas jangka pendek", data.totalCurrentLiabilities, hideZero),
        ...statementSection("LIABILITAS JANGKA PANJANG", data.nonCurrentLiabilities, "Total liabilitas jangka panjang", data.totalNonCurrentLiabilities, hideZero),
        summaryRow("total", "Total liabilitas", data.totalLiabilities),
        blankRow(3),
        { kind: "section", cells: [text("EKUITAS"), empty(), empty()] },
        ...visibleStatementLines(data.equity, [], hideZero).map(
          (row): ReportRow => ({
            kind: "data",
            indent: 1,
            indentCol: 1,
            cells: [text(row.code), text(row.name), money(row.amount)],
          }),
        ),
        summaryRow("data", "Laba periode berjalan", data.netProfit),
        summaryRow("total", "Total ekuitas", data.totalEquity),
        summaryRow("grand", "Total liabilitas + ekuitas", data.totalLiabilities + data.totalEquity),
      ],
    };
  }

  if (type === "arus-kas") {
    const data = await getCashFlow(tx, company.id, range);
    const groupLabels: Record<string, string> = {
      operating: "Operasi",
      investing: "Investasi",
      financing: "Pendanaan",
      unclassified: "Belum terklasifikasi",
    };
    const flowRow = (kind: ReportRow["kind"], label: string, current: number): ReportRow => ({
      kind,
      cells: [empty(), text(label), empty(), empty(), money(current)],
    });
    return {
      sheetName: "Arus Kas",
      company: companyName,
      title: "Laporan Arus Kas",
      subtitle: periodSubtitle,
      csvFirstRow: [text(companyName)],
      titleRow: [text("Laporan Arus Kas"), text(periodSubtitle)],
      headerRow: [text("Kelompok"), text("Sumber"), text("Masuk"), text("Keluar"), text("Net")],
      xlsxHeaders: ["Kelompok", "Sumber", "Masuk", "Keluar", "Net"],
      widths: [16, 30, 16, 16, 18],
      csvWidth: 5,
      rows: [
        flowRow("total", "Saldo kas awal", data.opening),
        ...data.rows.map(
          (row): ReportRow => ({
            kind: "data",
            indent: 1,
            indentCol: 1,
            cells: [
              text(groupLabels[row.group] ?? row.group),
              text(journalSourceLabel(row.sourceType)),
              money(row.inflow),
              money(row.outflow),
              money(row.net),
            ],
          }),
        ),
        flowRow("total", "Kenaikan (penurunan) kas", data.net),
        flowRow("grand", "Saldo kas akhir", data.closing),
      ],
    };
  }

  if (type === "ekuitas") {
    const data = await getEquityStatement(tx, company.id, range);
    const totalAddition = data.rows.reduce((acc, row) => acc + row.addition, 0) + data.netProfit;
    const totalReduction = data.rows.reduce((acc, row) => acc + row.reduction, 0);
    const equityCells = (
      code: string,
      name: string,
      opening: number,
      addition: number,
      reduction: number,
      closing: number,
    ): ReportCell[] => [
      text(code),
      text(name),
      money(opening),
      money(addition),
      money(reduction),
      money(closing),
    ];
    return {
      sheetName: "Perubahan Ekuitas",
      company: companyName,
      title: "Laporan Perubahan Ekuitas",
      subtitle: periodSubtitle,
      csvFirstRow: [text(companyName)],
      titleRow: [text("Laporan Perubahan Ekuitas"), text(periodSubtitle)],
      headerRow: [
        text("Kode"),
        text("Akun"),
        text("Saldo awal"),
        text("Penambahan"),
        text("Pengurangan"),
        text("Saldo akhir"),
      ],
      xlsxHeaders: ["Kode", "Akun", "Saldo awal", "Penambahan", "Pengurangan", "Saldo akhir"],
      widths: [10, 44, 17, 17, 17, 18],
      csvWidth: 6,
      rows: [
        ...visibleEquityRows(data.rows, [], hideZero).map(
          (row): ReportRow => ({
            kind: "data",
            indent: 1,
            indentCol: 1,
            cells: equityCells(row.code, row.name, row.opening, row.addition, row.reduction, row.closing),
          }),
        ),
        {
          kind: "data",
          cells: equityCells("", "Laba (rugi) periode berjalan", 0, data.netProfit, 0, data.netProfit),
        },
        {
          kind: "grand",
          cells: equityCells("", "Total ekuitas", data.totalOpening, totalAddition, totalReduction, data.totalClosing),
        },
      ],
    };
  }

  if (type === "neraca-saldo") {
    const data = await getTrialBalance(tx, company.id, range);
    return {
      sheetName: "Neraca Saldo",
      company: companyName,
      title: "Laporan Neraca Saldo",
      subtitle: periodSubtitle,
      csvFirstRow: [text(companyName)],
      titleRow: [text("Laporan Neraca Saldo"), text(periodSubtitle)],
      headerRow: [
        text("Kode"),
        text("Akun"),
        text("Awal"),
        text("Debit"),
        text("Kredit"),
        text("Akhir"),
      ],
      xlsxHeaders: ["Kode", "Akun", "Awal", "Debit", "Kredit", "Akhir"],
      widths: [10, 44, 17, 17, 17, 18],
      csvWidth: 6,
      rows: visibleTrialRows(data, [], hideZero).map(
        (row): ReportRow => ({
          kind: "data",
          indent: 1,
          indentCol: 1,
          cells: [
            text(row.code),
            text(row.name),
            money(row.opening),
            money(row.debit),
            money(row.credit),
            money(row.closing),
          ],
        }),
      ),
    };
  }

  if (type === "penjualan") {
    const [summary, byDay, byCashier, byCategory, top, payments] = await Promise.all([
      getSalesSummary(tx, company.id, range),
      getSalesByDay(tx, company.id, range),
      getSalesByCashier(tx, company.id, range),
      getSalesByCategory(tx, company.id, range),
      getTopProducts(tx, company.id, range, 20),
      getPaymentBreakdown(tx, company.id, range),
    ]);
    const section = (heading: string): ReportRow => ({
      kind: "section",
      cells: [text(heading), empty(), empty(), empty()],
    });
    const line = (label: string, count: number | null, amount: number | null, kind: ReportRow["kind"] = "data"): ReportRow => ({
      kind,
      cells: [text(label), count === null ? empty() : num(count), amount === null ? empty() : money(amount), empty()],
    });
    return {
      sheetName: "Penjualan",
      company: companyName,
      title: "Laporan Penjualan",
      subtitle: periodSubtitle,
      csvFirstRow: [text(companyName)],
      titleRow: [text("Laporan Penjualan"), text(periodSubtitle), empty(), empty()],
      headerRow: null,
      xlsxHeaders: [],
      widths: [36, 14, 18, 22],
      csvWidth: 4,
      rows: [
        line("Transaksi", summary.transactions, null),
        line("Penjualan", null, summary.total),
        line("Diskon", null, summary.discount),
        line("Laba kotor", null, summary.profit, "total"),
        blankRow(4),
        section("Penjualan per hari"),
        ...byDay.map((row) => line(row.date, row.transactions, row.total)),
        blankRow(4),
        section("Per kasir"),
        ...byCashier.map((row) => line(row.name, row.transactions, row.total)),
        blankRow(4),
        section("Produk terlaris"),
        ...top.map((row) => line(row.name, row.qty, row.total)),
        blankRow(4),
        section("Per kategori"),
        ...byCategory.map((row) => line(row.name, row.qty, row.total)),
        blankRow(4),
        section("Metode pembayaran"),
        ...payments.map(
          (row): ReportRow => ({
            kind: "data",
            cells: [text(row.name), text(paymentMethodTypeLabel(row.type)), money(row.amount), empty()],
          }),
        ),
      ],
    };
  }

  // Bawaan: laba rugi.
  const data = await getIncomeStatement(tx, company.id, range, { excludeClosing: true });
  return {
    sheetName: "Laba Rugi",
    company: companyName,
    title: "Laporan Laba Rugi",
    subtitle: periodSubtitle,
    csvFirstRow: [text(companyName)],
    titleRow: [text("Laporan Laba Rugi"), text(periodSubtitle)],
    headerRow: [text("Kode"), text("Akun"), empty()],
    xlsxHeaders: ["Kode", "Akun", "Jumlah"],
    widths: statementWidths,
    csvWidth: 3,
    rows: [
      ...statementSection("PENDAPATAN", data.revenue, "Total pendapatan", data.totalRevenue, hideZero),
      blankRow(3),
      ...statementSection("HARGA POKOK PENJUALAN", data.cogs, "Total HPP", data.totalCogs, hideZero),
      blankRow(3),
      summaryRow("total", "Laba kotor", data.grossProfit),
      blankRow(3),
      ...statementSection("BEBAN OPERASIONAL", data.operatingExpense, "Total beban operasional", data.totalOperatingExpense, hideZero),
      summaryRow("total", "Laba operasi", data.operatingProfit),
      blankRow(3),
      ...statementSection("PENDAPATAN LAIN-LAIN", data.otherIncome, "Total pendapatan lain-lain", data.totalOtherIncome, hideZero),
      ...statementSection("BEBAN LAIN-LAIN", data.otherExpense, "Total beban lain-lain", data.totalOtherExpense, hideZero),
      blankRow(3),
      summaryRow("grand", "Laba bersih", data.netProfit),
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Buku besar (/api/export/ledger)                                     */
/* ------------------------------------------------------------------ */

export async function buildLedgerExportTable(
  tx: Tx,
  company: { id: string; name: string },
  input: { accountId: string | null; from: string; to: string },
): Promise<{ table: ReportTable; accountCode: string } | null> {
  const accounts = await listAccounts(tx, company.id);
  // A-28 UI-3 (sisa AKT-08): tanpa akun eksplisit, ekspor memakai
  // bawaan yang sama dengan layar/cetak — akun postable beraktivitas
  // pertama pada rentang, bukan akun pertama menurut kode (header).
  const accountId =
    input.accountId ||
    (await resolveDefaultLedgerAccountId(tx, company.id, accounts, { from: input.from, to: input.to }));
  if (!accountId) return null;
  const account = accounts.find((row) => row.id === accountId) ?? null;
  if (!account) return null;
  const ledger = await getLedger(tx, {
    companyId: company.id,
    accountId,
    from: input.from,
    to: input.to,
  });
  const companyName = await companyLine(tx, company.id, company.name);
  const heading = `Buku besar ${account.code} · ${account.name}`;
  const period = `Periode ${input.from} s/d ${input.to}`;
  return {
    accountCode: account.code,
    table: {
      sheetName: "Buku Besar",
      company: companyName,
      title: heading,
      subtitle: period,
      csvFirstRow: [text(heading), text(period), empty(), empty(), empty(), empty()],
      titleRow: null,
      headerRow: null,
      xlsxHeaders: ["Tanggal", "Nomor", "Keterangan", "Debit", "Kredit", "Saldo"],
      widths: [12, 20, 48, 17, 17, 18],
      csvWidth: 6,
      rows: [
        { kind: "total", cells: [text("Saldo awal"), empty(), empty(), empty(), empty(), money(ledger.opening)] },
        ...ledger.items.map(
          (row): ReportRow => ({
            kind: "data",
            cells: [
              text(row.date),
              text(row.number),
              text(row.description ?? ""),
              money(row.debit),
              money(row.credit),
              money(row.balance),
            ],
          }),
        ),
        { kind: "grand", cells: [text("Saldo akhir"), empty(), empty(), empty(), empty(), money(ledger.closing)] },
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Aging piutang/utang (/api/export/aging)                             */
/* ------------------------------------------------------------------ */

function dueLabel(dueDate: string | null, today: string): string {
  const status = dueDateStatus(dueDate, today);
  if (!status) return "";
  if (status.kind === "overdue") return `Terlambat ${status.days} hari`;
  if (status.kind === "today") return "Jatuh tempo hari ini";
  return `${status.days} hari lagi`;
}

export async function buildAgingExportTable(
  tx: Tx,
  company: { id: string; name: string },
  kind: "piutang" | "utang",
): Promise<ReportTable> {
  const today = todayISO();
  const companyName = await companyLine(tx, company.id, company.name);
  const rows =
    kind === "utang"
      ? (await listPayables(tx, company.id)).map((row) => ({
          number: row.number,
          date: String(row.date),
          party: row.supplierName ?? "",
          dueDate: row.dueDate,
          total: row.total,
          paid: row.paidAmount,
          outstanding: row.outstanding,
          status: row.paymentStatus,
          source:
            row.source === "opening"
              ? "Saldo awal"
              : row.source === "expense"
                ? "Beban terutang"
                : "Penerimaan",
        }))
      : (await listReceivables(tx, company.id)).map((row) => ({
          number: row.number,
          date: String(row.date),
          party: row.customerName ?? "",
          dueDate: row.dueDate,
          total: row.total,
          paid: row.paidTotal,
          outstanding: row.outstanding,
          status: row.paymentStatus,
          source: row.source === "opening" ? "Saldo awal" : "Penjualan",
        }));

  const headers = [
    "Nomor",
    "Tanggal",
    kind === "utang" ? "Pemasok" : "Pelanggan",
    "Sumber",
    "Jatuh tempo",
    "Status tempo",
    "Umur (hari)",
    "Kelompok umur",
    "Total",
    "Dibayar",
    "Sisa",
    "Status",
  ];
  return {
    sheetName: kind === "utang" ? "Aging Utang" : "Aging Piutang",
    company: companyName,
    title: kind === "utang" ? "Aging Utang" : "Aging Piutang",
    subtitle: `Per ${today}`,
    csvFirstRow: headers.map((header) => text(header)),
    titleRow: null,
    headerRow: null,
    xlsxHeaders: headers,
    widths: [18, 12, 28, 14, 12, 20, 11, 15, 17, 17, 17, 14],
    csvWidth: 12,
    rows: rows.map((row): ReportRow => {
      const days = ageDays(row.dueDate ?? row.date, today);
      return {
        kind: "data",
        cells: [
          text(row.number),
          text(row.date),
          text(row.party),
          text(row.source),
          text(row.dueDate ?? ""),
          text(dueLabel(row.dueDate, today)),
          num(days),
          text(ageBucketLabel(days)),
          money(Number(row.total)),
          money(Number(row.paid)),
          money(Number(row.outstanding)),
          text(paymentStatusLabel(row.status)),
        ],
      };
    }),
  };
}
