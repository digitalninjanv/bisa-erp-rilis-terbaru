/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — identitas perusahaan, pajak, termin & ambang, alur kerja, dan nota.
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveSettingsAction } from "@/server/actions/settings/identitas-pajak";
import { MoneyInput } from "@/components/money-input";
import { PercentInput } from "@/components/percent-input";
import { fieldClass, labelClass } from "@/components/blocks/field-classes";
import { SettingsSection, useSettingsSection } from "@/components/blocks/settings-layout";

type WarehouseOption = { id: string; name: string };

export type SettingsValues = {
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  roundingMode: string;
  // A-28 UI-2 (UX-D01): field nota warisan dihapus dari tipe ini —
  // nota diatur satu pintu di formulir Cetak (mesin cetak).
  qrisImage: string | null;
  allowNegativeStock: boolean;
  taxRate: string;
  // SIM-2 S2: saklar PPN per perusahaan (opsional agar pemanggil lama
  // yang belum mengisi field ini tetap terkompilasi; bawaan dari
  // keadaan migrasi adalah taxRate > 0).
  taxEnabled?: boolean;
  // A-21 Tahap R3-A (R3-06): saklar potongan pajak pembayaran keluar.
  withholdingEnabled?: boolean;
  // A-21 Tahap R3-A (R3-07): ambang maksimum write-off (Rp); "" / "0"
  // = fitur mati. Opsional agar pemanggil lama tetap terkompilasi.
  writeoffMaxAmount?: string;
  // A-28 Tahap 1 (H-POS-02): toleransi selisih kas tutup sesi POS (Rp);
  // "" / "0" = semua selisih wajib alasan. Opsional agar pemanggil
  // lama tetap terkompilasi.
  posSessionDifferenceTolerance?: string;
  posDiscountThresholdPercent: string;
  // FIX-P1 Tahap 5 (AK3-07): termin bawaan (hari) — opsional agar
  // pemanggil lama tetap terkompilasi; bawaan skema 30 / 7.
  payableDefaultTermDays?: number;
  receivableDefaultTermDays?: number;
  // FIX-GDG Tahap 2 (GDG1-09): kedaluwarsa bawaan reservasi (hari);
  // opsional dengan alasan yang sama; bawaan skema 7.
  reservationDefaultExpiryDays?: number;
  // A-28 Tahap 2 (H-GDG-02): jendela peringatan mendekati kedaluwarsa
  // batch (hari) di beranda Gudang; opsional; bawaan skema 30.
  expiryWarningDays?: number;
  // FIX-R2 Tahap 3 (RV2-01): kebijakan saldo kas/bank negatif; opsional
  // dengan alasan yang sama; bawaan skema "warn".
  cashNegativePolicy?: "allow" | "warn" | "block";
  // T5-3 (D-17): "" = approval for stock adjustments disabled.
  adjustmentApprovalThreshold: string;
  // SIM-2 S7B-2 (D-25): saklar fitur & ambang PR per perusahaan.
  posOfflineEnabled?: boolean;
  transferTwoStepEnabled?: boolean;
  prApprovalThreshold?: string;
  reportNotes: string;
  defaultWarehouseId: string | null;
};

