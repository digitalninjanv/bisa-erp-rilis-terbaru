"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ClipboardCheck,
  PackageCheck,
  ScanBarcode,
  Truck,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import {
  burstExpired,
  burstScanCode,
  createBurstState,
  feedBurstChar,
  resetBurst,
  type BurstState,
} from "@/lib/barcode-burst";
import {
  resolveOperationScan,
  type OperationRef,
} from "@/lib/operation-scan";
import type { OperationQueueCard } from "@/server/inventory";
import { searchInventoryProductsAction } from "@/server/actions/inventory/produk";
import { formatDate, todayISO } from "@/lib/format";
import { playScanSuccessTone, playScanErrorTone } from "@/lib/audio-feedback";

/**
 * A-24 T3 (pola G1): papan Mode Operasi. Satu input pindai yang
 * selalu fokus (scanner wedge mengetik ke elemen fokus — tidak perlu
 * penangkap global ala terminal POS); ledakan ketik dinilai pelacak
 * bersama lib/barcode-burst prasetel "document" untuk membedakan
 * pindaian dari ketikan, tetapi Enter manual atas nomor yang diketik
 * juga diterima (kotak ini memang kotak pindai khusus).
 *
 * Resolusi: nomor dokumen persis → buka; barcode/SKU produk →
 * pencarian server yang sudah ada → operasi yang memuat produk itu
 * (satu: buka; banyak: tandai kartunya; nol: pesan jelas).
 */
