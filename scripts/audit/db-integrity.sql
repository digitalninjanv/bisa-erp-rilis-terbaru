-- =====================================================================
-- Audit integritas DB Bisa ERP (Program Audit Produksi A0, 2026-11-08)
-- BACA-SAJA: hanya SELECT. Jalankan sebagai pemilik skema (DIRECT_URL):
--   set -a; . ./.env.local; set +a
--   psql "$DIRECT_URL" -f scripts/audit/db-integrity.sql
-- Setiap blok mengeluarkan satu baris: nama cek | jumlah pelanggaran.
-- Jumlah 0 = lulus. Blok rincian (R*) hanya informatif.
-- =====================================================================
\pset pager off
\set QUIET on

-- ---------- A. Jurnal & akuntansi ----------
-- A1: jurnal POSTED tidak seimbang (Σdebit <> Σkredit)
SELECT 'A1 jurnal posted tak seimbang' AS cek, count(*) AS jumlah FROM (
  SELECT je.id FROM journal_entries je
  JOIN journal_lines jl ON jl.entry_id = je.id
  WHERE je.status = 'posted'
  GROUP BY je.id HAVING sum(jl.debit) <> sum(jl.credit)
) x;

-- A2: jurnal posted tanpa baris sama sekali
SELECT 'A2 jurnal posted tanpa baris' AS cek, count(*) AS jumlah
FROM journal_entries je
WHERE je.status = 'posted'
  AND NOT EXISTS (SELECT 1 FROM journal_lines jl WHERE jl.entry_id = je.id);

-- A3: baris jurnal yang company_id-nya berbeda dari header jurnal
SELECT 'A3 baris jurnal beda perusahaan dgn header' AS cek, count(*) AS jumlah
FROM journal_lines jl JOIN journal_entries je ON je.id = jl.entry_id
WHERE jl.company_id <> je.company_id;

-- A4: baris jurnal menunjuk akun milik perusahaan lain
SELECT 'A4 baris jurnal ke akun perusahaan lain' AS cek, count(*) AS jumlah
FROM journal_lines jl JOIN accounts a ON a.id = jl.account_id
WHERE a.company_id <> jl.company_id;

-- A5: jurnal posted dengan total nol (indikasi jurnal kosong terselubung)
SELECT 'A5 jurnal posted total nol' AS cek, count(*) AS jumlah FROM (
  SELECT je.id FROM journal_entries je
  JOIN journal_lines jl ON jl.entry_id = je.id
  WHERE je.status = 'posted'
  GROUP BY je.id HAVING sum(jl.debit) = 0 AND sum(jl.credit) = 0
) x;

-- ---------- B. Stok ----------
-- B1: stock_on_hand != Σ stock_movements (per perusahaan/gudang/produk).
-- Catatan: stock_movements TIDAK punya kolom status (append-only murni);
-- koreksi adalah movement pembalik, jadi seluruh baris dijumlahkan.
SELECT 'B1 on_hand != jumlah movements' AS cek, count(*) AS jumlah FROM (
  SELECT soh.company_id, soh.warehouse_id, soh.product_id
  FROM stock_on_hand soh
  LEFT JOIN (
    SELECT company_id, warehouse_id, product_id, sum(qty) AS total
    FROM stock_movements
    GROUP BY company_id, warehouse_id, product_id
  ) m ON m.company_id = soh.company_id AND m.warehouse_id = soh.warehouse_id
     AND m.product_id = soh.product_id
  WHERE soh.qty <> coalesce(m.total, 0)
) x;

-- B2: movements tanpa baris stock_on_hand padan (dan total <> 0)
SELECT 'B2 movements tanpa on_hand (total<>0)' AS cek, count(*) AS jumlah FROM (
  SELECT m.company_id, m.warehouse_id, m.product_id
  FROM (
    SELECT company_id, warehouse_id, product_id, sum(qty) AS total
    FROM stock_movements
    GROUP BY company_id, warehouse_id, product_id
  ) m
  LEFT JOIN stock_on_hand soh ON soh.company_id = m.company_id
    AND soh.warehouse_id = m.warehouse_id AND soh.product_id = m.product_id
  WHERE soh.product_id IS NULL AND m.total <> 0
) x;

