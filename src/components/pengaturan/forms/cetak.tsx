/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — mesin cetak & pratinjau langsung.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp } from "lucide-react";
import { toast } from "sonner";
import { savePrintSettingsAction, uploadPrintLogoAction } from "@/server/actions/settings/cetak";
import { PrintFooter, PrintHeader, PrintShell } from "@/components/print/print-shell";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";
import { useSettingsSection } from "@/components/blocks/settings-layout";
import {
  PRINT_DOCUMENT_PAPER_LABELS,
  PRINT_FONT_LABELS,
  PRINT_RECEIPT_PAPER_LABELS,
  PRINT_DOCUMENT_TYPES,
  PRINT_SIGNATURE_DOCS,
  applyPrintDocumentOverride,
  PRINT_TEMPLATE_LABELS,
  paperSpec,
  resolveSignatureLabels,
  sanitizePrintDocumentOverrides,
  sanitizePrintSignatureLabels,
  type PrintDocumentPaper,
  type PrintFontChoice,
  type PrintDocumentOverride,
  type PrintDocumentType,
  type PrintSignatureDocType,
  type PrintReceiptPaper,
  type PrintSettings,
  type PrintTemplate,
} from "@/components/print/types";
import { formatIDR } from "@/lib/money";

export type PrintSettingsValues = {
  printTemplate: string;
  printLogoUrl: string;
  printAccentColor: string;
  printFont: string;
  printHeaderText: string;
  printFooterText: string;
  printShowSignature: boolean;
  printShowQr: boolean;
  printReceiptPaper: string;
  printDocumentPaper: string;
  // A-28 UI-2: saklar elemen nota & label tanda tangan per dokumen.
  printShowCashier: boolean;
  printShowTax: boolean;
  printShowCustomer: boolean;
  printShowSession: boolean;
  printShowBranding: boolean;
  printSignatureLabels: Record<string, string[]>;
  printDocumentSettings: Record<string, unknown>;
};

/**
 * Print Engine settings (T4-4, D-13) with a live preview. The preview
 * renders the exact PrintShell/PrintHeader/PrintFooter components used
 * by the real print pages, fed with a sample document, so what is
 * configured here is what gets printed.
 */
