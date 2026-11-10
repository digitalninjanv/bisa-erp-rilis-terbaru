# Runbook Rilis Bisa POS Desktop (Tauri v2 — Langkah 7, D4)

Prosedur menerbitkan pembaruan aplikasi desktop POS: dari build bertanda tangan sampai terminal memasangnya sendiri saat tutup shift. Baca juga `RENCANA-TAURI.md` (keputusan D4/D8) dan `~/workspace/pos-native-keys/README-KUSTODI.md` (kustodi kunci — folder itu DI LUAR repo).

## Gambaran alur

```
mesin build ber-GTK / CI ──build+sign──► direktori rilis server (BISA_POS_RELEASE_DIR)
                                                │  berkas kanonis + .sig + manifest.json
admin web (POS → Terminal desktop) ──tetapkan versi + rollout% + versi minimum──► tabel pos_desktop_release_settings (per perusahaan)
terminal (Rust) ──GET /api/pos/update/:target/:arch/:version (token perangkat)──► 204 / dokumen updater
terminal ──unduh di latar──► gerbang sesi kas ──► pasang + mulai ulang
```

Keputusan penawaran bersifat **per terminal & per perusahaan**: rollout adalah bucket deterministik hash(perusahaan, terminal, versi) melawan persen rollout; terminal di bawah **versi minimum** selalu ditawari (bendera `mandatory` di dokumen updater) tanpa memandang rollout.

## 1. Kustodi kunci penandatanganan (BACA DULU)

- Pasangan kunci minisign dibuat 2026-11-07 (`pnpm tauri signer generate`) dan tersimpan di **`~/workspace/pos-native-keys/`** (di luar repo, izin 0600): `bisa-pos-updater.key` (privat, terenkripsi kata sandi), `bisa-pos-updater.key.password`, `bisa-pos-updater.key.pub` (publik; isinya juga tertanam di `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`).
- Penandatanganan updater Tauri **wajib dan tidak bisa dimatikan**. **Kehilangan kunci privat atau kata sandinya = seluruh armada terminal tidak bisa diperbarui lagi** — satu-satunya pemulihan adalah pemasangan manual build berkunci baru di setiap komputer kasir.
- **Tugas pemilik**: cadangkan ketiga berkas itu ke ≥2 tempat terpisah (brankas kata sandi perusahaan + media luring) dan catat penyalinannya di README kustodi. Jangan pernah menyalinnya ke repo — `.gitignore` menolak pola `*.key`, tetapi pertahanan utama adalah folder ini tetap di luar repo.
- CI memakai secret repo `TAURI_SIGNING_PRIVATE_KEY` (isi berkas kunci) + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Isi secret dari folder kustodi, jangan buat kunci baru — kunci baru tidak cocok dengan pubkey yang sudah tertanam di armada.

## 2. Prasyarat mesin build

Build desktop **tidak bisa** di VM pengembangan biasa (butuh pustaka sistem GTK/WebKitGTK). Pilihan:

- **CI (disarankan)**: `.github/workflows/pos-desktop-release.yml` — matriks `ubuntu-22.04` + `windows-latest` via `tauri-action`, memuat secret di atas, menghasilkan bundel bertanda tangan sebagai artefak workflow + draft release.
- **Mesin lokal ber-GTK**: Ubuntu 22.04 (lantai D8 — WebKitGTK 4.1 ≈ Safari 16) dengan `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libsoup-3.0-dev`, Rust stable, Node 22 + pnpm.

Di mesin tanpa GTK, `scripts/release-pos-desktop.sh` berhenti di prasyarat dengan pesan jelas — itu perilaku yang benar, bukan kerusakan.

## 3. Menerbitkan rilis

1. Pastikan gerbang repo hijau (suite, typecheck, lint, build, e2e, ekspor statis) — updater menyebarkan apa pun yang ter-build, termasuk bug.
2. Jalankan `scripts/release-pos-desktop.sh <versi-baru>` (atau tanpa argumen untuk versi saat ini). Skrip:
   - menaikkan & menyinkronkan versi dari satu sumber (`tauri.conf.json` → `Cargo.toml` + `pos-desktop/package.json`);
   - memuat kunci dari env atau folder kustodi;
   - memeriksa prasyarat platform (GTK di Linux);
   - `pnpm tauri build` dengan konfigurasi platform (`tauri.linux.conf.json` / `tauri.windows.conf.json`) — `createUpdaterArtifacts` menghasilkan `.sig` di samping setiap bundel;
   - menyalin artefak ke direktori rilis dengan **nama kanonis** + menulis `manifest.json`:
     - `bisa-pos_linux-x86_64.AppImage` (+ `.sig`) — satu-satunya jalur updater Linux (D4: .deb tidak memperbarui diri; `.deb` ikut disalin untuk pemasangan manual);
     - `bisa-pos_linux-aarch64.AppImage` (+ `.sig`) bila dibuild di ARM;
     - `bisa-pos_windows-x86_64-setup.exe` (+ `.sig`) — NSIS, jangan campur MSI.
