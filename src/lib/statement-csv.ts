/**
 * Fasad kompatibilitas (A-26 Q9, K-09/§4 audit kualitas kode).
 *
 * Definisi berkas ini berpindah ke "@/lib/akuntansi/statement-csv" agar
 * kepemilikan domain di lib/ terlihat dari strukturnya (grup
 * akuntansi). Jalur lama "@/lib/statement-csv" dipertahankan sebagai
 * re-export murni supaya seluruh pemanggil yang ada tidak berubah;
 * kode baru diarahkan mengimpor dari folder grupnya. Jangan menambah
 * definisi di sini.
 */
export * from "@/lib/akuntansi/statement-csv";