-- B3: stok negatif di stock_on_hand
SELECT 'B3 baris stock_on_hand negatif' AS cek, count(*) AS jumlah
FROM stock_on_hand WHERE qty < 0;

-- B4: stok negatif hasil penjumlahan movements
SELECT 'B4 jumlah movements per gudang/produk negatif' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, warehouse_id, product_id FROM stock_movements
  GROUP BY company_id, warehouse_id, product_id HAVING sum(qty) < 0
) x;

-- ---------- C. Master data & duplikasi ----------
-- C1: barcode produk duplikat dalam satu perusahaan
SELECT 'C1 barcode produk duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, barcode FROM products
  WHERE barcode IS NOT NULL AND barcode <> ''
  GROUP BY company_id, barcode HAVING count(*) > 1
) x;

-- C2: SKU duplikat dalam satu perusahaan
SELECT 'C2 SKU duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, sku FROM products
  WHERE sku IS NOT NULL AND sku <> ''
  GROUP BY company_id, sku HAVING count(*) > 1
) x;

-- C3: barcode kemasan duplikat dalam satu perusahaan
SELECT 'C3 barcode kemasan duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, barcode FROM product_packagings
  WHERE barcode IS NOT NULL AND barcode <> ''
  GROUP BY company_id, barcode HAVING count(*) > 1
) x;

-- C4: tabrakan barcode produk <-> kemasan dalam satu perusahaan (satu ruang nama)
SELECT 'C4 barcode produk == barcode kemasan (perusahaan sama)' AS cek, count(*) AS jumlah
FROM products p JOIN product_packagings pp
  ON pp.company_id = p.company_id AND pp.barcode = p.barcode
WHERE p.barcode IS NOT NULL AND p.barcode <> '';

-- C5: kunci idempotensi penjualan duplikat (penjualan non-void)
SELECT 'C5 idempotency_key penjualan duplikat' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, idempotency_key FROM sales
  WHERE idempotency_key IS NOT NULL AND status <> 'void'
  GROUP BY company_id, idempotency_key HAVING count(*) > 1
) x;

-- C6: nomor dokumen duplikat per perusahaan (per tabel dokumen inti)
SELECT 'C6 nomor jurnal duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, number FROM journal_entries
  GROUP BY company_id, number HAVING count(*) > 1
) x;
SELECT 'C6b nomor penjualan duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, number FROM sales
  GROUP BY company_id, number HAVING count(*) > 1
) x;
SELECT 'C6c nomor PO duplikat per perusahaan' AS cek, count(*) AS jumlah FROM (
  SELECT company_id, number FROM purchase_orders
  GROUP BY company_id, number HAVING count(*) > 1
) x;

-- ---------- D. Yatim FK (dinamis, semua FK satu kolom di skema public) ----
CREATE TEMP TABLE _fk_orphans (constraint_name text, child_table text, orphans bigint);
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN
    SELECT tc.constraint_name, kcu.table_name AS child_table,
           kcu.column_name AS child_col, ccu.table_name AS parent_table,
           ccu.column_name AS parent_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      AND (SELECT count(*) FROM information_schema.key_column_usage k2
           WHERE k2.constraint_name = tc.constraint_name AND k2.table_schema = tc.table_schema) = 1
  LOOP
    EXECUTE format('SELECT count(*) FROM %I c WHERE c.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %I p WHERE p.%I = c.%I)',
                   r.child_table, r.child_col, r.parent_table, r.parent_col, r.child_col)
      INTO n;
    IF n > 0 THEN
      INSERT INTO _fk_orphans VALUES (r.constraint_name, r.child_table, n);
    END IF;
  END LOOP;
