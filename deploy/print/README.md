# Cetak Otomatis POS

Browser biasa **tidak bisa memilih printer sendiri** dan selalu membuka dialog cetak. Untuk mencetak langsung ke printer thermal/default tanpa dialog, jalankan POS dengan Chrome/Edge flag:

```bash
--kiosk-printing
```

## Windows

1. Set printer thermal sebagai **printer default** di Windows.
2. Tanpa argumen, `bisa-pos-print.bat` membuka alamat LAN server `http://192.168.18.253:3000/app/pos`. Ganti IP di dalam berkas bila alamat server berubah, atau jalankan:
   ```bat
   bisa-pos-print.bat http://192.168.18.253:3000/app/pos
   ```
3. Login sekali pada jendela POS yang terbuka (sesi tersimpan di profil khusus `BisaPosPrint`).
4. Setelah transaksi, nota otomatis dicetak dan halaman kembali ke kasir.

## Linux

```bash
chmod +x bisa-pos-print.sh
./bisa-pos-print.sh http://192.168.18.253:3000/app/pos
```

Atur printer thermal sebagai default CUPS:

```bash
lpstat -p -d
lpoptions -d NAMA_PRINTER
```

## Catatan

- `--kiosk-printing` hanya bekerja di Chromium/Chrome/Edge, bukan Firefox.
- Untuk printer jaringan ESC/POS (TCP 9100), gunakan **POS Desktop Tauri** yang sudah punya pengaturan `printer.json` (host/port/lebar kertas) dan mencetak native.
- Jika printer tidak terdeteksi, cek driver dan printer default OS, lalu lakukan satu transaksi uji atau cetak ulang nota dari Riwayat POS.
- Auto-print halaman nota menunggu font siap, lalu kembali ke `/app/pos` setelah dialog cetak selesai (`afterprint`).
