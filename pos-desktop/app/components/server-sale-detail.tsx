"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { ServerSaleDetailResponse } from "../../lib/pos-bridge";
import { formatIDR, formatQtyLabel } from "../../lib/pos-native-format";

type ServerSaleHistoryDetailProps = {
  response: ServerSaleDetailResponse;
  loading: boolean;
  busy: boolean;
  returnQtyByLine: Record<string, string>;
  setReturnQtyByLine: Dispatch<SetStateAction<Record<string, string>>>;
  returnReason: string;
  setReturnReason: (value: string) => void;
  returnMethod: "cash" | "transfer" | "store_credit" | "exchange";
  setReturnMethod: (value: "cash" | "transfer" | "store_credit" | "exchange") => void;
  returnDisposition: "sellable" | "write_off";
  setReturnDisposition: (value: "sellable" | "write_off") => void;
  voidReason: string;
  setVoidReason: (value: string) => void;
  voidArmed: boolean;
  setVoidArmed: (value: boolean) => void;
  onBack: () => void;
  onRefresh: () => void;
  onReprint: () => void;
  onReturn: () => void;
  onVoid: () => void;
};

export function ServerSaleHistoryDetail({
  response,
  loading,
  busy,
  returnQtyByLine,
  setReturnQtyByLine,
  returnReason,
  setReturnReason,
  returnMethod,
  setReturnMethod,
  returnDisposition,
  setReturnDisposition,
  voidReason,
  setVoidReason,
  voidArmed,
  setVoidArmed,
  onBack,
  onRefresh,
  onReprint,
  onReturn,
  onVoid,
}: ServerSaleHistoryDetailProps) {
  const [armedReturnResponse, setArmedReturnResponse] = useState<ServerSaleDetailResponse | null>(null);
  const returnArmed = armedReturnResponse === response;
  const { detail, permissions } = response;
  const { sale } = detail;
  const isCompleted = sale.status === "completed";
  const canReturn = permissions.canReturn && isCompleted;
  const canVoid = permissions.canVoid && isCompleted;
  const returnEstimate = detail.lines.reduce((total, line) => {
    const qty = Number(returnQtyByLine[line.id] ?? 0);
    const originalQty = Number(line.qtyInput);
    return total + (qty > 0 && originalQty > 0 ? (Number(line.lineTotal) / originalQty) * qty : 0);
  }, 0);
  const selectedReturnQty = detail.lines.some((line) => Number(returnQtyByLine[line.id] ?? 0) > 0);
  const invalidReturnQty = detail.lines.some((line) => {
    const qty = Number(returnQtyByLine[line.id] ?? 0);
    return !Number.isFinite(qty) || qty < 0 || qty > line.remainingQtyInput;
  });
  const saleDate = new Date(sale.createdAt);
  const saleDateLabel = Number.isNaN(saleDate.getTime())
    ? sale.date
    : saleDate.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });

  return (
    <section className="server-sale-detail" aria-label={`Detail transaksi ${sale.number}`}>
      <div className="server-sale-detail-toolbar">
        <button type="button" onClick={onBack} className="history-back-button">‹ Kembali ke riwayat</button>
        <div className="server-sale-detail-toolbar-actions">
          {loading ? <span role="status">Memuat detail…</span> : null}
          <button
            type="button"
            className="history-back-button"
            onClick={onRefresh}
            disabled={busy || loading}
          >
            Muat ulang status
          </button>
          <button
            type="button"
            className="history-back-button"
            onClick={onReprint}
            disabled={busy || loading || !["completed", "returned"].includes(sale.status)}
          >
            {busy ? "Mengirim nota…" : "Cetak salinan nota"}
          </button>
        </div>
      </div>
      <div className="server-sale-detail-heading">
        <div>
          <p className="eyebrow">NOTA SERVER</p>
          <h3>{sale.number}</h3>
          <p>{saleDateLabel} · {detail.cashier?.name ?? "Kasir tidak diketahui"}</p>
        </div>
        <div className="server-sale-detail-total">
          <span>Total transaksi</span>
          <strong>{formatIDR(Number(sale.total))}</strong>
          <span>{sale.status === "completed" ? "Selesai" : sale.status === "returned" ? "Diretur penuh" : sale.status === "void" ? "Dibatalkan" : sale.status}</span>
        </div>
      </div>

      <div className="server-sale-detail-grid">
        <section className="server-sale-card">
          <h4>Ringkasan</h4>
          <dl>
            <div><dt>Pelanggan</dt><dd>{detail.customer?.name ?? "Pelanggan umum"}</dd></div>
            {detail.customer?.phone ? <div><dt>Telepon</dt><dd>{detail.customer.phone}</dd></div> : null}
            <div><dt>Status pembayaran</dt><dd>{sale.paymentStatus === "paid" ? "Lunas" : sale.paymentStatus === "partial" ? "Sebagian" : "Belum lunas"}</dd></div>
            <div><dt>Sudah dibayar</dt><dd>{formatIDR(Number(sale.paidTotal))}</dd></div>
          </dl>
        </section>
        <section className="server-sale-card">
          <h4>Pembayaran</h4>
          {detail.payments.length > 0 ? (
            <ul className="server-sale-payments">
              {detail.payments.map((payment) => (
                <li key={payment.id}>
                  <span>{payment.methodName ?? "Metode pembayaran"}{payment.reference ? ` · ${payment.reference}` : ""}</span>
                  <strong>{formatIDR(Number(payment.amount))}</strong>
                </li>
              ))}
            </ul>
          ) : <p className="muted">Belum ada pembayaran tercatat.</p>}
        </section>
      </div>

      <section className="server-sale-card server-sale-lines-card">
        <div className="server-sale-section-heading">
          <div><h4>Barang pada nota</h4><p>Jumlah dan nilai retur dihitung dari kemasan pada transaksi asal.</p></div>
          {canReturn ? <span className="server-sale-action-hint">Isi jumlah untuk retur parsial</span> : null}
        </div>
        <ul className="server-sale-lines">
          {detail.lines.map((line) => (
            <li key={line.id}>
              <div className="server-sale-line-name">
                <strong>{line.productName}</strong>
                <span>{line.productSku ? `${line.productSku} · ` : ""}{line.packagingName ?? "Satuan dasar"}</span>
              </div>
              <div className="server-sale-line-value"><span>Terjual</span><strong>{formatQtyLabel(Number(line.qtyInput))}</strong></div>
              <div className="server-sale-line-value"><span>Harga</span><strong>{formatIDR(Number(line.unitPrice) * (Number(line.isiSnapshot) || 1))}</strong></div>
              <div className="server-sale-line-value"><span>Subtotal</span><strong>{formatIDR(Number(line.lineTotal))}</strong></div>
              {canReturn ? (
                <label className="server-sale-return-qty">
                  Kuantitas retur
                  <small>Sisa {formatQtyLabel(line.remainingQtyInput)} dari {formatQtyLabel(Number(line.qtyInput))}</small>
                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={line.remainingQtyInput}
                    step="0.001"
                    value={returnQtyByLine[line.id] ?? ""}
                    aria-label={`Jumlah retur ${line.productName}, maksimal ${formatQtyLabel(line.remainingQtyInput)}`}
                    disabled={busy || line.remainingQtyInput <= 0}
                    onChange={(event) => {
                      setArmedReturnResponse(null);
                      setReturnQtyByLine((current) => ({ ...current, [line.id]: event.target.value }));
                    }}
                  />
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="server-sale-card server-sale-return-history" aria-labelledby="server-sale-returns-title">
        <div className="server-sale-section-heading">
          <div>
            <h4 id="server-sale-returns-title">Riwayat retur</h4>
            <p>Dokumen retur dan nilai penyelesaiannya tercatat dari server.</p>
          </div>
          <span>{detail.returns.length} dokumen</span>
        </div>
        {detail.returns.length === 0 ? (
          <p className="muted">Belum ada retur untuk nota ini.</p>
        ) : (
          <ul className="server-sale-return-list">
            {detail.returns.map((returnDocument) => {
              const methodLabel: Record<string, string> = {
                cash: "Tunai sesuai alokasi tender asal",
                transfer: "Metode tercatat: transfer",
                store_credit: "Kredit pelanggan",
                exchange: "Kredit untuk barang pengganti",
              };
              const dispositionLabel = returnDocument.disposition === "write_off" ? "Rusak · tidak masuk stok" : "Layak jual · masuk stok";
              const createdAt = new Date(returnDocument.createdAt);
              const createdAtLabel = Number.isNaN(createdAt.getTime())
                ? returnDocument.date
                : createdAt.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
              return (
                <li key={returnDocument.id}>
                  <div className="server-sale-return-heading">
                    <div>
                      <strong>{returnDocument.number}</strong>
                      <span>{createdAtLabel} · {returnDocument.type === "exchange" ? "Tukar barang" : "Retur"}</span>
                    </div>
                    <strong>{formatIDR(Number(returnDocument.total))}</strong>
                  </div>
                  <p>{returnDocument.lines.map((line) => `${line.productName} × ${formatQtyLabel(Number(line.qtyInput))}`).join(" · ") || "Rincian barang tidak tersedia"}</p>
                  <div className="server-sale-return-meta">
                    <span>{methodLabel[returnDocument.refundMethod] ?? `Metode: ${returnDocument.refundMethod}`}</span>
                    <span>{dispositionLabel}</span>
                    {returnDocument.refundMethod === "cash" ? <span>Keluar laci {formatIDR(Number(returnDocument.cashRefunded))}</span> : null}
                    {returnDocument.refundMethod === "transfer" ? <span>Nilai dokumen {formatIDR(Number(returnDocument.total))} · konfirmasi transfer di bank</span> : null}
                    {["store_credit", "exchange"].includes(returnDocument.refundMethod) ? (
                      <>
                        <span>Kredit terpakai {formatIDR(Number(returnDocument.creditUsed))}</span>
                        <span>Sisa kredit {formatIDR(Math.max(0, Number(returnDocument.total) - Number(returnDocument.creditUsed)))}</span>
                      </>
                    ) : null}
                  </div>
                  <small>Alasan: {returnDocument.reason}</small>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {canReturn ? (
        <section className="server-sale-action-card" aria-labelledby="server-return-title">
          <div className="server-sale-section-heading">
            <div><h4 id="server-return-title">Retur penjualan</h4><p>Retur sebagian atau penuh hanya untuk barang yang masih tersisa pada nota asal.</p></div>
            {selectedReturnQty ? <strong className="server-sale-estimate">Perkiraan nilai barang: {formatIDR(returnEstimate)}</strong> : null}
          </div>
          <div className="server-sale-action-fields">
            <label className="field">
              Cara penyelesaian
              <select value={returnMethod} disabled={busy} onChange={(event) => { setArmedReturnResponse(null); setReturnMethod(event.target.value as ServerSaleHistoryDetailProps["returnMethod"]); }}>
                <option value="cash">Refund tunai</option>
                <option value="transfer">Refund transfer</option>
                <option value="store_credit">Kredit pelanggan</option>
                <option value="exchange">Kredit untuk transaksi pengganti</option>
              </select>
            </label>
            <label className="field">
              Kondisi barang kembali
              <select value={returnDisposition} disabled={busy} onChange={(event) => { setArmedReturnResponse(null); setReturnDisposition(event.target.value as ServerSaleHistoryDetailProps["returnDisposition"]); }}>
                <option value="sellable">Layak jual — kembalikan ke stok</option>
                <option value="write_off">Rusak — jangan tambah stok</option>
              </select>
            </label>
            <label className="field server-sale-reason-field">
              Alasan retur
          <textarea value={returnReason} maxLength={300} rows={2} placeholder="Contoh: barang rusak atau salah beli" disabled={busy} onChange={(event) => { setArmedReturnResponse(null); setReturnReason(event.target.value); }} />
            </label>
          </div>
          <p className="history-note">
            {returnMethod === "exchange"
              ? "Kredit retur akan dicatat pada dokumen asal. Barang pengganti dibuat sebagai transaksi penjualan baru, lalu dibayar memakai Kredit pelanggan dan nomor dokumen retur ini."
              : returnMethod === "cash"
                ? "Refund tunai memakai alokasi pembayaran asal dan memerlukan sesi kas terbuka. Stok, nilai retur, dan jurnal dihitung ulang server."
                : returnMethod === "transfer"
                  ? "Refund transfer dicatat pada retur; pastikan pengembalian dana benar-benar dilakukan melalui bank. Nilai dan jurnal dihitung ulang server."
                  : "Kredit ini dapat digunakan pada transaksi berikutnya melalui metode pembayaran Kredit pelanggan."}
          </p>
          {returnArmed ? (
                    <div className="server-sale-return-confirm" role="group" aria-label="Ringkasan konfirmasi retur">
              <div>
                <strong>Periksa sebelum menyimpan retur</strong>
                <span>{detail.lines.filter((line) => Number(returnQtyByLine[line.id] ?? 0) > 0).length} baris · perkiraan nilai barang {formatIDR(returnEstimate)}</span>
                <span>Metode: {returnMethod === "exchange" ? "kredit transaksi pengganti" : returnMethod === "store_credit" ? "kredit pelanggan" : returnMethod === "cash" ? "refund tunai" : "refund transfer"} · Kondisi: {returnDisposition === "sellable" ? "layak jual" : "rusak"}</span>
                <span>Alasan: {returnReason.trim()}</span>
              </div>
              <button type="button" onClick={onReturn} disabled={busy || !selectedReturnQty || invalidReturnQty || returnReason.trim().length < 3}>
                {busy ? "Memproses…" : "Konfirmasi & proses retur"}
              </button>
              <button type="button" onClick={() => setArmedReturnResponse(null)} disabled={busy}>Kembali mengubah</button>
            </div>
          ) : (
            <div className="server-sale-action-buttons">
              <button type="button" onClick={() => setArmedReturnResponse(response)} disabled={busy || !selectedReturnQty || invalidReturnQty || returnReason.trim().length < 3}>
                Tinjau retur
              </button>
          </div>
          )}
        </section>
      ) : null}

      {canVoid ? (
        <section className="server-sale-action-card server-sale-void-card" aria-labelledby="server-void-title">
          <div className="server-sale-section-heading"><div><h4 id="server-void-title">Batalkan transaksi</h4><p>Void membalik dampak transaksi melalui server dan tidak dapat dibatalkan dari layar ini.</p></div></div>
          <label className="field">
            Alasan void
            <textarea value={voidReason} maxLength={300} rows={2} placeholder="Tuliskan alasan pembatalan" disabled={busy} onChange={(event) => { setVoidReason(event.target.value); setVoidArmed(false); }} />
          </label>
          {voidArmed ? (
            <div className="server-sale-void-confirm" role="alert">
              <p>Pastikan nomor nota dan alasan sudah benar. Stok, kas, piutang, dan jurnal akan disesuaikan oleh server.</p>
              <button type="button" className="danger" onClick={onVoid} disabled={busy || voidReason.trim().length < 3}>{busy ? "Memproses…" : "Ya, void transaksi"}</button>
              <button type="button" onClick={() => setVoidArmed(false)} disabled={busy}>Kembali</button>
            </div>
          ) : (
            <div className="server-sale-action-buttons">
              <button type="button" className="danger" onClick={() => setVoidArmed(true)} disabled={busy || voidReason.trim().length < 3}>Tinjau pembatalan</button>
            </div>
          )}
        </section>
      ) : null}

      {!canReturn && !canVoid ? (
        <p className="history-note">Transaksi ini hanya dapat dilihat. Aksi retur atau void memerlukan transaksi berstatus selesai dan izin POS yang sesuai.</p>
      ) : null}
    </section>
  );
}
