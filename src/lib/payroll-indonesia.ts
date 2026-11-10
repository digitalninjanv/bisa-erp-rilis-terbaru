/**
 * Fasad kompatibilitas (A-26 Q9, K-09/§4 audit kualitas kode).
 *
 * Definisi berkas ini berpindah ke "@/lib/payroll/payroll-indonesia" agar
 * kepemilikan domain di lib/ terlihat dari strukturnya (grup
 * HR & payroll). Jalur lama "@/lib/payroll-indonesia" dipertahankan sebagai
 * re-export murni supaya seluruh pemanggil yang ada tidak berubah;
 * kode baru diarahkan mengimpor dari folder grupnya. Jangan menambah
 * definisi di sini.
 */
export * from "@/lib/payroll/payroll-indonesia";
