"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  deleteQuickEntryDraftAction,
  getQuickEntryBootstrapAction,
  listQuickEntryDraftsAction,
  postQuickEntryAction,
  saveQuickEntryDraftAction,
} from "@/server/actions/quick-entry";
import { d } from "@/lib/money";
import { showPostingWarnings } from "@/lib/notify-warnings";
import { todayISO } from "@/lib/format";
import {
  buildQuickEntryPreview,
  type QuickEntryKind,
  type QuickEntryPayload,
} from "@/lib/quick-entry";
import { QUICK_ENTRY_OPEN_EVENT, type QuickEntryOpenDetail } from "./quick-entry-trigger";
import {
  accountLabel,
  payloadToForm,
  withDefaults,
  EMPTY_FORM,
  type Bootstrap,
  type DraftRow,
  type FormState,
} from "./quick-entry/form-state";
import { DraftBar } from "./quick-entry/draft-bar";
import { KindTabs } from "./quick-entry/kind-tabs";
import { KindFields } from "./quick-entry/kind-fields";
import { JournalPreview } from "./quick-entry/journal-preview";
import { FormFooter } from "./quick-entry/form-footer";

/**
 * Host modal Catat Transaksi (A-12/D-23): terpasang sekali di layout
 * Akuntansi. Mendengarkan CustomEvent dari pemicu (tombol Beranda,
 * panel Input Cepat, seksi draf) dan pintasan keyboard N.
 */
export function QuickEntryHost({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<QuickEntryOpenDetail>({});
  const [session, setSession] = useState(0);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const openRef = useRef(false);
  useEffect(() => {
    openRef.current = open;
  }, [open ]);

  useEffect(() => {
    if (!enabled) return;
    function onOpenEvent(event: Event) {
      const next = (event as CustomEvent<QuickEntryOpenDetail>).detail ?? {};
      setDetail(next);
      setSession((value) => value + 1);
      setOpen(true);
    }
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "n" && event.key !== "N") return;
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      if (openRef.current) return;
      // Modal/dialog lain sedang terbuka → jangan menumpuk.
      if (document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      setDetail({});
      setSession((value) => value + 1);
      setOpen(true);
    }
    window.addEventListener(QUICK_ENTRY_OPEN_EVENT, onOpenEvent);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(QUICK_ENTRY_OPEN_EVENT, onOpenEvent);
      window.removeEventListener("keydown", onKey);
    };
  }, [enabled]);

  if (!enabled) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <DialogContent className="sm:max-w-3xl" showCloseButton>
        <DialogHeader>
          <DialogTitle>Catat Transaksi</DialogTitle>
          <DialogDescription>
            Input cepat dengan jurnal otomatis dan selalu seimbang.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <QuickEntryForm
            key={session}
            detail={detail}
            bootstrap={bootstrap}
            onBootstrap={setBootstrap}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}


