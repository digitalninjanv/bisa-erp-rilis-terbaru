"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { deleteAccountAction } from "@/server/actions/accounting/akun-pemetaan";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu, type RowMenuItem } from "@/components/blocks/row-menu";
import {
  AccountForm,
  type AccountImpactSummary,
  type AccountInput,
} from "./account-form";

/**
 * A-28 UI-5 (UX-A05): aksi baris Bagan akun mengikuti pola A-25 —
 * Ubah tetap tombol dialog terlihat berlabel; Hapus masuk menu ⋯
 * sebagai aksi destruktif terpisah di dasar (sebelumnya tombol
 * "Hapus" terbuka di setiap baris, termasuk akun berlencana
 * Sistem yang pasti ditolak server). Untuk akun terikat, item
 * Hapus NONAKTIF dan membawa penjelasannya di dalam menu:
 * - akun sistem (isSystem dari model baca = dirujuk pemetaan akun
 *   dan/atau metode pembayaran), atau
 * - akun yang masih menjadi induk sub-akun.
 * Aturan hapus TIDAK berubah: penghapusan tetap lewat
 * deleteAccountAction yang sama dengan penjaga domain yang sama
 * (jurnal, sub-akun, pemetaan, metode, kelompok diskon); dialog
 * konfirmasinya kini ConfirmDialog bersama menggantikan
 * window.confirm (pola yang sama seperti aksi baris Produk).
 */
/**
 * Alasan item Hapus nonaktif di menu baris — null berarti hapus
 * boleh dicoba (penjaga domain tetap yang memutuskan di server).
 * Diekstrak murni agar teruji unit (menu ⋯ sendiri tidak dirender
 * pada render statis).
 */
export function accountDeleteBlockReason(input: {
  isSystem: boolean;
  hasChildren: boolean;
}): string | null {
  if (input.isSystem) {
    return "Akun sistem — dirujuk pemetaan akun dan/atau metode pembayaran. Ganti ikatannya terlebih dahulu, atau nonaktifkan akun ini.";
  }
  if (input.hasChildren) {
    return "Akun ini masih menjadi induk sub-akun. Pindahkan sub-akunnya terlebih dahulu.";
  }
  return null;
}

export function AccountRowActions({
  account,
  parents,
  impact,
  canManage,
  hasChildren,
}: {
  account: AccountInput;
  parents: { id: string; code: string; name: string }[];
  impact: AccountImpactSummary;
  canManage: boolean;
  hasChildren: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const deleteBlockedReason = accountDeleteBlockReason({
    isSystem: impact.isSystem,
    hasChildren,
  });

  async function remove() {
    if (!account.id) return;
    setBusy(true);
    const result = await deleteAccountAction(account.id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Akun dihapus.");
    router.refresh();
  }

  const items: RowMenuItem[] = [
    { key: "detail", label: "Lihat detail", href: `/app/akuntansi/akun/${account.id}` },
    { key: "ledger", label: "Buka di buku besar", href: `/app/akuntansi/buku-besar?account=${account.id}` },
    ...(canManage
      ? [
          {
            key: "delete",
            label: "Hapus",
            danger: true,
            disabled: busy || deleteBlockedReason !== null,
            ...(deleteBlockedReason ? { note: deleteBlockedReason } : {}),
          } satisfies RowMenuItem,
        ]
      : []),
  ];

  return (
    <div className="flex items-center justify-end gap-1">
      {canManage ? <AccountForm account={account} parents={parents} impact={impact} /> : null}
      <RowMenu
        label={`Aksi untuk akun ${account.code} ${account.name}`}
        items={items}
        onAction={(key) => {
          if (key === "delete") setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={`Hapus akun "${account.name}"?`}
        description="Akun yang sudah dipakai jurnal tidak bisa dihapus — server akan menolaknya. Penghapusan ini permanen."
        confirmLabel="Hapus akun"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
