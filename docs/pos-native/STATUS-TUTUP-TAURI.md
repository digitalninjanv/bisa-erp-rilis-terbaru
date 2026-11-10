# Status Tutup — POS Native Tauri v2 (Langkah 1–8 SELESAI, 2026-11-07)

Program dibangun berurutan dari RENCANA-TAURI.md (keputusan D1–D8) sesudah riset dua putaran. Gerbang penutup diverifikasi ulang Pemimpin dari reseed bersih: **suite 1898/1898 (201 berkas) exit 0, ekspor statis desktop exit 0**; per langkah: e2e 22/22, typecheck/lint/build 0, harness Rust akhir **59/59**, test API perangkat **15/15** lewat route sungguhan.

## Per langkah
1. **Kerangka** (`8f6095e`): src-tauri v2 (id.bisa.pos, capabilities deny-by-default), ekspor statis POS-only, /api/pos/snapshot+sync berbagi logika web.
2. **DB lokal Rust**: rusqlite; record_sale satu transaksi (rollback teruji); WAL.
3–4. **Snapshot delta + mesin sinkron Rust** (`01b4155`): kursor DB, tombstone dari audit, drain thread Rust, token keluar dari JS (device.json 0600), sesi kas lokal buta + intent.
5. **Cetak ESC/POS** (`aff83ba`): byte dari Rust, laci hanya tunai, print_jobs dalam transaksi penjualan, byte emas + listener TCP palsu terbukti.
6. **Pairing + keychain** (`ffc97d7`): migrasi 0060 registry terminal, kode QR sekali pakai TTL 15 mnt, token env dibuang, keyring OS via trait (fallback berkas 0600 berstatus), snapshot membawa identitas + direktori nama (struk menampilkan nama), intent sesi tercatat sbg peninjauan tanpa jurnal kedua.
7. **Updater** (`9cb49ab`): migrasi 0061, endpoint dinamis per terminal (rollout bucket deterministik; mandatory di bawah versi minimum), kunci minisign TERBUKTI sign→verify; privat di luar repo `~/workspace/pos-native-keys/`; skrip rilis berhenti bersih tanpa GTK; RUNBOOK-RILIS + workflow CI tauri-action siap.
8. **Kios + layar pelanggan** (`8f85a8d`): deploy/kiosk (setup/check/teardown teruji bash -n + dry-run), RUNBOOK-KIOS, jendela kedua ber-capability minimal, displaymap murni teruji, rute /display terexport.

## Yang BELUM terbukti — utang bukti lapangan (jujur, tidak ditutupi)
- **Bundel installer (.deb/.AppImage/NSIS) belum pernah dihasilkan dan jendela aplikasi belum pernah terbuka**: VM pengembangan tidak memiliki pustaka sistem GTK/WebKitGTK; crate Tauri penuh tidak terkompilasi di sini. Yang terbukti: seluruh logika Rust murni via harness berkas-sama (59 test), seluruh kontrak server via HTTP, dan ekspor statis. Pembuktian pertama = menjalankan workflow CI (`.github/workflows/pos-desktop-release.yml`, butuh remote git) atau build di mesin Ubuntu 22.04.
- **Perangkat fisik belum tersentuh**: printer ESC/POS sungguhan (byte terbukti sampai listener TCP lokal), keychain OS sungguhan (abstraksi + mock terbukti; fallback berkas terbukti), layar kedua belum pernah tampil.
- **Skrip kios belum dijalankan** terhadap mesin sungguhan (bash -n + dry-run + check read-only saja).

## Tindakan pemilik di dunia nyata
1. **Cadangkan kunci privat updater** (`~/workspace/pos-native-keys/`, ikuti README-KUSTODI di folder itu) — kehilangan kunci = armada tidak bisa diperbarui selamanya.
2. Keputusan: remote git + CI (membuka pembuktian bundel), sertifikat Authenticode Windows (tanpanya ada peringatan SmartScreen awal), kanal Linux utama (AppImage bisa auto-update; .deb tidak).
3. Uji lapangan pertama mengikuti RUNBOOK-KIOS di satu komputer kasir + printer jaringan.

## Sisa terjadwal di luar program ini
Paket bersama `pos-ui/pos-core/pos-platform` (D2) belum dibentuk (desktop memakai aplikasi Next terpisah + alias tipe — fungsional); cetak USB (saat ini TCP 9100); kontrak intent sesi sudah hidup (langkah 6). Keputusan pemilik lama A-24/A-28 tidak berubah oleh program ini.