export function OperationQueueBoard({
  myTasks,
  queue,
}: {
  myTasks: OperationQueueCard[];
  queue: OperationQueueCard[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const burstRef = useRef<BurstState>(createBurstState());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [matchedIds, setMatchedIds] = useState<string[]>([]);

  const allCards = useMemo(() => [...myTasks, ...queue], [myTasks, queue]);
  const scanRefs: OperationRef[] = useMemo(
    () =>
      allCards
        .filter((card) => card.number)
        .map((card) => ({
          kind: card.kind,
          id: card.id,
          number: card.number,
          href: card.href,
          productIds: card.productIds,
        })),
    [allCards],
  );

  // Fokus selalu kembali ke kotak pindai sesudah interaksi selesai —
  // staf bekerja berdiri dengan pemindai di tangan.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function focusScan() {
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  async function resolve(rawCode: string) {
    const value = rawCode.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage(null);
    setMatchedIds([]);

    const byNumber = resolveOperationScan(value, scanRefs, null);
    if (byNumber.type === "open") {
      playScanSuccessTone();
      toast.success(`Membuka ${byNumber.operation.number}…`);
      router.push(byNumber.operation.href);
      return;
    }

    // Bukan nomor dokumen: coba sebagai barcode/SKU produk.
    const search = await searchInventoryProductsAction(value);
    setBusy(false);
    if (search.ok) {
      const exact =
        search.data.find((row) => row.barcode === value) ??
        search.data.find((row) => row.sku === value);
      if (exact) {
        const byProduct = resolveOperationScan(value, scanRefs, { id: exact.id });
        if (byProduct.type === "open") {
          playScanSuccessTone();
          toast.success(
            `${exact.name} termuat di ${byProduct.operation.number} — membuka operasinya…`,
          );
          router.push(byProduct.operation.href);
          return;
        }
        if (byProduct.type === "matches") {
          playScanSuccessTone();
          setMatchedIds(byProduct.operations.map((operation) => operation.id));
          setMessage(
            `${exact.name} termuat di ${byProduct.operations.length} operasi yang menunggu — pilih kartunya di bawah.`,
          );
          setCode("");
          focusScan();
          return;
        }
        playScanErrorTone();
        setMessage(
          `${exact.name} tidak termuat di operasi mana pun yang sedang menunggu.`,
        );
        setCode("");
        focusScan();
        return;
      }
    }
    playScanErrorTone();
    setMessage(
      `Kode "${value}" tidak dikenal — bukan nomor dokumen yang menunggu, bukan barcode/SKU produk.`,
    );
    setCode("");
    focusScan();
  }

  return (
    <div className="space-y-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void resolve(code);
        }}
        className="rounded-lg border border-primary/40 bg-card p-4"
      >
        <label className="flex items-center gap-2 text-[13px] font-semibold">
          <ScanBarcode className="size-4 text-primary" />
          Pindai dokumen / produk
        </label>
        <div className="mt-2 flex gap-2">
          <input
            ref={inputRef}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            onKeyDown={(event) => {
              // Klasifikasi ledakan untuk umpan balik: pindaian mesin
              // dinilai pelacak bersama (prasel dokumen); Enter dari
              // manusia tetap memicu resolusi lewat submit form.
              const state = burstRef.current;
              const now = performance.now();
              if (event.key === "Enter") {
                burstScanCode(state, now, "document");
                resetBurst(state);
                return;
              }
              if (event.key.length !== 1) return;
              if (burstExpired(state, now, "document")) resetBurst(state);
              feedBurstChar(state, event.key, now, "document");
            }}
            placeholder="Nomor dokumen (cth. PO-2026-00003), barcode, atau SKU…"
            aria-label="Pindai dokumen atau produk"
            autoComplete="off"
            className="num h-11 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-[15px] outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
          />
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-11 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Mencari…" : "Buka"}
          </button>
        </div>
        {message ? (
          <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-5 text-tone-amber">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {message}
          </p>
        ) : (
          <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
            Pemindai boleh langsung dipakai — kotak ini selalu fokus. Nomor dokumen tercetak
            pada PO, GRN, dan surat jalan transfer.
          </p>
        )}
      </form>

      {myTasks.length > 0 ? (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold">Tugas saya</h2>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {myTasks.map((card) => (
              <OperationCard key={card.id} card={card} matched={matchedIds.includes(card.id)} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-[13px] font-semibold">
          Antrean operasi {allCards.length > 0 ? `(${queue.length})` : ""}
        </h2>
        {queue.length === 0 && myTasks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
            <p className="text-[13px] font-medium">Tidak ada operasi yang menunggu</p>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-muted-foreground">
              Penerimaan dari PO terkirim, transfer yang menunggu diterima, dan tugas opname
              akan tampil di sini sebagai kartu kerja.
            </p>
            {/* A-25 U3 (GDG-10): antrean kosong bukan jalan buntu —
                pekerjaan manual tetap bisa dimulai dari sini tanpa
                berpindah ke sidebar. */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link
                href="/app/gudang/penerimaan"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-[12px] font-medium hover:bg-muted"
              >
                <PackageCheck className="size-4" /> Terima barang
              </Link>
              <Link
                href="/app/gudang/transfer"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-[12px] font-medium hover:bg-muted"
              >
                <Truck className="size-4" /> Transfer stok
              </Link>
              <Link
                href="/app/gudang/opname"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3.5 text-[12px] font-medium hover:bg-muted"
              >
                <ClipboardCheck className="size-4" /> Stok opname
              </Link>
            </div>
          </div>
        ) : queue.length === 0 ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-muted-foreground">
            Antrean umum kosong — hanya tugas Anda yang menunggu di atas.
          </p>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {queue.map((card) => (
              <OperationCard key={card.id} card={card} matched={matchedIds.includes(card.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OperationCard({
  card,
  matched,
}: {
  card: OperationQueueCard;
  matched: boolean;
}) {
  const Icon =
    card.kind === "purchase_order" ? PackageCheck : card.kind === "transfer" ? Truck : ClipboardCheck;
  const overdue = card.dueDate !== null && card.dueDate < todayISO();
  return (
    <Link
      href={card.href}
      className={`group flex min-h-[104px] flex-col justify-between rounded-lg border bg-card p-4 transition-colors hover:border-primary/60 hover:bg-muted/40 ${
        matched ? "border-primary ring-2 ring-primary/30" : "border-border"
      } ${card.mine ? "border-l-4 border-l-tone-amber" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2 text-[13px] font-semibold leading-5">
          <Icon className="size-4 shrink-0 text-primary" />
          {card.title}
        </span>
        <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-1.5 text-[12px] leading-5 text-muted-foreground">{card.detail}</p>
      {card.dueDate ? (
        <p
          className={`mt-2 text-[11px] font-medium ${
            overdue ? "text-destructive" : "text-muted-foreground"
          }`}
        >
          {overdue ? `Lewat target ${formatDate(card.dueDate)}` : `Target selesai ${formatDate(card.dueDate)}`}
        </p>
      ) : null}
      {matched ? (
        <p className="mt-2 text-[11px] font-semibold text-primary">
          Memuat produk yang dipindai
        </p>
      ) : null}
    </Link>
  );
}
