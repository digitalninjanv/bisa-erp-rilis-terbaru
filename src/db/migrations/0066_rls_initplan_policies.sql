-- ------------------------------------------------------------------
-- R3 K-1 (Program Rekayasa): kebijakan RLS `tenant_isolation` ke
-- bentuk InitPlan: company_id = (select app_company_id()).
--
-- Ekuivalensi semantik: app_company_id() adalah fungsi SQL STABLE
-- atas current_setting('app.company_id', true) (migrasi 0001). Nilai
-- GUC ditetapkan sekali per transaksi oleh set_config(..., is_local)
-- di src/db/tenant.ts dan tidak dapat berubah di tengah satu
-- pernyataan; fungsi tak berefek samping. Menilai sekali (InitPlan)
-- setara menilai per baris untuk USING maupun WITH CHECK — yang
-- berubah hanya strategi planner: kualifikasi konstan membuat
-- indeks komposit (company_id, date) dapat dipakai pada tabel yang
-- pembatasan tenant-nya datang HANYA dari RLS (terukur R1 pada
-- agregasi jurnal pola cumulativeAccountTotals: 14,81 -> 5,21 ms;
-- 5 kueri lain netral).
--
-- Cakupan PERSIS 97 kebijakan tenant_isolation di skema public
-- (inventaris R2 dari pg_policies). 2 kebijakan digest migrasi 0060
-- (device_digest_lookup di pos_terminals, pairing_digest_lookup di
-- pos_pairing_codes) BUKAN cakupan — berbasis app.device_digest dan
-- ditegaskan utuh di akhir blok. ENABLE/FORCE RLS adalah properti
-- tabel, tidak disentuh. Rollback: migrasi kompensasi yang menulis
-- kembali bentuk telanjang (pola 0001), bukan mengedit berkas ini.
-- ------------------------------------------------------------------

DO $$
DECLARE
  t text;
  n_before integer;
  n_wrapped integer;
BEGIN
  SELECT count(*) INTO n_before
  FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'tenant_isolation';
  IF n_before <> 97 THEN
    RAISE EXCEPTION 'K-1: diharapkan 97 kebijakan tenant_isolation, ditemukan % — migrasi dibatalkan', n_before;
  END IF;

  FOR t IN
    SELECT tablename
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname = 'tenant_isolation'
    ORDER BY tablename
  LOOP
    EXECUTE format('DROP POLICY tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (company_id = (select app_company_id())) WITH CHECK (company_id = (select app_company_id()))',
      t
    );
  END LOOP;

  -- Bentuk teks qual/with_check sesudah deparse PG 18 (tertangkap
  -- empiris): "(company_id = ( SELECT app_company_id() AS app_company_id))".
  SELECT count(*) INTO n_wrapped
  FROM pg_policies
  WHERE schemaname = 'public'
    AND policyname = 'tenant_isolation'
    AND qual = '(company_id = ( SELECT app_company_id() AS app_company_id))'
    AND with_check = '(company_id = ( SELECT app_company_id() AS app_company_id))';
  IF n_wrapped <> 97 THEN
    RAISE EXCEPTION 'K-1: hanya % dari 97 kebijakan berbentuk terbungkus sesudah penulisan — migrasi dibatalkan', n_wrapped;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pos_terminals'
      AND policyname = 'device_digest_lookup'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'pos_pairing_codes'
      AND policyname = 'pairing_digest_lookup'
  ) THEN
    RAISE EXCEPTION 'K-1: kebijakan digest migrasi 0060 hilang — migrasi dibatalkan';
  END IF;
END $$;
