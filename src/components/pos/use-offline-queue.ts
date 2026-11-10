import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { syncOfflineSalesAction } from "@/server/actions/pos-offline";
import {
  applySyncResults,
  countQueued,
  getBrowserOfflineStorage,
  type OfflineSyncItemResult,
} from "@/lib/pos-offline";

// FIX-ARS Tahap 5 (ARS2-01): hook antrean offline — status koneksi,
// jumlah antrean lokal, dan sinkronisasi berpotong 25 item; diekstrak
// apa adanya dari PosTerminal (pemicu mount & online dipertahankan).
export function useOfflineQueue(params: { posOfflineEnabled: boolean }) {
  const { posOfflineEnabled } = params;
  const router = useRouter();
  // SIM-2 S7B-2 Batch 6: keadaan mode offline — status koneksi browser,
  // jumlah antrean lokal (IndexedDB), dan proses sinkronisasi.
  const [online, setOnline] = useState<boolean>(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  const [queuedCount, setQueuedCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  // SIM-2 S7B-2 Batch 6: sinkronisasi antrean offline — mengirim semua
  // item ke aksi server (jalur checkout normal + kunci idempotensi),
  // lalu menerapkan hasilnya ke antrean lokal.
  const syncOfflineQueue = useCallback(async () => {
    if (!posOfflineEnabled || syncing) return;
    const storage = getBrowserOfflineStorage();
    const items = await storage.list();
    if (items.length === 0) {
      setQueuedCount(0);
      return;
    }
    setSyncing(true);
    try {
      // FIX-POS Tahap 2 (POS3-01/16): antrean dikirim BERPOTONG 25
      // item per panggilan — plafon server adalah per request, bukan
      // per antrean, jadi antrean sebesar apa pun tersinkron; hasil
      // tiap potong langsung diterapkan sebelum potong berikutnya.
      const allResults: OfflineSyncItemResult[] = [];
      let chunkFailed = false;
      for (let offset = 0; offset < items.length; offset += 25) {
        const result = await syncOfflineSalesAction({ items: items.slice(offset, offset + 25) });
        if (!result.ok) {
          toast.error(result.message);
          chunkFailed = true;
          break;
        }
        await applySyncResults(storage, result.data);
        allResults.push(...result.data);
        setQueuedCount(await countQueued(storage));
      }
      if (chunkFailed && allResults.length === 0) return;
      const synced = allResults.filter((row) => row.status === "synced").length;
      const duplicates = allResults.filter((row) => row.status === "duplicate").length;
      const conflicts = allResults.filter((row) => row.status === "conflict").length;
      const failed = allResults.filter((row) => row.status === "failed").length;
      if (synced + duplicates > 0) {
        toast.success(
          `Sinkronisasi offline: ${synced} penjualan tercatat${duplicates ? `, ${duplicates} duplikat dilewati` : ""}.`,
        );
      }
      if (conflicts + failed > 0) {
        toast.warning(
          `${conflicts + failed} penjualan belum tuntas (${conflicts} konflik stok, ${failed} gagal) — lihat menu Peninjauan offline.`,
        );
      }
      router.refresh();
    } catch {
      toast.error("Sinkronisasi offline gagal. Periksa koneksi lalu coba lagi.");
    } finally {
      setSyncing(false);
    }
  }, [posOfflineEnabled, syncing, router]);

  useEffect(() => {
    if (!posOfflineEnabled) return;
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    void (async () => {
      setQueuedCount(await countQueued(getBrowserOfflineStorage()));
      if (navigator.onLine) void syncOfflineQueue();
    })();
    const onOnline = () => {
      setOnline(true);
      void syncOfflineQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // syncOfflineQueue sengaja tidak menjadi dependensi: identitasnya
    // berubah bersama state syncing; pemicu online & mount yang dipakai.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posOfflineEnabled]);

  return { online, queuedCount, setQueuedCount, syncing, syncOfflineQueue };
}
