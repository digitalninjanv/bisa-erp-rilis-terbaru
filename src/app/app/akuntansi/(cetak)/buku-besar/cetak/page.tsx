import { notFound } from "next/navigation";
import { withCompanyReadOnly } from "@/db/tenant";
import { getLedger, listAccounts, resolveDefaultLedgerAccountId } from "@/server/reports";
import { getSettings } from "@/server/catalog";
import { requirePermissionPage } from "@/lib/session";
import { accountTypeLabel, formatDate, monthStartISO, normalBalanceLabel, todayISO } from "@/lib/format";
import { toPrintSettings } from "@/components/print/types";
import { documentQrDataUrl } from "@/components/print/qr";
import {
  PrintAmount,
  ReportDocument,
  ReportPrintPageShell,
  type ReportCompanyIdentity,
} from "@/components/akuntansi/report-document";

export const metadata = { title: "Cetak buku besar" };
export const dynamic = "force-dynamic";

// FIX-R2 (RD2-01/08): buku besar sebelumnya dicetak mentah dari
// halaman layar — strip meta Inggris/log internal ("asset · saldo
// normal debit") ikut tercetak. Kini buku besar adalah dokumen
// PrintShell resmi dengan meta akun yang dilabelkan Bahasa Indonesia
// baku dari pemetaan bersama di src/lib/format.ts.

export default async function LedgerPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string; from?: string; to?: string; autoprint?: string }>;
}) {
  const params = await searchParams;
  const ctx = await requirePermissionPage("accounting.view");
  const from = params.from || monthStartISO();
  const to = params.to || todayISO();

  const data = await withCompanyReadOnly(ctx.company.id, async (tx) => {
    const settings = await getSettings(tx, ctx.company.id);
    const accounts = await listAccounts(tx, ctx.company.id);
    /* A-28 UI-3 (sisa AKT-08): bawaan cetak sama dengan layar — akun
       postable beraktivitas pertama, bukan akun pertama menurut kode
       (header 10000). Akun header yang diminta eksplisit pun jatuh ke
       bawaan yang sama. */
    const requested = params.account
      ? accounts.find((row) => row.id === params.account && row.isPostable)
      : undefined;
    const defaultId = requested
      ? requested.id
      : await resolveDefaultLedgerAccountId(tx, ctx.company.id, accounts, { from, to });
    const account = accounts.find((row) => row.id === defaultId);
    if (!account) return { settings, account: null, ledger: null };
    const ledger = await getLedger(tx, {
      companyId: ctx.company.id,
      accountId: account.id,
      from,
      to,
    });
    return { settings, account, ledger };
  });
  if (!data.account || !data.ledger) notFound();

  const printSettings = toPrintSettings(data.settings);
  const company: ReportCompanyIdentity = {
    legalName: data.settings.legalName ?? ctx.company.name,
    address: data.settings.address,
    phone: data.settings.phone,
    taxId: data.settings.taxId,
  };
  const reference = `BB-${data.account.code}-${to}`;
  const qrDataUrl = printSettings.showQr
    ? await documentQrDataUrl(`${company.legalName} | ${reference} | ${ctx.company.id}`).catch(() => null)
    : null;

  const ledger = data.ledger;
  const cell = "num min-w-[110px] py-1.5 text-right whitespace-nowrap";

  return (
    <ReportPrintPageShell
      backHref={`/app/akuntansi/buku-besar?account=${data.account.id}&from=${from}&to=${to}`}
      backLabel="Buku besar"
      eyebrow="Buku besar · Cetak resmi"
      heading="Buku Besar"
      auto={params.autoprint === "1"}
    >
      <ReportDocument
        company={company}
        settings={printSettings}
        title="Buku Besar"
        periodStatement={`${data.account.code} · ${data.account.name} — Periode ${formatDate(from)} — ${formatDate(to)}`}
        reference={reference}
        printedByName={ctx.user.name}
        qrDataUrl={qrDataUrl}
      >
        <p className="text-[11px]">
          {accountTypeLabel(data.account.type)} · Saldo normal {normalBalanceLabel(data.account.normalBalance)}
        </p>
        {/* A-22 K6: pratinjau LAYAR tidak boleh overflow di 390
            (tabel ±489px). Pembungkus hanya berlaku di layar
            (print:overflow-visible) — tipografi & lebar kertas
            tidak berubah sama sekali. */}
        <div className="overflow-x-auto print:overflow-visible">
        <table className="mt-2 w-full text-[12px]">
          <thead className="text-[10px] uppercase tracking-wide opacity-60">
            <tr>
              <th className="py-1.5 text-left font-medium">Tanggal</th>
              <th className="py-1.5 text-left font-medium">Nomor</th>
              <th className="py-1.5 text-left font-medium">Keterangan</th>
              <th className="py-1.5 text-right font-medium">Debit</th>
              <th className="py-1.5 text-right font-medium">Kredit</th>
              <th className="py-1.5 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="py-1.5" colSpan={3}>
                Saldo awal periode
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell}>
                <PrintAmount value={ledger.opening} symbol={false} />
              </td>
            </tr>
            {ledger.items.map((row) => (
              <tr key={row.id} className="report-keep">
                <td className="py-1.5">{formatDate(row.date)}</td>
                <td className="num py-1.5">{row.number}</td>
                <td className="py-1.5">{row.description || "—"}</td>
                <td className={cell}>
                  <PrintAmount value={row.debit} symbol={false} />
                </td>
                <td className={cell}>
                  <PrintAmount value={row.credit} symbol={false} />
                </td>
                <td className={cell}>
                  <PrintAmount value={row.balance} symbol={false} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="rule-total font-medium">
              <td className="py-1.5" colSpan={3}>
                Total mutasi periode
              </td>
              <td className={cell}>
                <PrintAmount value={ledger.totalDebit} />
              </td>
              <td className={cell}>
                <PrintAmount value={ledger.totalCredit} symbol={false} />
              </td>
              <td className={cell} />
            </tr>
            <tr className="rule-final font-semibold">
              <td className="py-1.5" colSpan={3}>
                Saldo akhir periode
              </td>
              <td className={cell} />
              <td className={cell} />
              <td className={cell}>
                <PrintAmount value={ledger.closing} />
              </td>
            </tr>
          </tfoot>
        </table>
        </div>
      </ReportDocument>
    </ReportPrintPageShell>
  );
}
