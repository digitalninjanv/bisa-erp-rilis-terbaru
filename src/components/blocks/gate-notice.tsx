import type { ReactNode } from "react";

/**
 * A-24 T1 (SIS-05) — kotak pemberitahuan gerbang form, satu-satunya
 * pola untuk dua keadaan jujur di halaman daftar berform:
 *
 * - prasyarat benar-benar kurang bagi pengguna yang BOLEH membuat
 *   dokumen (pesan prasyarat — hanya tampil untuk mereka), dan
 * - mode lihat bagi peran yang hanya dapat melihat (perannya tidak
 *   membuat dokumen di halaman ini).
 *
 * Sebelum komponen ini, halaman mencampur keduanya dalam satu pesan
 * else sehingga peran lihat-saja menerima instruksi prasyarat yang
 * tidak benar. Keputusan cabangnya dihitung halaman lewat
 * `formGateState` (lib/form-gate) — komponen ini hanya tampilannya.
 */
export function GateNotice({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
      {children}
    </div>
  );
}

/** Kalimat mode-lihat baku: siapa yang membuat dokumen di halaman ini. */
export function viewModeText(actionLabel: string) {
  return `Mode lihat — peran Anda dapat melihat halaman ini. Membuat ${actionLabel} adalah peran Staf Gudang, Manager, atau Pemilik.`;
}
