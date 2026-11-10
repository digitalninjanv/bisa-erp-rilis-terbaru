# 08. Daftar Temuan Belum Terverifikasi Penuh

Dokumen ini mencatat temuan atau area pengujian yang belum dapat diverifikasi secara empiris 100% pada lingkungan audit saat ini, disertai alasan objektif dan batasan teknisnya.

---

## 1. Daftar Item Belum Terverifikasi Penuh

| ID Temuan | Area / Fitur | Aspek yang Belum Terverifikasi | Alasan Objektif & Batasan Teknis | Tingkat Keyakinan Dugaan | Langkah Verifikasi Lanjutan yang Disarankan |
| :---: | :--- | :--- | :--- | :---: | :--- |
| **UNV-001** | **Direct ESC/POS Printing** | Pemotongan kertas otomatis (*auto-cutter*) dan cetak karakter ASCII langsung ke printer thermal 58mm/80mm via port USB/Bluetooth raw. | Memerlukan koneksi fisik hardware printer thermal (misal Epson TM-T82 atau printer kasir mini USB) yang tidak tersedia pada runner audit kontainer. Emulasi CSS cetak web telah diaudit. | **Sedang** | Uji coba di terminal fisik toko kasir dengan kertas roll 58mm dan 80mm asli. |
| **UNV-002** | **QRIS Dinamis API / Webhook Live** | Validasi callback webhook penerimaan pembayaran instan QRIS dari bank/penyedia switching (misal Midtrans/Xendit/QRIS MPM). | Endpoint webhook memerlukan IP publik yang dapat diakses internet (*public callback URL*) dan kredensial merchant live yang tidak boleh di-commit di repositori publik. | **Sedang** | Simulasi webhook menggunakan mock payload lokal atau tunneling Ngrok pada sandbox testing. |
| **UNV-003** | **Skalabilitas Database pada Volume 1.000.000 Baris** | Latensi pembacaan Buku Besar dan Kartu Stok pada volume data riil skala enterprise (> 1.000.000 baris `journal_lines` dan `stock_movements`). | Lingkungan saat ini menggunakan database pengujian dengan volume ~10.000 baris. Perilaku locking dan degradasi memory Node.js pada 1 juta baris dihipotesiskan berdasarkan analisis kompleksitas algoritma O(N). | **Tinggi** | Jalankan stress test menggunakan skrip `bench:import` dengan parameter `--bulk` pada instance PostgreSQL berkapasitas produksi. |
| **UNV-004** | **Hardware Barcode Scanner Serial RS-232** | Kompatibilitas scanner barcode serial baud rate 9600 non-keyboard wedge. | Kebanyakan minimarket modern menggunakan scanner USB HID Keyboard Wedge. Mode RS-232 serial membutuhkan driver COM port khusus. | **Rendah** | Cukup rekomendasikan penggunaan scanner mode USB HID standar. |
