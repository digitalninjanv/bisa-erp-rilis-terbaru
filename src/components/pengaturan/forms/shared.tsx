/**
 * A-26 Q3 (K-02): pecahan `settings-forms.tsx` per topik — helper bersama form Pengaturan (Modal, Field, tipe Account).
 * Nama ekspor, props, dan perilaku identik dengan berkas asal;
 * `settings-forms.tsx` kini barrel re-export.
 */
"use client";

// A-26 Q7 (P-10/D-12): Modal kini tinggal di rumah bersama
// `@/components/blocks/modal`; re-export agar pemanggil di folder ini
// (`./shared`) tidak berubah.
export { Modal } from "@/components/blocks/modal";

// G1 (FRM-04): Field diangkat ke rumah bersama
// `@/components/blocks/field`; re-export agar pemanggil di folder ini
// tidak berubah.
export { Field } from "@/components/blocks/field";

/** Tipe akun ringkas untuk pemilih akun di form-form Pengaturan. */
export type Account = {
  id: string;
  code: string;
  name: string;
  type: string;
  /** A-27 B3: kelas kas/bank akun (cash|bank|clearing) — pemilih akun metode pembayaran menyaring per kelas sesuai tipe metode. */
  cashBankKind?: string | null;
};
