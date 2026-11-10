# Panduan Kualitas Kode — Kontrak Wajib untuk AI Agent

Dokumen ini adalah panduan wajib untuk AI Agent saat membangun, mereview,
atau merefactor kode. Semua keputusan arsitektur, struktur kode, dan desain
antarmuka harus mengikuti prinsip di bawah ini.

Ditetapkan oleh pemilik proyek pada 2026-11-06. Program penegakannya: A-26
(audit & refactor terukur terhadap dokumen ini, perilaku aplikasi tidak
berubah).

## 1. Architecture Principles (Prioritas Tertinggi)

### 1.1 Core Rules

- **Dependency Rule:** Dependencies hanya boleh mengarah ke dalam (inward).
  Domain/core tidak boleh tahu tentang framework, database, UI, atau library
  eksternal.
- **High Cohesion + Loose Coupling:** Modul yang saling terkait erat harus
  digabung. Modul yang tidak berhubungan harus longgar.
- **Blast Radius Minimal:** Perubahan pada satu fitur sebaiknya hanya
  menyentuh 1–2 file/folder. Hindari perubahan yang merembet ke banyak
  tempat.
- **Screaming Architecture:** Struktur folder harus berteriak domain bisnis,
  bukan framework. Contoh baik: `features/billing/`, `features/order/`,
  `features/auth/`. Contoh buruk: `controllers/`, `services/`, `models/`,
  `repositories/`.

### 1.2 Preferensi Arsitektur (2025–2026)

- Default: **Modular Monolith + Vertical Slice / Package by Feature**.
- Clean Architecture / Hexagonal hanya digunakan jika domain rules sangat
  kompleks dan lifetime sistem panjang.
- Hindari over-engineering. Mulai sederhana, pecah hanya saat ada kebutuhan
  nyata.

### 1.3 Modul & Boundary

- Setiap modul/domain punya public interface yang jelas (Contracts / Facade).
- Internal module tidak boleh diakses langsung dari luar.
- Data ownership jelas: satu tabel/schema hanya dimiliki satu modul.
- Cross-module communication lewat public API atau event, bukan direct
  import internal class.

### 1.4 Extensibility

- Open for Extension, Closed for Modification (OCP).
- Penambahan fitur baru sebaiknya tidak mengubah kode existing.
- Sediakan extension points yang jelas (interface, strategy, event, plugin)
  bila diperlukan.
- Hindari hard-code yang sulit diganti nanti.

## 2. Code Quality & Maintainability Principles

### 2.1 File & Module Size

- Jangan buat 1 file besar. File harus fokus pada satu concern.
- Fungsi/method harus kecil dan punya Single Responsibility.

### 2.2 Struktur Kode yang Diinginkan

- Package by Feature / Vertical Slice lebih disukai daripada Package by
  Layer.
- Setiap feature sebaiknya punya folder sendiri yang berisi semua yang
  dibutuhkan (handler, request, validator, dll).
- Shared code hanya diekstrak saat duplikasi benar-benar menyakitkan
  (Rule of Three).
- Hindari God Class, God File, Feature Concentration, dan Cyclic Dependency.

### 2.3 Prinsip Kode Inti

- Single Responsibility Principle (SRP) di level class, file, dan modul.
- Kode harus mudah dibaca oleh developer baru dalam waktu singkat.
- Prefer clarity over cleverness. Solusi sederhana dan jelas lebih baik
  daripada solusi pintar tapi sulit dipahami.
- Nama variabel, fungsi, class, dan folder harus ekspresif dan menggunakan
  bahasa domain.
- Hindari magic number, deep nesting, dan long parameter list.
- Error handling harus jelas dan konsisten.
- Kode harus mudah di-test (unit test tanpa spin-up infrastructure sebanyak
  mungkin).

### 2.4 Anti-Bloat & Longevity

- Tolak code bloat. Setiap baris kode harus punya alasan yang kuat.
- Jangan buat abstraksi "jaga-jaga" yang belum dibutuhkan.
- Arsitektur harus evolvable: mudah dikembangkan dalam 2–3 tahun ke depan
  tanpa rewrite besar.
- Gunakan architecture tests / fitness functions bila memungkinkan untuk
  menjaga boundary.

## 3. UI/UX Design Principles

### 3.1 User-Friendly & Mudah Digunakan

- Prioritaskan kemudahan penggunaan di atas estetika semata.
- Alur kerja harus intuitif. User tidak perlu berpikir terlalu keras untuk
  menyelesaikan tugas.
- Berikan feedback yang jelas untuk setiap aksi (loading, success, error).
- Hindari cognitive overload. Tampilkan informasi secara bertahap jika perlu.
- Gunakan bahasa yang sederhana dan mudah dipahami user target.

### 3.2 Responsive & Adaptive

- Desain harus responsif di semua ukuran layar (mobile, tablet, desktop).
- Gunakan pendekatan mobile-first bila memungkinkan.
- Layout harus tetap rapi dan usable di layar kecil maupun besar.
- Touch target minimal 44x44px untuk elemen interaktif di mobile.

### 3.3 Visual Design & Kerapian

- Tampilan harus rapi, bersih, dan konsisten.
- Gunakan spacing, alignment, dan hierarchy visual yang jelas.
- Konsistensi warna, tipografi, icon, dan komponen di seluruh aplikasi.
- Hindari clutter. Whitespace adalah teman.
- Gunakan design system / component library bila sudah ada.

### 3.4 Accessibility & Usability Dasar

- Kontras warna yang cukup.
- Support keyboard navigation bila relevan.
- Error message harus jelas dan membantu user memperbaiki kesalahan.
- Loading state dan empty state harus ditangani dengan baik.
- Jangan biarkan user merasa "tersesat".

### 3.5 Performance Perception

- Loading harus terasa cepat (skeleton, progressive loading, optimistic UI
  bila cocok).
- Hindari layout shift yang mengganggu.
- Interaksi harus terasa responsif (feedback visual segera setelah klik/tap).

## 5. Prioritas Saat Ada Konflik

1. Maintainability & Extensibility (jangka panjang)
2. User Experience (kemudahan & kenyamanan user)
3. Code Clarity (mudah dibaca & diperbaiki)
4. Performance (setelah ketiga di atas terpenuhi)
5. Kecepatan development jangka pendek (jangan mengorbankan 1–3)

## 6. Larangan Keras

- Membuat satu file besar yang berisi banyak concern.
- Membuat abstraksi berlebihan yang belum dibutuhkan.
- Menyusun folder berdasarkan technical layer (controllers, services,
  models) sebagai struktur utama.
- Membuat UI yang tidak responsif atau sulit digunakan.
- Mengubah banyak file hanya untuk menambah satu fitur kecil.
- Code yang "cerdik" tapi sulit dipahami orang lain.

## Catatan untuk Agent

Dokumen ini adalah kontrak. Setiap kali kamu membuat atau mereview kode,
kamu wajib mematuhi prinsip-prinsip di atas. Jika ada trade-off,
prioritaskan maintainability, kemudahan pengembangan, dan pengalaman user
yang baik.
