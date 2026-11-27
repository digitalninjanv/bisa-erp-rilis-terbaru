import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { withCompany } from "@/db/tenant";
import { saleReturns } from "@/db/schema";
import { getSaleDetail } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { verifyReceiptPrintToken } from "@/server/pos";
import { requirePermissionPage } from "@/lib/session";
import { can } from "@/lib/permissions";
import { invoiceHref } from "@/lib/pos/receipt-links";
import { writeAudit } from "@/server/audit";
import { formatIDR, formatQty } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReceiptPrint } from "@/components/pos/receipt-print";
import { StatusBadge } from "@/components/blocks/status-badge";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  PRINT_RECEIPT_PAPER_LABELS,
  PRINT_TEMPLATE_LABELS,
  paperSpec,
  printFontFamily,
  toPrintSettings,
  type PrintReceiptPaper,
  type PrintTemplate,
} from "@/components/print/types";

export const metadata = { title: "Nota" };
export const dynamic = "force-dynamic";

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    autoprint?: string;
    salinan?: string;
    popup?: string;
    thermal?: string;
    printToken?: string;
  }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  // A-28 Tahap 1 (H-POS-04): cetak ULANG dari riwayat/dashboard
  // membawa parameter salinan=1 dan halaman mencetak pita "SALINAN"
  // yang jelas; cetakan pertama dari terminal (autoprint tanpa
  // salinan) tidak bertanda dan tidak berubah.
  const isCopy = query.salinan === "1";
  const ctx = await requirePermissionPage("pos.sell");
  const canReprint = can(ctx, "pos.receipt.reprint");
  if (isCopy && !canReprint) notFound();

  const data = await withCompany(ctx.company.id, async (tx) => {
    const detail = await getSaleDetail(tx, ctx.company.id, id);
    if (!detail) return null;
    // Token hanya membuktikan cetak pertama dari checkout yang baru saja
    // selesai. Tanpa token, halaman ini adalah cetak ulang historis dan
    // tunduk pada izin + audit.
    const fresh = await verifyReceiptPrintToken(tx, {
      companyId: ctx.company.id,
      userId: ctx.user.id,
      saleId: id,
      token: query.printToken,
    });
    const canPrint = canReprint || fresh;
    const isHistorical = !fresh;
    if ((isCopy || isHistorical) && canPrint) {
      await writeAudit(tx, {
        companyId: ctx.company.id,
        userId: ctx.user.id,
        action: "pos.receipt.reprint",
        entityType: "sale",
        entityId: id,
        after: {
          number: detail.sale.number,
          autoprint: query.autoprint === "1",
          transport: "web",
        },
      });
    }
    const settings = await getSettings(tx, ctx.company.id);
    const returns = await tx
      .select({ id: saleReturns.id, number: saleReturns.number, total: saleReturns.total })
      .from(saleReturns)
      .where(and(eq(saleReturns.companyId, ctx.company.id), eq(saleReturns.saleId, id)));
    return { ...detail, settings, returns, fresh, canPrint, isHistorical };
  });

  if (!data) notFound();
  if (!data.canPrint) {
    // Tampilan detail tanpa DOM nota yang dapat dicetak. Kasir tetap bisa
    // membaca status/ringkasan; cetak ulang memerlukan izin supervisor.
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-[13px] text-muted-foreground">Nota penjualan</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="num text-[20px] font-semibold">{data.sale.number}</h1>
            <StatusBadge status={data.sale.status} />
          </div>
          <dl className="mt-4 space-y-1.5 text-[12px]">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Tanggal</dt>
              <dd>{formatDateTime(data.sale.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Pelanggan</dt>
              <dd>{data.customer?.name ?? "Umum"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Total</dt>
              <dd className="num font-semibold">{formatIDR(data.sale.total)}</dd>
            </div>
          </dl>
          <p className="mt-4 rounded-md bg-tone-amber-soft px-3 py-2 text-[12px] leading-5 text-tone-amber">
            Cetak ulang nota historis memerlukan izin <strong>Cetak ulang nota</strong>.
            Hubungi supervisor bila pelanggan membutuhkan salinan.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/app/pos/riwayat"
              className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-9"
            >
              Riwayat transaksi
            </Link>
            <Link
              href="/app/pos"
              className="inline-flex h-11 items-center rounded-md bg-primary px-3 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 lg:h-9"
            >
              Kasir
            </Link>
          </div>
        </div>
      </div>
    );
  }
  const { sale, lines, payments, settings, customer, cashier, branch } = data;
  const totalItemQty = lines.reduce((sum, line) => sum + Number(line.qty), 0);
  // Print Engine (T4-4, D-13): paper/template come from the shared print
  // settings; the legacy receipt width column no longer drives layout.
  const printSettings = toPrintSettings(settings, "nota");
  if (query.thermal === "58" || query.thermal === "80") {
    printSettings.receiptPaper = query.thermal === "58" ? "thermal58" : "thermal80";
  }
  const qrDataUrl = printSettings.showQr ? await documentQrDataUrl(sale.number) : null;
  // CT-17: on sheet paper (A4/A5) the receipt stays a receipt — its
  // content is capped at 80mm and centered inside the wide shell
  // instead of stretching label/value rows across the whole page.
  const onSheetPaper = printSettings.receiptPaper === "a4" || printSettings.receiptPaper === "a5";
  // CT-26: the narrow 58mm roll gets a denser receipt body.
  const onNarrowRoll = printSettings.receiptPaper === "thermal58";

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          {/* A-25 U8: label mikro 10px uppercase dihapus mengikuti
              bahasa desain tema — konteks cukup dari nomor nota &
              lencana status; judul memakai skala judul halaman 20px. */}
          <p className="text-[13px] text-muted-foreground">Nota penjualan</p>
          <div className="mt-1 flex items-center gap-2">
            <h1 className="num text-[20px] font-semibold leading-tight tracking-tight">{sale.number}</h1>
            <StatusBadge status={sale.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* A-28 UI-2 (UX-D03): faktur penjualan format dokumen —
              dokumen A4/A5 untuk pelanggan bisnis, dari data
              penjualan yang sama persis dengan struk ini. */}
          <Link
            href={invoiceHref(sale.id, { copy: isCopy, printToken: query.printToken })}
            className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-8"
          >
            Faktur
          </Link>
          <Link
            href="/app/pos/riwayat"
            className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-8"
          >
            Riwayat
          </Link>
          <Link
            href="/app/pos"
            className="inline-flex h-11 items-center rounded-md border border-border bg-card px-3 text-[12px] hover:bg-muted lg:h-8"
          >
            Kasir
          </Link>
          <ReceiptPrint
            auto={query.autoprint === "1"}
            closeAfterPrint={query.popup === "1"}
            // Hanya alur checkout (tanpa salinan) yang kembali ke kasir.
            // Cetak ulang dari riwayat membiarkan tab nota tetap terbuka.
            returnTo={
              query.autoprint === "1" && data.fresh ? "/app/pos" : undefined
            }
          />
        </div>
      </div>

      <div className="print-area mx-auto w-fit rounded-lg border border-border bg-white p-4 shadow-sm">
        <PrintShell settings={printSettings} paper={printSettings.receiptPaper} pageNumbers={false}>
        <div
          className="receipt"
          style={{
            fontFamily: printFontFamily(printSettings.font),
            ...(onSheetPaper ? { maxWidth: "80mm", marginInline: "auto" } : {}),
            ...(onNarrowRoll ? { fontSize: 10, lineHeight: 1.3 } : {}),
          }}
        >
          <PrintHeader
            settings={{
              ...printSettings,
              // CT-04: the receipt head is the print header text only.
              // A-28 UI-2 (UX-D01): kolom warisan receipt_header sudah
              // dihapus (migrasi 0059) — teks kop mesin cetak adalah
              // satu-satunya sumber teks kepala nota.
              headerText: printSettings.headerText,
            }}
            companyName={settings?.legalName ?? "Bisa Minimarket"}
            branchName={branch?.name}
            address={branch?.address ?? settings?.address}
            phone={branch?.phone ?? settings?.phone}
            variant="receipt"
          />

          {isCopy ? (
            <p className="mb-1 border-y-2 border-double border-black py-1 text-center text-[13px] font-bold uppercase tracking-widest">
              Salinan — bukan nota asli
            </p>
          ) : null}
          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>No.</span>
              <span className="num">{sale.number}</span>
            </div>
            <div className="flex justify-between">
              <span>Tanggal</span>
              <span>{formatDateTime(sale.createdAt)}</span>
            </div>
            {/* A-28 UI-2 (UX-D01): saklar kasir kini dari mesin cetak
                (print_show_cashier, migrasi dari saklar warisan). */}
            {printSettings.showCashier ? (
              <div className="flex justify-between">
                <span>Kasir</span>
                <span>{cashier?.name ?? "—"}</span>
              </div>
            ) : null}
            {/* A-28 Tahap 1 (H-POS-05): identitas sesi kas pada struk
                (8 karakter awal id sesi — konvensi yang sama dengan
                deskripsi jurnal sesi di pos/sessions). Model data
                tidak memiliki entitas terminal terpisah; nomor sesi
                adalah identitas terminal yang tersedia. UI-2: tampil
                sesi kini saklar mesin cetak juga. */}
            {printSettings.showSession && sale.sessionId ? (
              <div className="flex justify-between">
                <span>Sesi</span>
                <span className="num">{sale.sessionId.slice(0, 8)}</span>
              </div>
            ) : null}
            {/* FIX-POS Tahap 4 (POS2-14): identitas pajak penjual pada
                struk bila NPWP perusahaan terisi. Diletakkan sebagai
                baris info nota — PrintHeader varian receipt memang
                tidak membawa NPWP (keputusan FIX-R2 untuk kop). */}
            {settings?.taxId ? (
              <div className="flex justify-between">
                <span>NPWP</span>
                <span className="num">{settings.taxId}</span>
              </div>
            ) : null}
            {printSettings.showCustomer && customer ? (
              <div className="flex justify-between">
                <span>Pelanggan</span>
                <span>{customer.name}</span>
              </div>
            ) : null}
            {/* POS-1 (D-19): penjualan utang mencetak jatuh temponya —
                pelanggan menagih dari nota ini. */}
            {sale.dueDate ? (
              <div className="flex justify-between">
                <span>Jatuh tempo</span>
                <span>{formatDate(sale.dueDate)}</span>
              </div>
            ) : null}
          </div>

          <div className="my-2 border-t border-dashed border-black/50" />

          <table className="w-full">
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="py-1 pr-1">
                    <p className="font-medium">{line.productName}</p>
                    {line.productSku ? (
                      <p className="num text-[10px] leading-tight text-black/70">{line.productSku}</p>
                    ) : null}
                    <p className="num">
                      {/* CT-26: price phrases never break mid-phrase;
                          wrapping may only happen between segments.
                          S4: baris berkemasan mencetak BENTUK MASUKAN
                          ("1 Dus × Rp145.000") dengan padanan satuan
                          dasarnya — bukan 40 × harga per pcs. */}
                      {line.packagingId ? (
                        <>
                          <span className="whitespace-nowrap">
                            {formatQty(line.qtyInput)} {line.packagingName} ×{" "}
                            {formatIDR(Number(line.unitPrice) * Number(line.isiSnapshot))}
                          </span>
                          <span className="whitespace-nowrap"> (= {formatQty(line.qty)} Pcs)</span>
                        </>
                      ) : (
                        <span className="whitespace-nowrap">
                          {formatQty(line.qty)} × {formatIDR(line.unitPrice)}
                        </span>
                      )}
                      {Number(line.discountAmount) > 0 ? (
                        <span className="whitespace-nowrap"> − {formatIDR(line.discountAmount)}</span>
                      ) : null}
                    </p>
                  </td>
                  <td className="num py-1 text-right whitespace-nowrap">
                    {/* lineTotal sudah termasuk pajak (POS-RCPT-01) */}
                    {formatIDR(Number(line.lineTotal))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="my-2 border-t border-dashed border-black/50" />

          <div className="space-y-0.5">
            <div className="flex justify-between">
              <span>Jumlah item</span>
              <span className="num">
                {formatQty(totalItemQty)} ({lines.length} jenis)
              </span>
            </div>
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span className="num">{formatIDR(sale.subtotal)}</span>
            </div>
            {Number(sale.discountTotal) > 0 ? (
              <div className="flex justify-between">
                <span>Diskon</span>
                <span className="num">−{formatIDR(sale.discountTotal)}</span>
              </div>
            ) : null}
            {printSettings.showTax && Number(sale.taxTotal) > 0 ? (
              <div className="flex justify-between">
                <span>termasuk PPN</span>
                <span className="num">{formatIDR(sale.taxTotal)}</span>
              </div>
            ) : null}
            {Number(sale.roundingAdjustment) !== 0 ? (
              <div className="flex justify-between">
                <span>Pembulatan</span>
                <span className="num">
                  {Number(sale.roundingAdjustment) > 0 ? "+" : "−"}
                  {formatIDR(Math.abs(Number(sale.roundingAdjustment)))}
                </span>
              </div>
            ) : null}
            <div className="print-total-bar mt-1 flex justify-between border-t-2 border-black pt-1.5 text-[15px] font-bold">
              <span>TOTAL</span>
              <span className="num">{formatIDR(sale.total)}</span>
            </div>
            {/* FIX-POS Tahap 4 (POS2-14): bukti bayar lengkap —
                getSaleDetail memang sudah mengambil tendered &
                reference per pembayaran; kini keduanya tercetak:
                "Diterima" untuk tunai yang diserahkan melebihi
                tagihan, dan referensi untuk pembayaran non-tunai. */}
            <p className="mt-1.5 text-center text-[10px] font-semibold uppercase tracking-wide">Pembayaran</p>
            {payments.map((payment) => (
              <div key={payment.id}>
                <div className="flex justify-between">
                  <span>{payment.methodName ?? "Pembayaran"}</span>
                  <span className="num">{formatIDR(payment.amount)}</span>
                </div>
                {payment.methodType === "cash" &&
                Number(payment.tendered) > Number(payment.amount) ? (
                  <div className="flex justify-between">
                    <span>Diterima</span>
                    <span className="num">{formatIDR(payment.tendered)}</span>
                  </div>
                ) : null}
                {payment.reference ? (
                  <div className="flex justify-between gap-2">
                    <span>Ref.</span>
                    <span className="num break-all text-right">{payment.reference}</span>
                  </div>
                ) : null}
              </div>
            ))}
            {Number(sale.changeTotal) > 0 ? (
              <div className="flex justify-between">
                <span>Kembalian</span>
                <span className="num">{formatIDR(sale.changeTotal)}</span>
              </div>
            ) : null}
            {Number(sale.paidTotal) < Number(sale.total) ? (
              <div className="flex justify-between">
                <span>Sisa utang</span>
                <span className="num">{formatIDR(Number(sale.total) - Number(sale.paidTotal))}</span>
              </div>
            ) : null}
            <div className="flex justify-between font-semibold">
              <span>Status</span>
              <span>{Number(sale.paidTotal) < Number(sale.total) ? "BELUM LUNAS" : "LUNAS"}</span>
            </div>
          </div>

          {sale.voidReason ? (
            <p className="mt-2 border-y-2 border-double border-black py-1 text-center font-bold uppercase tracking-wider">
              VOID — {sale.voidReason}
            </p>
          ) : sale.status === "returned" ? (
            <p className="mt-2 border-y-2 border-double border-black py-1 text-center font-bold uppercase tracking-wider">
              Nota retur — transaksi telah diretur
            </p>
          ) : null}
          <PrintFooter
            settings={printSettings}
            documentNumber={sale.number}
            variant="receipt"
            qrDataUrl={qrDataUrl}
            qrSizeMm={paperSpec(printSettings.receiptPaper).qrMm}
            footerText={
              printSettings.footerText ??
              "Terima kasih telah berbelanja\nBarang yang sudah dibeli tidak dapat ditukar tanpa nota."
            }
          />
        </div>
        </PrintShell>
      </div>

      {/* FIX-POS Tahap 4 (POS2-26 sebagian): daftar retur terkait
          memang sudah diambil server tetapi tidak pernah dirender —
          kasir kini melihat dari nota apakah transaksi pernah
          diretur. Hanya layar, tidak ikut tercetak pada struk. */}
      {data.returns.length > 0 ? (
        <div className="no-print mt-4 rounded-lg border border-tone-amber/50 bg-tone-amber-soft/50 px-4 py-3 text-[12px] text-tone-amber">
          <p className="font-medium">Nota ini memiliki {data.returns.length} retur terkait</p>
          <p className="num mt-0.5">
            {data.returns.map((ret) => `${ret.number} (${formatIDR(ret.total)})`).join(" · ")}
          </p>
        </div>
      ) : null}

      <div className="no-print mt-4 rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
        <p className="font-medium text-foreground">Kustomisasi nota</p>
        <p className="mt-0.5">
          Template {PRINT_TEMPLATE_LABELS[printSettings.template as PrintTemplate]} · Kertas{" "}
          {PRINT_RECEIPT_PAPER_LABELS[printSettings.receiptPaper as PrintReceiptPaper]} · Template, kertas,
          kop, kaki, logo &amp; elemen nota diatur satu pintu di{" "}
          <Link href="/app/pengaturan?tab=cetak" className="whitespace-nowrap underline">Pengaturan → Cetak</Link>.
        </p>
      </div>
    </div>
  );
}