3. Direktori rilis ditentukan env server **`BISA_POS_RELEASE_DIR`** (bawaan skrip: `~/workspace/pos-releases`). Server ERP membaca direktori yang sama saat melayani endpoint updater; direktori ini di luar repo dan tidak di-commit.
4. **Aktifkan penawaran** di web: POS → Terminal desktop → panel **Rilis aplikasi desktop** (gerbang supervisor `pos.void`): tetapkan versi yang sama, rollout awal kecil (mis. 10%), versi minimum bila rilis ini memuat perbaikan yang memaksa. Endpoint **tidak menawarkan** versi yang artefaknya belum ada/.sig-nya hilang di direktori rilis (menjawab 204) — menaikkan versi di panel sebelum artefak terbit aman.
5. Naikkan rollout bertahap (10% → 50% → 100%) sambil memantau `last_seen_at` terminal dan laporan kasir. Bucket deterministik: terminal yang masuk gelombang tidak akan keluar lagi untuk versi itu.

## 4. Perilaku terminal (agar operator tidak bingung)

- Pemeriksaan: saat aplikasi mulai, lalu tiap ±6 jam, hanya sesudah terminal terpasang. Endpoint dibangun runtime dengan header token perangkat (Rust) — token tidak pernah masuk webview.
- Unduhan berjalan di latar selama shift; **pemasangan menunggu semua sesi kas lokal tertutup**, lalu aplikasi mulai ulang sendiri (Linux/macOS) / pemasang NSIS mengambil alih (Windows).
- Kasir dapat memaksa lewat panel Pembaruan di aplikasi desktop: "Periksa pembaruan" dan "Pasang sekarang" (perintah eksplisit boleh mendahului gerbang sesi).
- Versi di bawah minimum server ditandai **WAJIB** di panel terminal.
- **HTTPS**: plugin updater menolak endpoint non-HTTPS pada build rilis. Server produksi harus disajikan lewat HTTPS; untuk uji LAN HTTP murni, pemeriksaan akan gagal dengan fase `failed` yang terlihat — itu disengaja oleh Tauri, jangan matikan verifikasinya di konfigurasi produksi.

## 5. Rollback

Updater Tauri **tidak mendukung turun versi** (pemeriksaan hanya menerima versi lebih besar). Rollback = **terbitkan ulang kode lama sebagai versi yang lebih tinggi**:

1. Checkout commit/tag rilis baik terakhir.
2. Naikkan versi melampaui versi bermasalah (mis. bermasalah `1.3.0` → terbitkan kode lama sebagai `1.3.1`).
3. Build + tanda tangani + salin artefak seperti biasa (kunci yang sama).
4. Tetapkan `1.3.1` di panel rilis dengan rollout 100% (dan versi minimum `1.3.1` bila armada harus segera keluar dari `1.3.0`).

Migrasi DB lokal terminal hanya aditif (aturan RENCANA), sehingga kode lama yang diterbitkan ulang tetap membaca DB lokal yang ditulis versi bermasalah — verifikasi kompatibilitas ini adalah bagian dari uji rollback, bukan asumsi.

## 6. Pemecahan masalah

| Gejala | Sebab yang mungkin |
| --- | --- |
| Semua terminal menjawab 204 terus | Versi di panel belum ditetapkan / artefak atau `.sig` belum ada di `BISA_POS_RELEASE_DIR` / rollout 0% dan terminal di atas minimum / versi terminal sudah sama |
| Sebagian terminal tidak ditawari | Rollout bertahap — periksa bucket: naikkan persen rollout; deterministik per (perusahaan, terminal, versi) |
| Pemeriksaan `failed` di panel desktop | Server tak terjangkau, token dicabut (401 menghentikan mesin sampai pasangan baru), atau endpoint HTTP pada build rilis (wajib HTTPS) |
| Unduhan selesai tetapi tidak terpasang | Sesi kas lokal masih terbuka — tutup sesi, atau kasir menekan "Pasang sekarang" |
| Build CI gagal menandatangani | Secret `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)` belum diisi / tidak cocok dengan pubkey tertanam |
| `tauri build` gagal di mesin lokal | Prasyarat GTK absen — pakai CI atau mesin Ubuntu 22.04 (butir 2) |

## 7. Yang belum termasuk (keputusan pemilik tertunda)

- Penandatanganan kode Windows (Authenticode) terpisah dari tanda tangan updater: tanpa itu, pemasangan NSIS pertama menampilkan peringatan SmartScreen. Pilihan & biaya tercatat di RENCANA-TAURI (Azure Artifact Signing / OV / EV) — keputusan pemilik.
- Kanal distribusi awal Linux: AppImage adalah jalur updater; `.deb` untuk pemasangan terkelola manual (rekomendasi riset: AppImage utama).
