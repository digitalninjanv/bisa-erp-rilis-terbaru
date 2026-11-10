/**
 * A-25 U2 — peta status dokumen → penanda tahap untuk `StatusSteps`
 * di `DocumentPage` (pola status bar Odoo, ARAH-DESAIN-A25 §3.5).
 * Fungsi murni: halaman/detail dokumen menghitung tahapnya di sini
 * agar maknanya seragam antar-modul (tahap yang sudah dilewati =
 * done, tahap status saat ini = current, sisanya = todo; status
 * terminal negatif menutup alur dengan tahap "void").
 */

export type FlowStepState = "done" | "current" | "todo" | "void";

export type FlowStep = {
  key: string;
  label: string;
  state: FlowStepState;
};

export type FlowStage = {
  key: string;
  label: string;
  /** Nilai status dokumen yang termasuk tahap ini. */
  statuses: string[];
};

const VOID_STATUSES = new Set(["void", "cancelled", "rejected"]);

/**
 * Bangun langkah dari daftar tahap berurutan + status nyata dokumen.
 * Status yang tidak dikenal tahap mana pun (mis. status terminal
 * negatif) menutup alur: tahap sebelum status terakhir yang cocok
 * tetap ditandai selesai sejauh yang bisa dibuktikan dari daftar —
 * konservatif: semua tahap menjadi todo dan satu tahap void
 * ditambahkan, karena urutan sesungguhnya tidak diketahui.
 */
export function documentFlowSteps(
  status: string,
  stages: FlowStage[],
  /** Label tahap terminal untuk status di luar daftar tahap —
   * pemanggil komponen meneruskan `statusLabel(status)` bersama. */
  terminalLabel: string = status,
): FlowStep[] {
  const currentIndex = stages.findIndex((stage) => stage.statuses.includes(status));
  if (currentIndex >= 0) {
    return stages.map((stage, index) => ({
      key: stage.key,
      label: stage.label,
      state: index < currentIndex ? "done" : index === currentIndex ? "current" : "todo",
    }));
  }
  const steps: FlowStep[] = stages.map((stage) => ({
    key: stage.key,
    label: stage.label,
    state: "todo" as const,
  }));
  steps.push({ key: `terminal-${status}`, label: terminalLabel, state: "void" });
  return steps;
}

const VOID_LABELS: Record<string, string> = {
  void: "Batal",
  cancelled: "Dibatalkan",
  rejected: "Ditolak",
};

export const JOURNAL_FLOW_STAGES: FlowStage[] = [
  { key: "draft", label: "Draf", statuses: ["draft"] },
  { key: "posted", label: "Terposting", statuses: ["posted"] },
];

/**
 * Alur jurnal: Draf → Terposting. Jurnal yang sudah dibalik tetap
 * "Terposting" (pembaliknya adalah jurnal baru), jadi keadaan dibalik
 * ditambahkan sebagai tahap penutup dari fakta `hasReversal`, bukan
 * dari status entri. Jurnal void menutup dengan tahap Batal.
 */
/**
 * A-25 U3 — peta tahap dokumen Gudang (status nyata dari domain
 * inventory/purchasing/supplier-returns/purchase-requests; label
 * tahap mengikuti statusLabel bersama).
 */
export const PURCHASE_ORDER_FLOW_STAGES: FlowStage[] = [
  { key: "draft", label: "Draf", statuses: ["draft"] },
  { key: "sent", label: "Terkirim", statuses: ["sent"] },
  { key: "received", label: "Diterima", statuses: ["partial", "received"] },
];

export const SUPPLIER_RETURN_FLOW_STAGES: FlowStage[] = [
  { key: "draft", label: "Draf", statuses: ["draft"] },
  { key: "posted", label: "Terposting", statuses: ["posted", "partially_resolved"] },
  { key: "resolved", label: "Selesai", statuses: ["resolved", "completed"] },
];

/** Transfer stok: berhenti di `in_transit` hanya pada mode dua tahap;
 * satu tahap langsung `posted` (= diterima) — tahap pertama lalu
 * terbaca selesai dari fungsi bersama, sesuai keadaan nyatanya. */
export const STOCK_TRANSFER_FLOW_STAGES: FlowStage[] = [
  { key: "in_transit", label: "Dalam perjalanan", statuses: ["in_transit"] },
  { key: "posted", label: "Diterima", statuses: ["posted"] },
];

/** Dokumen stok satu langkah (penerimaan, opname, penyesuaian):
 * lahir langsung terposting; tahap tunggal jujur, bukan karangan. */
export const STOCK_POSTED_FLOW_STAGES: FlowStage[] = [
  { key: "posted", label: "Terposting", statuses: ["posted"] },
];

export const PURCHASE_REQUEST_FLOW_STAGES: FlowStage[] = [
  { key: "submitted", label: "Diajukan", statuses: ["submitted"] },
  { key: "approved", label: "Disetujui", statuses: ["approved"] },
  { key: "converted", label: "Menjadi PO", statuses: ["converted"] },
];

/** Run payroll (A-25 U5): lahir terposting saat diproses, lalu
 * dibayar; status void menutup alur lewat tahap terminal. */
export const PAYROLL_FLOW_STAGES: FlowStage[] = [
  { key: "posted", label: "Terproses", statuses: ["posted"] },
  { key: "paid", label: "Dibayar", statuses: ["paid"] },
];

export function journalFlowSteps(status: string, hasReversal = false): FlowStep[] {
  if (VOID_STATUSES.has(status)) {
    return [
      { key: "draft", label: "Draf", state: "done" },
      { key: "void", label: VOID_LABELS[status] ?? status, state: "void" },
    ];
  }
  const steps = documentFlowSteps(status, JOURNAL_FLOW_STAGES);
  if (hasReversal && status === "posted") {
    steps.push({ key: "reversed", label: "Sudah dibalik", state: "void" });
  }
  return steps;
}
