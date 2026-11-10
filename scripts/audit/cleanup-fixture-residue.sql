-- =====================================================================
-- cleanup-fixture-residue.sql — PEMBERSIHAN SATU KALI residu fixture
-- (AUD-001/AUD-002, Program Audit Produksi tahap A4). Idempoten:
-- menjalankan ulang sesudah bersih menghapus 0 baris.
--
-- KRITERIA perusahaan fixture mati — sama seperti pemeriksaan G4 di
-- scripts/audit/db-integrity.sql (dipakai audit A0):
--   sebuah company_id disebut RESIDU bila ia memegang baris di tabel
--   tenant (kolom company_id) tetapi TIDAK punya baris di tabel
--   `organization`. Perusahaan sah — termasuk demo "Bisa Minimarket"
--   — SELALU punya baris organization, jadi secara struktural tidak
--   bisa tersentuh: setiap DELETE dibatasi
--   `company_id NOT IN (SELECT id FROM organization)`.
--   Residu ini berasal dari teardown test lama yang daftar tabelnya
--   membeku (lihat register AUD-001); akar masalahnya sudah diperbaiki
--   di tests/helpers/wipe-company.ts sehingga residu baru tidak lahir.
--
-- PRASYARAT: backup dump SEGAR sudah dibuat (pembungkus
-- scripts/audit/cleanup-fixture-residue.sh melakukannya otomatis dan
-- membatalkan bila backup gagal). Skrip ini sendiri berjalan dalam
-- SATU transaksi: gagal di tengah = tidak ada yang terhapus.
--
-- session_replication_role = replica dipakai di dalam transaksi agar
-- penghapusan lintas 97 tabel tidak terhalang urutan FK antar-tabel
-- tenant dan trigger append-only audit_log (baris audit perusahaan
-- MATI memang bagian dari residu yang dibersihkan; perusahaan hidup
-- tidak tersentuh sama sekali). Pola yang sama dipakai helper
-- teardown test (tests/helpers/wipe-company.ts).
-- =====================================================================

BEGIN;

-- Penjaga: tabel organization kosong berarti ada yang sangat salah —
-- kriteria NOT IN akan menganggap SEMUA perusahaan sebagai residu.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM organization) THEN
    RAISE EXCEPTION 'cleanup DIBATALKAN: tabel organization kosong';
  END IF;
END $$;

SET session_replication_role = replica;

-- Ringkasan sebelum, penghapusan per tabel, ringkasan sesudah.
DO $$
DECLARE
  r record;
  n bigint;
  total_before bigint := 0;
  total_deleted bigint := 0;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'company_id'
     ORDER BY table_name
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE company_id NOT IN (SELECT id FROM organization)',
      r.table_name) INTO n;
    total_before := total_before + n;
    IF n > 0 THEN
      EXECUTE format(
        'DELETE FROM %I WHERE company_id NOT IN (SELECT id FROM organization)',
        r.table_name);
      GET DIAGNOSTICS n = ROW_COUNT;
      total_deleted := total_deleted + n;
      RAISE NOTICE 'hapus %: % baris', r.table_name, n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL residu sebelum: % | terhapus: %', total_before, total_deleted;
END $$;

-- Baris keanggotaan/undangan milik organisasi yang sudah tidak ada.
DELETE FROM member
 WHERE organization_id NOT IN (SELECT id FROM organization);
DELETE FROM invitation
 WHERE organization_id NOT IN (SELECT id FROM organization);

-- Verifikasi akhir di dalam transaksi yang sama: harus 0.
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'company_id'
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %I WHERE company_id NOT IN (SELECT id FROM organization)',
      r.table_name) INTO n;
    total := total + n;
  END LOOP;
  IF total <> 0 THEN
    RAISE EXCEPTION 'cleanup GAGAL: masih ada % baris residu', total;
  END IF;
  RAISE NOTICE 'VERIFIKASI: residu perusahaan mati = 0';
END $$;

COMMIT;