function QuickEntryForm({
  detail,
  bootstrap,
  onBootstrap,
  onClose,
}: {
  detail: QuickEntryOpenDetail;
  bootstrap: Bootstrap | null;
  onBootstrap: (data: Bootstrap) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  // Keadaan awal dihitung sinkron dari props saat komponen dipasang
  // (komponen di-remount per sesi buka lewat key): bootstrap yang sudah
  // ter-cache + permintaan buka (jenis/draf) langsung diterapkan.
  const [initial] = useState(() => {
    let form: FormState = { ...EMPTY_FORM, date: todayISO() };
    let editingDraftId: string | null = null;
    let selectedDraftId = "";
    if (bootstrap) {
      if (detail.draftId) {
        const draft = bootstrap.drafts.find((row) => row.id === detail.draftId);
        if (draft) {
          form = payloadToForm(draft.payload);
          editingDraftId = draft.id;
          selectedDraftId = draft.id;
        }
      }
      if (!editingDraftId && detail.kind) form = { ...form, kind: detail.kind };
      form = withDefaults(form, bootstrap);
    } else if (detail.kind) {
      form = { ...form, kind: detail.kind };
    }
    return { form, editingDraftId, selectedDraftId };
  });
  const [form, setForm] = useState<FormState>(initial.form);
  const [amountValid, setAmountValid] = useState(true);
  const [feeValid, setFeeValid] = useState(true);
  const [discountValid, setDiscountValid] = useState(true);
  const [drafts, setDrafts] = useState<DraftRow[]>(bootstrap?.drafts ?? []);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(initial.editingDraftId);
  const [selectedDraftId, setSelectedDraftId] = useState(initial.selectedDraftId);
  const [busyPost, setBusyPost] = useState(false);
  const [busyDraft, setBusyDraft] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  // Muat bootstrap saat pertama dibuka (di-cache di host sesudahnya);
  // semua setState terjadi di callback async, bukan badan efek.
  useEffect(() => {
    if (bootstrap) return;
    let cancelled = false;
    getQuickEntryBootstrapAction().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        toast.error(result.message);
        onClose();
        return;
      }
      const data = result.data;
      onBootstrap(data);
      setDrafts(data.drafts);
      if (detail.draftId) {
        const draft = data.drafts.find((row) => row.id === detail.draftId);
        if (draft) {
          setForm(withDefaults(payloadToForm(draft.payload), data));
          setEditingDraftId(draft.id);
          setSelectedDraftId(draft.id);
          return;
        }
      }
      setForm((current) => withDefaults(current, data));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPayload(payload: QuickEntryPayload, draftId: string | null) {
    setForm(bootstrap ? withDefaults(payloadToForm(payload), bootstrap) : payloadToForm(payload));
    setEditingDraftId(draftId);
    idempotencyKey.current = crypto.randomUUID();
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function switchKind(kind: QuickEntryKind) {
    setForm((current) => {
      const next = { ...current, kind };
      if (bootstrap) {
        if (kind === "expense" && !bootstrap.expenseAccounts.some((a) => a.id === next.counterAccountId)) {
          next.counterAccountId = bootstrap.expenseAccounts[0]?.id ?? "";
        }
        if (kind === "cash_sale" && !bootstrap.revenueAccounts.some((a) => a.id === next.counterAccountId)) {
          next.counterAccountId = bootstrap.defaultRevenueAccountId ?? bootstrap.revenueAccounts[0]?.id ?? "";
        }
        if (kind === "receive") next.partyId = bootstrap.customers[0]?.id ?? "";
        if (kind === "pay") next.partyId = bootstrap.suppliers[0]?.id ?? "";
        // R3-05: tag pelanggan penjualan tunai bersifat opsional dan
        // mulai kosong setiap kali tab dipilih — partyId dari tab
        // terima/bayar tidak boleh terbawa sebagai tag di sini.
        if (kind === "cash_sale") next.partyId = "";
      }
      return next;
    });
  }

  const partyOutstanding = useMemo(() => {
    if (!bootstrap) return null;
    if (form.kind === "receive") {
      return bootstrap.customers.find((row) => row.id === form.partyId) ?? null;
    }
    if (form.kind === "pay") {
      return bootstrap.suppliers.find((row) => row.id === form.partyId) ?? null;
    }
    return null;
  }, [bootstrap, form.kind, form.partyId]);

  const preview = useMemo(() => {
    if (!bootstrap) return null;
    const fifoDocs =
      form.kind === "receive"
        ? bootstrap.receivableDocs.filter((doc) => doc.partyId === form.partyId)
        : form.kind === "pay"
          ? bootstrap.payableDocs.filter((doc) => doc.partyId === form.partyId)
          : undefined;
    return buildQuickEntryPreview({
      kind: form.kind,
      amount: form.amount || "0",
      cashAccountLabel: accountLabel(bootstrap.cashAccounts, form.accountId),
      counterAccountLabel: accountLabel(
        form.kind === "expense" ? bootstrap.expenseAccounts : bootstrap.revenueAccounts,
        form.counterAccountId,
      ),
      taxIncluded: form.taxIncluded,
      taxRate: bootstrap.taxRate,
      taxAccountLabel: bootstrap.taxOutputAccount
        ? `${bootstrap.taxOutputAccount.code} — ${bootstrap.taxOutputAccount.name}`
        : undefined,
      taxInputAccountLabel: bootstrap.taxInputAccount
        ? `${bootstrap.taxInputAccount.code} — ${bootstrap.taxInputAccount.name}`
        : undefined,
      receivableAccountLabel: bootstrap.receivableAccount
        ? `${bootstrap.receivableAccount.code} — ${bootstrap.receivableAccount.name}`
        : undefined,
      payableAccountLabel: bootstrap.payableAccount
        ? `${bootstrap.payableAccount.code} — ${bootstrap.payableAccount.name}`
        : undefined,
      expensePayableLabel:
        form.kind === "expense" && form.expenseMode === "accrual" && bootstrap.payableAccount
          ? `${bootstrap.payableAccount.code} — ${bootstrap.payableAccount.name}`
          : undefined,
      fromAccountLabel: accountLabel(bootstrap.cashAccounts, form.fromAccountId),
      toAccountLabel: accountLabel(bootstrap.cashAccounts, form.toAccountId),
      discount: form.kind === "cash_sale" ? form.discount || "0" : undefined,
      discountAccountLabel: bootstrap.discountAccount
        ? `${bootstrap.discountAccount.code} — ${bootstrap.discountAccount.name}`
        : undefined,
      fee: form.kind === "transfer" ? form.fee || "0" : undefined,
      feeAccountLabel: bootstrap.bankFeeAccount
        ? `${bootstrap.bankFeeAccount.code} — ${bootstrap.bankFeeAccount.name}`
        : undefined,
      fifoDocs,
    });
  }, [bootstrap, form]);

  function currentPayload(): QuickEntryPayload {
    return {
      kind: form.kind,
      date: form.date,
      amount: form.amount,
      accountId: form.accountId || undefined,
      counterAccountId: form.counterAccountId || undefined,
      partyId: form.partyId || undefined,
      fromAccountId: form.fromAccountId || undefined,
      toAccountId: form.toAccountId || undefined,
      fee: form.kind === "transfer" ? form.fee || "0" : undefined,
      discount: form.kind === "cash_sale" ? form.discount || "0" : undefined,
      expenseSupplierId:
        form.kind === "expense" && form.expenseMode === "accrual"
          ? form.expenseSupplierId || undefined
          : undefined,
      reference:
        form.kind === "transfer" || form.kind === "receive" || form.kind === "pay"
          ? form.reference.trim() || undefined
          : undefined,
      // A-21 Tahap R3-A (R3-06): potongan hanya untuk bayar utang,
      // dan hanya terkirim bila saklar perusahaan aktif & nominal
      // terisi — draf tanpa saklar tidak membawa potongan hantu.
      withholdingType:
        form.kind === "pay" && bootstrap?.withholdingEnabled && form.withholdingAmount
          ? form.withholdingType === "pph42"
            ? "pph42"
            : "pph23"
          : undefined,
      withholdingRate:
        form.kind === "pay" && bootstrap?.withholdingEnabled && form.withholdingAmount
          ? form.withholdingRate || undefined
          : undefined,
      withholdingAmount:
        form.kind === "pay" && bootstrap?.withholdingEnabled
          ? form.withholdingAmount || undefined
          : undefined,
      taxIncluded:
        form.kind === "cash_sale" || form.kind === "expense" ? form.taxIncluded : undefined,
      notes: form.notes || undefined,
    };
  }

  async function refreshDrafts() {
    const result = await listQuickEntryDraftsAction();
    if (result.ok) setDrafts(result.data);
  }

  async function saveDraft() {
    setBusyDraft(true);
    const result = await saveQuickEntryDraftAction({
      id: editingDraftId ?? undefined,
      payload: currentPayload(),
    });
    setBusyDraft(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    setEditingDraftId(result.data.id);
    setSelectedDraftId(result.data.id);
    await refreshDrafts();
    toast.success("Draf tersimpan di server — bisa dilanjutkan kapan pun.");
    router.refresh();
  }

  async function removeDraft(id: string) {
    const result = await deleteQuickEntryDraftAction({ id });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (editingDraftId === id) setEditingDraftId(null);
    if (selectedDraftId === id) setSelectedDraftId("");
    await refreshDrafts();
    toast.success("Draf dihapus.");
    router.refresh();
  }

  function validate(): string | null {
    if (!amountValid) return "Jumlah tidak terbaca. Periksa bidang jumlah.";
    if (!d(form.amount || "0").gt(0)) return "Jumlah harus lebih dari nol.";
    switch (form.kind) {
      case "cash_sale":
        if (!form.accountId) return "Pilih akun kas/bank tujuan penerimaan.";
        if (!form.counterAccountId) return "Pilih akun pendapatan.";
        if (!discountValid) return "Diskon tidak terbaca. Periksa bidang diskon.";
        if (d(form.discount || "0").lt(0)) return "Diskon tidak boleh negatif.";
        if (d(form.discount || "0").gt(d(form.amount || "0"))) return "Diskon tidak boleh melebihi jumlah penjualan.";
        break;
      case "expense":
        if (!form.counterAccountId) return "Pilih akun beban.";
        if (form.expenseMode === "accrual") {
          if (!form.expenseSupplierId) return "Pilih pemasok yang diutangi.";
        } else if (!form.accountId) {
          return "Pilih akun pembayaran beban.";
        }
        if (form.notes.trim().length < 3) return "Keterangan beban wajib diisi minimal 3 karakter.";
        break;
      case "receive":
        if (!form.partyId) return "Pilih pelanggan yang membayar.";
        if (!form.accountId) return "Pilih akun kas/bank tujuan penerimaan.";
        break;
      case "pay":
        if (!form.partyId) return "Pilih pemasok yang dibayar.";
        if (!form.accountId) return "Pilih akun kas/bank sumber pembayaran.";
        break;
      case "transfer":
        if (!form.fromAccountId || !form.toAccountId) return "Pilih rekening asal dan tujuan.";
        if (form.fromAccountId === form.toAccountId) return "Rekening asal dan tujuan harus berbeda.";
        if (!feeValid) return "Biaya transfer tidak terbaca. Periksa bidang biaya transfer.";
        if (d(form.fee || "0").lt(0)) return "Biaya transfer tidak boleh negatif.";
        break;
    }
    // A-21 (R3-02): jumlah BOLEH melebihi total piutang/utang
    // terbuka — kelebihannya menjadi kredit pihak (uang muka),
    // bukan lagi kesalahan. Pesan kelebihannya tampil sebagai
    // keterangan di bawah pilihan pihak, bukan penolakan.
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusyPost(true);
    const result = await postQuickEntryAction({
      payload: currentPayload(),
      idempotencyKey: idempotencyKey.current,
      draftId: editingDraftId ?? undefined,
    });
    setBusyPost(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    const numbers = result.data.numbers.join(", ");
    showPostingWarnings(result.data.warnings);
    toast.success(
      form.kind === "receive" || form.kind === "pay"
        ? `Pembayaran terposting: ${numbers}.`
        : `Transaksi terposting: ${numbers}.`,
    );
    onClose();
    router.refresh();
  }

  if (!bootstrap) {
    return <p className="py-10 text-center text-[12px] text-muted-foreground">Memuat data…</p>;
  }

  const taxRate = d(bootstrap.taxRate);
  // FIX-P1 Tahap 4 (AK4-04): opsi "Termasuk PPN" kini juga untuk Beban
  // (PPN Masukan), bukan hanya Penjualan tunai (PPN Keluaran).
  const showTaxOption = (form.kind === "cash_sale" || form.kind === "expense") && taxRate.gt(0);
  const taxAccountForKind = form.kind === "expense" ? bootstrap.taxInputAccount : bootstrap.taxOutputAccount;
  const amountExceedsParty =
    partyOutstanding && d(form.amount || "0").gt(d(partyOutstanding.totalOutstanding));

  return (
    <div className="min-w-0">
      <DraftBar
        drafts={drafts}
        selectedDraftId={selectedDraftId}
        setSelectedDraftId={setSelectedDraftId}
        applyPayload={applyPayload}
        removeDraft={removeDraft}
        editingDraftId={editingDraftId}
      />

      <KindTabs form={form} switchKind={switchKind} />

      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_290px]">
        <KindFields
          form={form}
          set={set}
          bootstrap={bootstrap}
          setAmountValid={setAmountValid}
          setDiscountValid={setDiscountValid}
          setFeeValid={setFeeValid}
          partyOutstanding={partyOutstanding}
          amountExceedsParty={amountExceedsParty}
          showTaxOption={showTaxOption}
          taxAccountForKind={taxAccountForKind}
        />
        <JournalPreview preview={preview} form={form} />
      </div>

      <FormFooter
        onClose={onClose}
        saveDraft={saveDraft}
        submit={submit}
        busyPost={busyPost}
        busyDraft={busyDraft}
      />
    </div>
  );
}