export function PrintSettingsForm({
  initial,
  company,
}: {
  initial: PrintSettingsValues;
  company: { legalName: string; address: string; phone: string; taxId?: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  // A-25 U6 (POLA-05): saver seksi SettingsLayout — payload &
  // aksi (savePrintSettingsAction) persis seperti submit lama.
  const baselineRef = useRef(initial);
  // A-28 UI-2 (UX-D02): unggah logo berkas — pola unggah QRIS
  // (berkas dibaca menjadi data URL, divalidasi & disimpan server
  // lewat uploadPrintLogoAction; URL tetap dapat diisi manual).
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [section, setSection] = useState<"global" | "dokumen">("global");
  const [previewDocType, setPreviewDocType] = useState<PrintDocumentType>("penerimaan");

  async function pickLogo(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("Logo harus berupa berkas PNG, JPEG, atau WebP.");
      return;
    }
    if (file.size > 600 * 1024) {
      toast.error("Ukuran logo maksimum 600KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = String(reader.result ?? "");
      if (!dataUrl.startsWith("data:image/")) {
        toast.error("File harus berupa gambar.");
        return;
      }
      setLogoBusy(true);
      const result = await uploadPrintLogoAction({ dataUrl });
      setLogoBusy(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setForm((current) => ({ ...current, printLogoUrl: dataUrl }));
      baselineRef.current = { ...baselineRef.current, printLogoUrl: dataUrl };
      toast.success("Logo diperbarui dan tampil di nota & dokumen.");
      router.refresh();
    };
    reader.readAsDataURL(file);
  }

  const globalPreviewSettings: PrintSettings = {
    template: form.printTemplate as PrintTemplate,
    logoUrl: form.printLogoUrl || null,
    accentColor: /^#[0-9a-fA-F]{6}$/.test(form.printAccentColor) ? form.printAccentColor : "#111827",
    font: form.printFont as PrintFontChoice,
    headerText: form.printHeaderText || null,
    footerText: form.printFooterText || null,
    showSignature: form.printShowSignature,
    showQr: form.printShowQr,
    receiptPaper: form.printReceiptPaper as PrintReceiptPaper,
    documentPaper: form.printDocumentPaper as PrintDocumentPaper,
    showCashier: form.printShowCashier,
    showTax: form.printShowTax,
    showCustomer: form.printShowCustomer,
    showSession: form.printShowSession,
    showBranding: form.printShowBranding,
    signatureLabels: sanitizePrintSignatureLabels(form.printSignatureLabels),
  };
  const previewDoc =
    PRINT_DOCUMENT_TYPES.find((doc) => doc.key === previewDocType) ?? PRINT_DOCUMENT_TYPES[0];
  const previewSettings = applyPrintDocumentOverride(
    globalPreviewSettings,
    sanitizePrintDocumentOverrides(form.printDocumentSettings),
    previewDocType,
  );
  const previewIsReceipt = previewDoc.paper === "receipt";
  const PREVIEW_SIGNATURE_DOC: Partial<Record<PrintDocumentType, PrintSignatureDocType>> = {
    faktur: "faktur",
    pembelian: "pembelian",
    penerimaan: "penerimaan",
    retur_pembelian: "retur_pembelian",
    transfer: "transfer",
    opname: "opname",
    payroll: "payroll",
    jurnal: "jurnal",
  };
  const previewSignatureKey = PREVIEW_SIGNATURE_DOC[previewDocType];
  const previewSignatureLabels = previewSignatureKey
    ? resolveSignatureLabels(
        previewSettings,
        previewSignatureKey,
        PRINT_SIGNATURE_DOCS.find((doc) => doc.key === previewSignatureKey)?.defaults ?? [],
      )
    : ["Dibuat oleh", "Diterima oleh"];

  async function saveAll() {
    const result = await savePrintSettingsAction({
      printTemplate: form.printTemplate as PrintTemplate,
      printLogoUrl: form.printLogoUrl || null,
      printAccentColor: form.printAccentColor,
      printFont: form.printFont as PrintFontChoice,
      printHeaderText: form.printHeaderText || null,
      printFooterText: form.printFooterText || null,
      printShowSignature: form.printShowSignature,
      printShowQr: form.printShowQr,
      printReceiptPaper: form.printReceiptPaper as PrintReceiptPaper,
      printDocumentPaper: form.printDocumentPaper as PrintDocumentPaper,
      printShowCashier: form.printShowCashier,
      printShowTax: form.printShowTax,
      printShowCustomer: form.printShowCustomer,
      printShowSession: form.printShowSession,
      printShowBranding: form.printShowBranding,
      printSignatureLabels: sanitizePrintSignatureLabels(form.printSignatureLabels),
      printDocumentSettings: form.printDocumentSettings,
    });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = form;
    router.refresh();
  }

  const { setDirty } = useSettingsSection("cetak", saveAll);

  function updateDocumentOverride(
    docType: PrintDocumentType,
    patch: PrintDocumentOverride,
  ) {
    setForm((current) => {
      const existing = (current.printDocumentSettings[docType] as PrintDocumentOverride | undefined) ?? {};
      const next: PrintDocumentOverride = { ...existing, ...patch };
      for (const key of Object.keys(next) as (keyof PrintDocumentOverride)[]) {
        if (next[key] === undefined) delete next[key];
      }
      const settings = { ...current.printDocumentSettings };
      if (Object.keys(next).length > 0) settings[docType] = next;
      else delete settings[docType];
      return { ...current, printDocumentSettings: settings };
    });
  }

  useEffect(() => {
    setDirty(JSON.stringify(form) !== JSON.stringify(baselineRef.current));
  }, [form, setDirty]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
        {[
          { key: "global" as const, label: "Global" },
          { key: "dokumen" as const, label: "Per dokumen" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSection(item.key)}
            aria-pressed={section === item.key}
            className={
              section === item.key
                ? "inline-flex h-8 items-center rounded-md bg-card px-3 text-[12px] font-semibold text-foreground shadow-sm"
                : "inline-flex h-8 items-center rounded-md px-3 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            }
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
      <div className={`rounded-lg border border-border bg-card ${section === "global" ? "" : "hidden"}`}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Mesin cetak</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Satu-satunya tempat mengatur cetak: template, kertas, kop/kaki, logo, elemen nota, dan label tanda tangan untuk nota kasir, faktur, bukti penerimaan barang, dan pesanan pembelian.
          </p>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <label className="space-y-1">
            <span className={labelClass}>Template</span>
            <select value={form.printTemplate} onChange={(event) => setForm({ ...form, printTemplate: event.target.value })} className={fieldClass}>
              {(Object.keys(PRINT_TEMPLATE_LABELS) as PrintTemplate[]).map((key) => (
                <option key={key} value={key}>{PRINT_TEMPLATE_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Jenis huruf</span>
            <select value={form.printFont} onChange={(event) => setForm({ ...form, printFont: event.target.value })} className={fieldClass}>
              {(Object.keys(PRINT_FONT_LABELS) as PrintFontChoice[]).map((key) => (
                <option key={key} value={key}>{PRINT_FONT_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Warna aksen</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(form.printAccentColor) ? form.printAccentColor : "#111827"}
                onChange={(event) => setForm({ ...form, printAccentColor: event.target.value })}
                className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-input bg-background p-0.5"
              />
              <input
                value={form.printAccentColor}
                onChange={(event) => setForm({ ...form, printAccentColor: event.target.value })}
                className={`${fieldClass} num`}
                placeholder="#111827"
              />
            </span>
          </label>
          <div className="space-y-1">
            <span className={labelClass}>Logo (tampil di nota & dokumen)</span>
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-white">
                {form.printLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.printLogoUrl} alt="Logo perusahaan" className="max-h-full max-w-full object-contain" />
                ) : (
                  <span className="text-[9px] text-muted-foreground">Nama saja</span>
                )}
              </div>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void pickLogo(file);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoBusy}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[12px] font-medium hover:bg-muted disabled:opacity-50"
              >
                <ImageUp className="size-3.5" /> {logoBusy ? "Mengunggah…" : "Unggah logo"}
              </button>
            </div>
            <input value={form.printLogoUrl.startsWith("data:") ? "" : form.printLogoUrl} onChange={(event) => setForm({ ...form, printLogoUrl: event.target.value })} className={fieldClass} placeholder={form.printLogoUrl.startsWith("data:") ? "Logo dari berkas terunggah (isi URL untuk mengganti)" : "atau URL https://… (kosongkan untuk nama perusahaan)"} />
            <span className="block text-[10px] leading-4 text-muted-foreground">Unggah berkas PNG/JPG/WebP maks. 600KB, atau isi URL gambar. Logo menggantikan nama perusahaan sebagai kepala dokumen.</span>
          </div>
          <label className="space-y-1">
            <span className={labelClass}>Kertas nota kasir</span>
            <select value={form.printReceiptPaper} onChange={(event) => setForm({ ...form, printReceiptPaper: event.target.value })} className={fieldClass}>
              {(Object.keys(PRINT_RECEIPT_PAPER_LABELS) as PrintReceiptPaper[]).map((key) => (
                <option key={key} value={key}>{PRINT_RECEIPT_PAPER_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className={labelClass}>Kertas dokumen (GRN & PO)</span>
            <select value={form.printDocumentPaper} onChange={(event) => setForm({ ...form, printDocumentPaper: event.target.value })} className={fieldClass}>
              {(Object.keys(PRINT_DOCUMENT_PAPER_LABELS) as PrintDocumentPaper[]).map((key) => (
                <option key={key} value={key}>{PRINT_DOCUMENT_PAPER_LABELS[key]}</option>
              ))}
            </select>
          </label>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-5 sm:col-span-2">
            <p className="font-medium text-foreground">Cetak otomatis tanpa dialog</p>
            <p className="mt-0.5 text-muted-foreground">
              Browser biasa selalu menampilkan dialog cetak dan tidak bisa memilih printer sendiri.
              Agar nota langsung tercetak setelah transaksi, pasang printer thermal sebagai
              <strong> printer default</strong> di komputer kasir, lalu buka POS memakai Chrome/Edge
              dengan mode <code className="rounded bg-background px-1">--kiosk-printing</code>.
              Launcher siap pakai ada di folder <code className="rounded bg-background px-1">deploy/print/</code>.
            </p>
          </div>
          <label className="space-y-1 sm:col-span-2">
            <span className={labelClass}>Teks kop (di bawah nama perusahaan)</span>
            <textarea value={form.printHeaderText} onChange={(event) => setForm({ ...form, printHeaderText: event.target.value })} rows={2} className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring" placeholder="Mis. Cabang Pusat — buka setiap hari 07.00–21.00" />
          </label>
          <label className="space-y-1 sm:col-span-2">
            <span className={labelClass}>Teks kaki dokumen</span>
            <textarea value={form.printFooterText} onChange={(event) => setForm({ ...form, printFooterText: event.target.value })} rows={2} className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring" placeholder="Mis. Barang yang sudah dibeli tidak dapat dikembalikan." />
          </label>
          <div className="flex flex-wrap items-end gap-4 pb-1 text-[12px] sm:col-span-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.printShowSignature} onChange={(event) => setForm({ ...form, printShowSignature: event.target.checked })} />
              Blok tanda tangan (dokumen)
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.printShowQr} onChange={(event) => setForm({ ...form, printShowQr: event.target.checked })} />
              QR nomor dokumen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.printShowBranding} onChange={(event) => setForm({ ...form, printShowBranding: event.target.checked })} />
              Baris &ldquo;Dicetak dari Bisa ERP&rdquo;
            </label>
          </div>
          {/* A-28 UI-2 (UX-D01): saklar elemen nota yang dulu tersebar
              di tab "Nota & printer" kini hidup di sini, satu pintu
              dengan mesin cetak — semua benar-benar terbaca halaman
              nota & faktur. */}
          <div className="border-t border-border pt-3 sm:col-span-2">
            <p className={labelClass}>Elemen nota & faktur</p>
            <div className="mt-2 flex flex-wrap gap-4 text-[12px]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.printShowCashier} onChange={(event) => setForm({ ...form, printShowCashier: event.target.checked })} />
                Tampil kasir
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.printShowTax} onChange={(event) => setForm({ ...form, printShowTax: event.target.checked })} />
                Tampil PPN
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.printShowCustomer} onChange={(event) => setForm({ ...form, printShowCustomer: event.target.checked })} />
                Tampil pelanggan
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={form.printShowSession} onChange={(event) => setForm({ ...form, printShowSession: event.target.checked })} />
                Tampil sesi
              </label>
            </div>
          </div>
          {/* A-28 UI-2 (UX-D05): label penanda tangan per jenis
              dokumen — kosongkan untuk memakai label bawaan. */}
          <div className="border-t border-border pt-3 sm:col-span-2">
            <p className={labelClass}>Label tanda tangan per dokumen</p>
            <p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">
              Teks peran di atas garis tanda tangan pada tiap dokumen. Kosong = label bawaan (tertulis sebagai contoh di setiap kotak).
            </p>
            <div className="mt-2 space-y-2.5">
              {PRINT_SIGNATURE_DOCS.map((doc) => (
                <div key={doc.key} className="grid gap-1.5 sm:grid-cols-[130px_minmax(0,1fr)] sm:items-start">
                  <span className="pt-1.5 text-[11px] font-medium text-foreground">{doc.label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.defaults.map((fallback, index) => (
                      <input
                        key={index}
                        value={form.printSignatureLabels[doc.key]?.[index] ?? ""}
                        onChange={(event) => {
                          const next = [...(form.printSignatureLabels[doc.key] ?? [])];
                          next[index] = event.target.value;
                          setForm({
                            ...form,
                            printSignatureLabels: { ...form.printSignatureLabels, [doc.key]: next },
                          });
                        }}
                        className={`${fieldClass} min-w-0 flex-1 basis-32`}
                        placeholder={fallback}
                        maxLength={60}
                        aria-label={`${doc.label} — penanda tangan ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={`rounded-lg border border-border bg-card xl:col-span-2 ${section === "dokumen" ? "" : "hidden"}`}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Template per dokumen</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Override desain di atas pengaturan global. Kosongkan pilihan untuk mengikuti template global.
            Pola ini sama dengan paper format per report di Odoo: default global, override per jenis dokumen.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="data-table min-w-[860px]">
            <thead>
              <tr>
                <th>Dokumen</th>
                <th>Template</th>
                <th>Font</th>
                <th>Kertas</th>
                <th>QR</th>
                <th>TTD</th>
                <th>Merek</th>
              </tr>
            </thead>
            <tbody>
              {PRINT_DOCUMENT_TYPES.map((doc) => {
                const override = (form.printDocumentSettings[doc.key] as PrintDocumentOverride | undefined) ?? {};
                const paperValue = doc.paper === "receipt" ? override.receiptPaper : override.documentPaper;
                return (
                  <tr key={doc.key}>
                    <td className="text-[11px] font-medium">{doc.label}</td>
                    <td>
                      <select
                        value={override.template ?? ""}
                        onChange={(event) =>
                          updateDocumentOverride(doc.key, {
                            template: (event.target.value || undefined) as PrintTemplate | undefined,
                          })
                        }
                        className="h-8 min-w-[120px] rounded-md border border-input bg-background px-1.5 text-[11px]"
                        aria-label={`Template ${doc.label}`}
                      >
                        <option value="">Ikuti global</option>
                        {(Object.keys(PRINT_TEMPLATE_LABELS) as PrintTemplate[]).map((key) => (
                          <option key={key} value={key}>{PRINT_TEMPLATE_LABELS[key]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={override.font ?? ""}
                        onChange={(event) =>
                          updateDocumentOverride(doc.key, {
                            font: (event.target.value || undefined) as PrintFontChoice | undefined,
                          })
                        }
                        className="h-8 min-w-[110px] rounded-md border border-input bg-background px-1.5 text-[11px]"
                        aria-label={`Font ${doc.label}`}
                      >
                        <option value="">Ikuti global</option>
                        {(Object.keys(PRINT_FONT_LABELS) as PrintFontChoice[]).map((key) => (
                          <option key={key} value={key}>{PRINT_FONT_LABELS[key]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        value={paperValue ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (doc.paper === "receipt") {
                            updateDocumentOverride(doc.key, {
                              receiptPaper: (value || undefined) as PrintReceiptPaper | undefined,
                            });
                          } else {
                            updateDocumentOverride(doc.key, {
                              documentPaper: (value || undefined) as PrintDocumentPaper | undefined,
                            });
                          }
                        }}
                        className="h-8 min-w-[130px] rounded-md border border-input bg-background px-1.5 text-[11px]"
                        aria-label={`Kertas ${doc.label}`}
                      >
                        <option value="">Ikuti global</option>
                        {doc.paper === "receipt"
                          ? (Object.keys(PRINT_RECEIPT_PAPER_LABELS) as PrintReceiptPaper[]).map((key) => (
                              <option key={key} value={key}>{PRINT_RECEIPT_PAPER_LABELS[key]}</option>
                            ))
                          : (Object.keys(PRINT_DOCUMENT_PAPER_LABELS) as PrintDocumentPaper[]).map((key) => (
                              <option key={key} value={key}>{PRINT_DOCUMENT_PAPER_LABELS[key]}</option>
                            ))}
                      </select>
                    </td>
                    {([
                      ["showQr", "QR"],
                      ["showSignature", "TTD"],
                      ["showBranding", "Merek"],
                    ] as const).map(([key, label]) => (
                      <td key={key}>
                        <select
                          value={override[key] === undefined ? "" : override[key] ? "1" : "0"}
                          onChange={(event) =>
                            updateDocumentOverride(doc.key, {
                              [key]:
                                event.target.value === "" ? undefined : event.target.value === "1",
                            })
                          }
                          className="h-8 rounded-md border border-input bg-background px-1.5 text-[11px]"
                          aria-label={`${label} ${doc.label}`}
                        >
                          <option value="">Global</option>
                          <option value="1">Tampil</option>
                          <option value="0">Sembunyi</option>
                        </select>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className={`rounded-lg border border-border bg-card ${section === "global" ? "" : "hidden"}`}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[13px] font-semibold">Pratinjau langsung</h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Contoh dokumen dengan kerangka cetak yang sama seperti aslinya.</p>
        </div>
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold">Pratinjau: {previewDoc.label}</p>
              <p className="text-[11px] text-muted-foreground">
                {PRINT_TEMPLATE_LABELS[previewSettings.template]} ·{" "}
                {previewIsReceipt
                  ? PRINT_RECEIPT_PAPER_LABELS[previewSettings.receiptPaper]
                  : PRINT_DOCUMENT_PAPER_LABELS[previewSettings.documentPaper]}{" "}
                · {PRINT_FONT_LABELS[previewSettings.font]}
              </p>
            </div>
            <label className="space-y-1">
              <span className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Dokumen contoh
              </span>
              <select
                value={previewDocType}
                onChange={(event) => setPreviewDocType(event.target.value as PrintDocumentType)}
                className="h-8 min-w-[220px] rounded-md border border-input bg-background px-2 text-[11px]"
              >
                {PRINT_DOCUMENT_TYPES.map((doc) => (
                  <option key={doc.key} value={doc.key}>{doc.label}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex justify-center overflow-x-auto">
            {previewIsReceipt ? (
              <div className="w-fit bg-white p-3 text-black shadow-sm ring-1 ring-border">
                <PrintShell settings={previewSettings} paper={previewSettings.receiptPaper} pageStyle={false}>
                  <div className="receipt" style={{ fontSize: 11, lineHeight: 1.35 }}>
                    <PrintHeader
                      settings={previewSettings}
                      companyName={company.legalName}
                      address={company.address || null}
                      phone={company.phone || null}
                      taxId={company.taxId || null}
                      variant="receipt"
                    />
                    <div className="flex justify-between">
                      <span>No.</span>
                      <span className="num">INV-CONTOH-001</span>
                    </div>
                    {previewSettings.showCashier ? (
                      <div className="flex justify-between">
                        <span>Kasir</span>
                        <span>Kasir contoh</span>
                      </div>
                    ) : null}
                    {previewSettings.showSession ? (
                      <div className="flex justify-between">
                        <span>Sesi</span>
                        <span className="num">01a1b3ba</span>
                      </div>
                    ) : null}
                    {previewSettings.showCustomer ? (
                      <div className="flex justify-between">
                        <span>Pelanggan</span>
                        <span>Pelanggan contoh</span>
                      </div>
                    ) : null}
                    <div className="my-2 border-t border-dashed border-black/50" />
                    <div className="flex justify-between">
                      <span>Contoh Produk A ×2</span>
                      <span className="num">{formatIDR(15000)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Contoh Produk B ×1</span>
                      <span className="num">{formatIDR(12000)}</span>
                    </div>
                    <div className="print-total-bar mt-1 flex justify-between border-t border-black/50 pt-1 text-[13px] font-bold">
                      <span>TOTAL</span>
                      <span className="num">{formatIDR(27000)}</span>
                    </div>
                    <PrintFooter
                      settings={previewSettings}
                      documentNumber="INV-CONTOH-001"
                      variant="receipt"
                      qrSizeMm={paperSpec(previewSettings.receiptPaper).qrMm}
                    />
                  </div>
                </PrintShell>
              </div>
            ) : (
              <div className="w-fit bg-white p-4 text-black shadow-sm ring-1 ring-border">
                <PrintShell settings={previewSettings} paper={previewSettings.documentPaper} pageStyle={false}>
                  <PrintHeader
                    settings={previewSettings}
                    companyName={company.legalName}
                    address={company.address || null}
                    phone={company.phone || null}
                    taxId={company.taxId || null}
                    variant="document"
                    title={previewDoc.label}
                    number="DOK-CONTOH-001"
                    dateLabel="12 November 2026"
                  />
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px]">
                    <div>
                      <p className="text-black/60">Pihak / Tujuan</p>
                      <p className="font-medium">Contoh Pihak</p>
                    </div>
                    <div>
                      <p className="text-black/60">Referensi</p>
                      <p className="num font-medium">REF-CONTOH-001</p>
                    </div>
                  </div>
                  <table className="mt-3 w-full text-[12px]">
                    <thead>
                      <tr className="border-y border-black/60 text-left">
                        <th className="py-1.5 pr-2 font-semibold">Produk</th>
                        <th className="py-1.5 pr-2 text-right font-semibold">Qty</th>
                        <th className="py-1.5 text-right font-semibold">Jumlah</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-black/15">
                        <td className="py-1.5 pr-2">Contoh Produk A</td>
                        <td className="num py-1.5 pr-2 text-right">2</td>
                        <td className="num py-1.5 text-right">{formatIDR(15000)}</td>
                      </tr>
                      <tr className="border-b border-black/15">
                        <td className="py-1.5 pr-2">Contoh Produk B</td>
                        <td className="num py-1.5 pr-2 text-right">1</td>
                        <td className="num py-1.5 text-right">{formatIDR(12000)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div className="print-total-bar mt-1 flex justify-between border-t border-black/50 pt-1 text-[13px] font-bold">
                    <span>TOTAL</span>
                    <span className="num">{formatIDR(27000)}</span>
                  </div>
                  <PrintFooter
                    settings={previewSettings}
                    documentNumber="DOK-CONTOH-001"
                    variant="document"
                    qrSizeMm={paperSpec(previewSettings.documentPaper).qrMm}
                    signatures={previewSignatureLabels.map((label, index) => ({
                      label,
                      name: ["Kasir contoh", "Contoh Pihak", "Mengetahui"][index],
                    }))}
                  />
                </PrintShell>
              </div>
            )}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
