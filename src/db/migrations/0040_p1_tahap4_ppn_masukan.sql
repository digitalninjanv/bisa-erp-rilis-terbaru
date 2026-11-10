-- FIX-P1 Tahap 4 (AK1-06/AK4-04): PPN Masukan nyata untuk perusahaan PKP.
-- 1) Kolom pajak pada penerimaan, beban, dan retur pemasok. Semua
--    berkawanan default 0 sehingga dokumen lama tidak berubah makna:
--    total/amount tetap bruto, tax_amount 0 = tidak ada PPN dipisah.
ALTER TABLE "stock_receipts" ADD COLUMN "tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_receipts" ADD COLUMN "tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_rate" numeric(7, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_returns" ADD COLUMN "tax_amount" numeric(19, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
-- 2) Akun bawaan 1180 "PPN Masukan" (aset, saldo normal debit) untuk
--    setiap perusahaan yang belum memakai kode 1180. Bila kode 1180
--    sudah dipakai akun lain, akun tidak dibuat dan pemetaan tidak
--    ditanam — perusahaan itu memetakan `tax_input` sendiri lewat
--    Pengaturan (sudah dimungkinkan perbaikan AK1-03 tahap ini).
INSERT INTO "accounts" ("company_id", "code", "name", "type", "normal_balance")
SELECT o."id", '1180', 'PPN Masukan', 'asset', 'debit'
FROM "organization" o
WHERE NOT EXISTS (
  SELECT 1 FROM "accounts" a
  WHERE a."company_id" = o."id" AND a."code" = '1180'
);--> statement-breakpoint
-- 3) Pemetaan `tax_input` → akun 1180 "PPN Masukan" perusahaan itu
--    sendiri, hanya bila pemetaan belum ada (tidak pernah menimpa
--    pilihan perusahaan).
INSERT INTO "account_mappings" ("company_id", "key", "account_id")
SELECT a."company_id", 'tax_input', a."id"
FROM "accounts" a
WHERE a."code" = '1180' AND a."name" = 'PPN Masukan'
ON CONFLICT ("company_id", "key") DO NOTHING;
