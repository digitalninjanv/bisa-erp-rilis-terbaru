import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { formatIDR } from "@/lib/money";
import { getReturnCreditAction } from "@/server/actions/pos";
import type { PaymentEntry } from "@/components/pos/terminal-types";

// D-12: hasil pemeriksaan kredit dokumen retur (alur "Pakai Kredit Retur").
export type ReturnCreditInfo = {
  returnId: string;
  number: string;
  total: number;
  used: number;
  available: number;
  saleNumber: string;
};

// FIX-ARS Tahap 5 (ARS2-01): hook kredit retur (D-12) — periksa sisa
// kredit dokumen retur ke server, pakai sebagai baris pembayaran
// campuran, dan lepas kembali; diekstrak apa adanya dari PosTerminal.
export function useReturnCredit(params: {
  creditMethod: { id: string; name: string } | null;
  total: number;
  mixedAppliedTotal: number;
  entries: Record<string, PaymentEntry>;
  setEntries: Dispatch<SetStateAction<Record<string, PaymentEntry>>>;
  setMode: Dispatch<SetStateAction<"single" | "mixed">>;
}) {
  const { creditMethod, total, mixedAppliedTotal, entries, setEntries, setMode } = params;
  // D-12: alur "Pakai Kredit Retur" — metode customer_credit tidak ada
  // di daftar metode biasa; kredit dipakai lewat nomor dokumen retur.
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditNumber, setCreditNumber] = useState("");
  const [creditInfo, setCreditInfo] = useState<ReturnCreditInfo | null>(null);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditBusy, setCreditBusy] = useState(false);

  const appliedCredit = creditMethod ? entries[creditMethod.id] : undefined;

  // D-12: periksa sisa kredit dokumen retur lewat server — angka yang
  // ditampilkan selalu angka server, bukan tebakan klien.
  async function lookupCredit() {
    const number = creditNumber.trim();
    if (!number) {
      toast.error("Masukkan nomor dokumen retur.");
      return;
    }
    setCreditBusy(true);
    try {
      const result = await getReturnCreditAction(number);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      if (!result.data) {
        setCreditInfo(null);
        toast.error(
          `Retur ${number} tidak ditemukan atau tidak memiliki kredit — hanya retur tukar barang/kredit toko yang melahirkan kredit.`,
        );
        return;
      }
      setCreditInfo(result.data);
      const cap = Math.min(result.data.available, total);
      setCreditAmount(cap > 0 ? String(cap) : "");
    } catch {
      toast.error("Gagal memeriksa kredit retur. Periksa koneksi lalu coba lagi.");
    } finally {
      setCreditBusy(false);
    }
  }

  function applyCredit() {
    if (!creditMethod || !creditInfo) return;
    const amount = Number(creditAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Nominal kredit harus lebih dari 0.");
      return;
    }
    if (amount > creditInfo.available) {
      toast.error(`Nominal melebihi sisa kredit ${formatIDR(creditInfo.available)}.`);
      return;
    }
    const currentCreditAmount = Number(entries[creditMethod.id]?.amount ?? 0);
    const billRemaining = total - (mixedAppliedTotal - currentCreditAmount);
    if (amount > Math.max(0, billRemaining)) {
      toast.error(`Nominal melebihi sisa tagihan ${formatIDR(Math.max(0, billRemaining))}.`);
      return;
    }
    // Kredit adalah pembayaran campuran: satu penjualan bisa membagi
    // tagihan antara kredit retur dan metode lain.
    setMode("mixed");
    setEntries((current) => ({
      ...current,
      [creditMethod.id]: { amount: String(amount), tendered: "", reference: creditInfo.number },
    }));
    setCreditOpen(false);
    toast.success(`Kredit retur ${creditInfo.number} dipakai ${formatIDR(amount)}.`);
  }

  function removeCredit() {
    if (!creditMethod) return;
    setEntries((current) => {
      const next = { ...current };
      delete next[creditMethod.id];
      return next;
    });
    setCreditInfo(null);
    setCreditNumber("");
    setCreditAmount("");
  }

  // Urutan setter sama persis dengan rangkaian reset yang dulu inline
  // di dua jalur checkout (offline & tersambung) sesudah transaksi
  // berhasil — kini satu-satunya tempat rangkaian itu ditulis.
  function resetCredit() {
    setCreditInfo(null);
    setCreditNumber("");
    setCreditAmount("");
    setCreditOpen(false);
  }

  return {
    creditOpen,
    setCreditOpen,
    creditNumber,
    setCreditNumber,
    creditInfo,
    creditAmount,
    setCreditAmount,
    creditBusy,
    appliedCredit,
    lookupCredit,
    applyCredit,
    removeCredit,
    resetCredit,
  };
}

export type ReturnCreditApi = ReturnType<typeof useReturnCredit>;