export function SettingsForm({
  settings,
  warehouses,
}: {
  settings: SettingsValues;
  warehouses: WarehouseOption[];
}) {
  const router = useRouter();
  const [form, setForm] = useState(settings);
  // A-25 U6 (POLA-05): form ini tidak lagi punya tombol simpannya
  // sendiri — ia mendaftar sebagai seksi SettingsLayout dan bilah
  // simpan halaman yang menjalankan saver ini. Payload & aksi server
  // yang dipanggil PERSIS seperti submit lama; baseline digeser
  // sesudah simpan berhasil agar indikator kotor padam.
  const baselineRef = useRef(settings);

  async function saveAll() {
    const result = await saveSettingsAction({
      legalName: form.legalName,
      taxId: form.taxId || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      roundingMode: form.roundingMode as
        | "none"
        | "nearest_100"
        | "nearest_500"
        | "nearest_1000"
        | "up_500"
        | "up_1000",
      qrisImage: form.qrisImage || null,
      allowNegativeStock: form.allowNegativeStock,
      taxRate: form.taxRate || "0",
      taxEnabled: form.taxEnabled ?? Number(form.taxRate || 0) > 0,
      withholdingEnabled: form.withholdingEnabled ?? false,
      writeoffMaxAmount: form.writeoffMaxAmount || "0",
      payableDefaultTermDays: form.payableDefaultTermDays ?? 30,
      receivableDefaultTermDays: form.receivableDefaultTermDays ?? 7,
      reservationDefaultExpiryDays: form.reservationDefaultExpiryDays ?? 7,
      expiryWarningDays: form.expiryWarningDays ?? 30,
      cashNegativePolicy: form.cashNegativePolicy ?? "warn",
      posSessionDifferenceTolerance: form.posSessionDifferenceTolerance || "0",
      posDiscountThresholdPercent: form.posDiscountThresholdPercent || "10",
      adjustmentApprovalThreshold: form.adjustmentApprovalThreshold || null,
      posOfflineEnabled: form.posOfflineEnabled ?? false,
      transferTwoStepEnabled: form.transferTwoStepEnabled ?? false,
      prApprovalThreshold: form.prApprovalThreshold || null,
      reportNotes: form.reportNotes || undefined,
      defaultWarehouseId: form.defaultWarehouseId || null,
    });
    if (!result.ok) {
      toast.error(result.message);
      throw new Error(result.message);
    }
    baselineRef.current = form;
    router.refresh();
  }

  const { setDirty } = useSettingsSection("umum", saveAll);

  useEffect(() => {
    setDirty(JSON.stringify(form) !== JSON.stringify(baselineRef.current));
  }, [form, setDirty]);

  return (
    <div>
      {/* A-25 U6 (PNG-02): satu kartu raksasa ±20 field dipecah per
          topik — identitas, pajak, termin & ambang, alur kerja —
          masing-masing kartu seksinya sendiri di dalam SettingsLayout. */}
      <SettingsSection id="identitas" title="Identitas perusahaan" description="Nama legal, kontak, dan gudang bawaan perusahaan.">
        <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Nama legal</span>
          <input value={form.legalName} onChange={(event) => setForm({ ...form, legalName: event.target.value })} className={fieldClass} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>NPWP / tax ID</span>
          <input value={form.taxId} onChange={(event) => setForm({ ...form, taxId: event.target.value })} className={fieldClass} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Telepon</span>
          <input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={fieldClass} />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={labelClass}>Alamat</span>
          <input value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} className={fieldClass} />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Gudang default</span>
          <select value={form.defaultWarehouseId ?? ""} onChange={(event) => setForm({ ...form, defaultWarehouseId: event.target.value || null })} className={fieldClass}>
            <option value="">Ikuti gudang utama</option>
            {warehouses.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={labelClass}>Catatan atas laporan keuangan</span>
          <textarea
            value={form.reportNotes}
            onChange={(event) => setForm({ ...form, reportNotes: event.target.value })}
            rows={4}
            className="w-full rounded-md border border-input bg-background px-2.5 py-2 text-[12px] outline-none focus:border-ring"
            placeholder="Kebijakan akuntansi, dasar penyusunan, dan catatan penting lainnya."
          />
        </label>
        </div>
      </SettingsSection>
      <SettingsSection id="pajak" title="Pajak & potongan" description="PPN penjualan dan potongan PPh pada pembayaran utang.">
        <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Tarif pajak (%)</span>
          {/* A-25 U6: tarif persen memakai PercentInput bersama —
              nilai kanonis tetap string desimal yang sama ("11.0000"),
              tampilan menjadi "11%" alih-alih angka mentah. */}
          <PercentInput value={form.taxRate} onChange={(value) => setForm({ ...form, taxRate: value })} className="h-9 text-[12px]" />
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-[12px]">
          <input
            type="checkbox"
            checked={form.taxEnabled ?? Number(form.taxRate || 0) > 0}
            onChange={(event) => setForm({ ...form, taxEnabled: event.target.checked })}
          />
          PPN aktif (POS & Catat Transaksi)
        </label>
        <label className="flex items-center gap-2 self-end pb-1 text-[12px]">
          <input
            type="checkbox"
            checked={form.withholdingEnabled ?? false}
            onChange={(event) => setForm({ ...form, withholdingEnabled: event.target.checked })}
          />
          Potongan pajak (PPh) pada pembayaran utang aktif
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Ambang maksimum write-off sisa (Rp)</span>
          <MoneyInput
            value={form.writeoffMaxAmount ?? ""}
            onChange={(value) => setForm({ ...form, writeoffMaxAmount: value })}
            className="h-9 px-2.5 text-[12px]"
            placeholder="0"
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Sisa piutang/utang sampai nominal ini boleh ditutup sebagai write-off dari halaman Piutang &amp; utang (wajib alasan, butuh izin Akuntansi: COA &amp; pengaturan). 0 = fitur mati.
          </span>
        </label>
        </div>
      </SettingsSection>
      <SettingsSection id="termin-ambang" title="Termin, ambang & kebijakan kas" description="Jatuh tempo bawaan, kebijakan saldo, pembulatan kasir, dan ambang persetujuan.">
        <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Termin bawaan utang pembelian (hari)</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={form.payableDefaultTermDays ?? 30}
            onChange={(event) => setForm({ ...form, payableDefaultTermDays: Number(event.target.value) })}
            className={`${fieldClass} num text-right`}
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Jatuh tempo penerimaan barang = tanggal terima + termin pemasok; angka ini dipakai bila pemasok tidak punya termin sendiri.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Termin bawaan piutang POS (hari)</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={form.receivableDefaultTermDays ?? 7}
            onChange={(event) => setForm({ ...form, receivableDefaultTermDays: Number(event.target.value) })}
            className={`${fieldClass} num text-right`}
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Bawaan tanggal tempo saat kasir mencatat penjualan utang di POS (sebelumnya tetap +7 hari).
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Kedaluwarsa bawaan reservasi stok (hari)</span>
          <input
            type="number"
            min={1}
            max={365}
            value={form.reservationDefaultExpiryDays ?? 7}
            onChange={(event) => setForm({ ...form, reservationDefaultExpiryDays: Number(event.target.value) })}
            className={`${fieldClass} num text-right`}
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Reservasi stok tanpa tanggal kedaluwarsa sendiri berhenti mengunci stok sesudah jumlah hari ini.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Peringatan mendekati kedaluwarsa batch (hari)</span>
          <input
            type="number"
            min={0}
            max={3650}
            value={form.expiryWarningDays ?? 30}
            onChange={(event) => setForm({ ...form, expiryWarningDays: Number(event.target.value) })}
            className={`${fieldClass} num text-right`}
          />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Batch yang berakhir dalam jumlah hari ini (atau sudah lewat) muncul di antrean kerja beranda Gudang.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Saldo kas/bank negatif</span>
          <select
            value={form.cashNegativePolicy ?? "warn"}
            onChange={(event) =>
              setForm({ ...form, cashNegativePolicy: event.target.value as "allow" | "warn" | "block" })
            }
            className={fieldClass}
          >
            <option value="allow">Boleh — tanpa pemeriksaan</option>
            <option value="warn">Peringatkan — posting jalan, peringatan tampil</option>
            <option value="block">Tolak — posting yang membuat saldo negatif dibatalkan</option>
          </select>
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Berlaku untuk semua pengeluaran dari akun kas/bank/QRIS (beban, bayar utang & gaji, transfer keluar, refund).
            Jurnal pembalik selalu dikecualikan agar koreksi tetap bisa dilakukan.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Pembulatan total kasir</span>
          <select value={form.roundingMode} onChange={(event) => setForm({ ...form, roundingMode: event.target.value })} className={fieldClass}>
            <option value="none">Tidak ada</option>
            <option value="nearest_100">Terdekat Rp100</option>
            <option value="nearest_500">Terdekat Rp500</option>
            <option value="nearest_1000">Terdekat Rp1.000</option>
            <option value="up_500">Ke atas Rp500</option>
            <option value="up_1000">Ke atas Rp1.000</option>
          </select>
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Berlaku di kasir bila kelompok harga tidak punya aturan pembulatan total sendiri.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Ambang diskon manual POS (%)</span>
          <PercentInput value={form.posDiscountThresholdPercent} onChange={(value) => setForm({ ...form, posDiscountThresholdPercent: value })} className="h-9 text-[12px]" />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Diskon manual per baris di atas ambang ini memerlukan izin &ldquo;Diskon manual POS&rdquo; (supervisor/manajer) dan tercatat di audit.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Toleransi selisih kas tutup sesi POS (Rp)</span>
          <MoneyInput value={form.posSessionDifferenceTolerance ?? ""} onChange={(value) => setForm({ ...form, posSessionDifferenceTolerance: value })} className="h-9 px-2.5 text-[12px]" placeholder="0" />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Selisih antara kas seharusnya dan hitungan fisik kasir saat tutup sesi sampai nominal ini tidak wajib disertai alasan; selisih di atasnya ditolak server sampai kasir mengisi alasan selisih. 0 = semua selisih wajib alasan.
          </span>
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Ambang persetujuan penyesuaian stok (Rp)</span>
          <MoneyInput value={form.adjustmentApprovalThreshold} onChange={(value) => setForm({ ...form, adjustmentApprovalThreshold: value })} className="h-9 px-2.5 text-[12px]" placeholder="Kosong = nonaktif" />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            Penyesuaian stok (koreksi, rusak, kedaluwarsa, hilang) dengan nilai dampak di atas nominal ini tidak langsung terposting: dokumen menunggu persetujuan pengguna lain yang berizin mengelola gudang, dan pembuatnya tidak dapat menyetujui sendiri. Retur pembelian dan karantina selalu langsung terposting. Perusahaan baru otomatis terisi Rp1.000.000. Kosongkan untuk menonaktifkan persetujuan.
          </span>
          {/* FIX-GDG Tahap 3 (GDG3-10): peringatan sadar saat gerbang
              mati — mengosongkan ambang adalah keputusan berisiko yang
              harus terlihat, bukan keadaan bawaan yang tak disadari. */}
          {form.adjustmentApprovalThreshold.trim() === "" ? (
            <span className="block rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-4 text-amber-900">
              Peringatan: ambang kosong berarti persetujuan NONAKTIF — penyesuaian stok bernilai
              berapa pun langsung terposting oleh pembuatnya tanpa pemeriksa kedua. Isi nominal
              (mis. 1000000) untuk mengaktifkan maker-checker.
            </span>
          ) : null}
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className={labelClass}>Ambang persetujuan Permintaan Pembelian (Rp)</span>
          <MoneyInput value={form.prApprovalThreshold ?? ""} onChange={(value) => setForm({ ...form, prApprovalThreshold: value })} className="h-9 px-2.5 text-[12px]" placeholder="Kosong = nonaktif" />
          <span className="block text-[10px] leading-4 text-muted-foreground">
            PR dengan total perkiraan di atas nominal ini hanya boleh disahkan peran owner/admin/manager. Pengesah tetap wajib pengguna lain selain pembuat PR.
          </span>
        </label>
        </div>
      </SettingsSection>
      <SettingsSection id="alur-kerja" title="Alur kerja & stok" description="Saklar perilaku alur lintas modul.">
        <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-tone-amber/30 bg-tone-amber-soft/20 p-3 sm:col-span-2">
          <label className="flex items-start gap-2.5 text-[12px] font-medium text-foreground">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.allowNegativeStock}
              onChange={(event) => setForm({ ...form, allowNegativeStock: event.target.checked })}
            />
            <div>
              <span>Izinkan stok gudang bernilai negatif (Kebijakan Gudang & Stok)</span>
              <span className="mt-0.5 block text-[11px] font-normal leading-4 text-muted-foreground">
                <strong>Peringatan Risiko Finansial:</strong> Mengizinkan penjualan atau pengeluaran barang tanpa fisik stok dapat mengakibatkan distorsi perhitungan Harga Pokok Penjualan (HPP / moving average AVCO) dan anomali saldo persediaan di Buku Besar saat barang masuk tercatat kemudian.
              </span>
            </div>
          </label>
        </div>
        <label className="flex items-start gap-2 self-end pb-1 text-[12px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.posOfflineEnabled ?? false}
            onChange={(event) => setForm({ ...form, posOfflineEnabled: event.target.checked })}
          />
          <span>
            Mode offline POS
            <span className="block text-[10px] font-normal text-muted-foreground">
              Kasir dapat mengantre penjualan saat koneksi putus; antrean disinkronkan lewat jalur checkout normal dengan kunci idempotensi per transaksi sesudah online kembali.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 self-end pb-1 text-[12px]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={form.transferTwoStepEnabled ?? false}
            onChange={(event) => setForm({ ...form, transferTwoStepEnabled: event.target.checked })}
          />
          <span>
            Transfer gudang dua tahap
            <span className="block text-[10px] font-normal text-muted-foreground">
              Transfer berhenti sebagai “Dalam Perjalanan” sesudah dikirim dan baru menambah stok tujuan saat diterima. Nonaktif = transfer satu tahap langsung selesai.
            </span>
          </span>
        </label>
        </div>
      </SettingsSection>
    </div>
  );
}