END $$;
SELECT 'D1 total FK dgn baris yatim' AS cek, count(*) AS jumlah FROM _fk_orphans;
SELECT 'R-D rincian FK yatim' AS cek, constraint_name || ' @ ' || child_table || ' = ' || orphans AS jumlah
FROM _fk_orphans ORDER BY orphans DESC;

-- ---------- E. RLS pada tabel bertenant ----------
SELECT 'E1 tabel ber-company_id tanpa RLS aktif' AS cek, count(*) AS jumlah
FROM information_schema.columns c
JOIN pg_class pc ON pc.relname = c.table_name
JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = 'public'
WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
  AND pc.relrowsecurity = false;

SELECT 'E2 tabel ber-company_id tanpa kebijakan RLS' AS cek, count(*) AS jumlah
FROM information_schema.columns c
WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
  AND c.table_name NOT IN (SELECT tablename FROM pg_policies WHERE schemaname = 'public');

-- ---------- F. Migrasi ----------
SELECT 'F1 baris __drizzle_migrations' AS cek, count(*) AS jumlah
FROM drizzle.__drizzle_migrations;

-- ---------- G. Terlingkup tenant HIDUP (organization yang masih ada) ----
-- DB dev bersama menampung residu perusahaan fixture yang organisasinya
-- sudah dihapus teardown test; cek global (A-D) menghitung residu itu.
-- Cek G menilai integritas tenant yang benar-benar hidup saja.
SELECT 'G1 B1 terlingkup tenant hidup' AS cek, count(*) AS jumlah FROM (
  SELECT soh.company_id, soh.warehouse_id, soh.product_id
  FROM stock_on_hand soh
  LEFT JOIN (
    SELECT company_id, warehouse_id, product_id, sum(qty) AS total
    FROM stock_movements GROUP BY company_id, warehouse_id, product_id
  ) m ON m.company_id = soh.company_id AND m.warehouse_id = soh.warehouse_id
     AND m.product_id = soh.product_id
  WHERE soh.qty <> coalesce(m.total, 0)
    AND soh.company_id IN (SELECT id FROM organization)
) x;

SELECT 'G2 amb yatim terlingkup tenant hidup' AS cek, count(*) AS jumlah
FROM account_monthly_balances amb
WHERE amb.company_id IN (SELECT id FROM organization)
  AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = amb.account_id);

SELECT 'G3 employee_history yatim terlingkup tenant hidup' AS cek, count(*) AS jumlah
FROM employee_history eh
WHERE eh.company_id IN (SELECT id FROM organization)
  AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = eh.employee_id);

-- G4: total baris residu milik perusahaan yang organisasinya sudah tidak
-- ada, dihitung dinamis atas semua tabel ber-company_id.
CREATE TEMP TABLE IF NOT EXISTS _residu (tbl text, dead bigint);
TRUNCATE _residu;
DO $$
DECLARE r record; n bigint;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'public' AND column_name = 'company_id' LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE company_id NOT IN (SELECT id FROM organization)', r.table_name) INTO n;
    IF n > 0 THEN INSERT INTO _residu VALUES (r.table_name, n); END IF;
  END LOOP;
END $$;
SELECT 'G4 total baris residu perusahaan mati' AS cek, coalesce(sum(dead), 0) AS jumlah FROM _residu;
SELECT 'R-G rincian residu per tabel' AS cek, tbl || ' = ' || dead AS jumlah FROM _residu ORDER BY dead DESC;

-- ---------- R. Rincian informatif ----------
SELECT 'R1 jumlah perusahaan (organization)' AS cek, count(*) AS jumlah FROM organization;
SELECT 'R2 total baris per tabel inti' AS cek,
  (SELECT count(*) FROM sales) + (SELECT count(*) FROM journal_entries) +
  (SELECT count(*) FROM stock_movements) + (SELECT count(*) FROM products) AS jumlah;
