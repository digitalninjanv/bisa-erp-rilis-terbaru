"use client";

import { useState } from "react";
import { RowMenu } from "@/components/blocks/row-menu";
import { WriteOffButton } from "@/components/akuntansi/payment-form";
import { OpeningBalanceVoidButton } from "@/components/akuntansi/opening-balance-form";

/**
 * G3 (UX4-01): aksi sekunder baris dokumen piutang/utang — write-off
 * sisa dan pembatalan saldo awal — kini di dalam SATU menu ⋯ di
 * samping aksi utama Terima/Bayar (PaymentForm, tetap terlihat
 * sebagai tindakan kerja utama daftar ini). Sebelumnya keduanya
 * tombol permanen per baris ("Write-off sisa" + "Void"). Kedua
 * dialognya tidak berubah: komponen yang sama dalam mode terkendali
 * (alasan wajib + ConfirmDialog). Menu tidak dirender bila tak satu
 * pun aksi tersedia untuk baris itu.
 */
export function PartyRowSecondaryActions({
  number,
  writeOff,
  voidOpeningId,
}: {
  number: string;
  writeOff: {
    kind: "receivable" | "payable" | "expense-payable" | "opening";
    id: string;
    outstanding: number;
  } | null;
  voidOpeningId: string | null;
}) {
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);

  if (!writeOff && !voidOpeningId) return null;

  return (
    <>
      {writeOff ? (
        <WriteOffButton
          kind={writeOff.kind}
          id={writeOff.id}
          number={number}
          outstanding={writeOff.outstanding}
          open={writeOffOpen}
          onOpenChange={setWriteOffOpen}
        />
      ) : null}
      {voidOpeningId ? (
        <OpeningBalanceVoidButton
          openingId={voidOpeningId}
          number={number}
          open={voidOpen}
          onOpenChange={setVoidOpen}
        />
      ) : null}
      <RowMenu
        label={`Aksi lain untuk dokumen ${number}`}
        items={[
          ...(writeOff ? [{ key: "writeoff", label: "Write-off sisa" }] : []),
          ...(voidOpeningId
            ? [{ key: "void", label: "Batalkan saldo awal", danger: true }]
            : []),
        ]}
        onAction={(key) => {
          if (key === "writeoff") setWriteOffOpen(true);
          if (key === "void") setVoidOpen(true);
        }}
      />
    </>
  );
}
