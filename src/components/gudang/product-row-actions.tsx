"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  deleteProductAction,
  toggleProductAction,
} from "@/server/actions/inventory/produk";
import { ConfirmDialog } from "@/components/blocks/confirm-dialog";
import { RowMenu } from "@/components/blocks/row-menu";

/**
 * A-25 U2: aksi baris produk kini SATU menu ⋯ (RowMenu bersama) —
 * sebelumnya dua tombol permanen "Nonaktifkan" + "Hapus" di setiap
 * baris (AUDIT-UI-A25 POLA-07). Hapus tetap berkonfirmasi menyebut
 * nama produk, dan di dalam menu ia terpisah sebagai aksi destruktif.
 */
export function ProductRowActions({
  id,
  name,
  isActive,
}: {
  id: string;
  name: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function toggle() {
    setBusy(true);
    const result = await toggleProductAction({ id, isActive: !isActive });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(isActive ? "Produk dinonaktifkan." : "Produk diaktifkan.");
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    const result = await deleteProductAction(id);
    setBusy(false);
    setConfirming(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Produk dihapus.");
    router.refresh();
  }

  return (
    <div className="flex justify-end">
      <RowMenu
        label={`Aksi untuk ${name}`}
        items={[
          { key: "toggle", label: isActive ? "Nonaktifkan" : "Aktifkan", disabled: busy },
          { key: "delete", label: "Hapus", danger: true, disabled: busy },
        ]}
        onAction={(key) => {
          if (key === "toggle") void toggle();
          if (key === "delete") setConfirming(true);
        }}
      />
      <ConfirmDialog
        open={confirming}
        title={`Hapus produk "${name}"?`}
        description="Produk yang sudah bertransaksi atau masih berstok tidak bisa dihapus — server akan menolaknya. Penghapusan ini permanen."
        confirmLabel="Hapus produk"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
