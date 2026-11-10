CREATE TABLE "account_monthly_balances" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"company_id" text NOT NULL,
	"account_id" uuid NOT NULL,
	"year_month" text NOT NULL,
	"total_debit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"total_credit" numeric(19, 4) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_monthly_balances" ADD CONSTRAINT "account_monthly_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_monthly_balances_company_account_month_uq" ON "account_monthly_balances" USING btree ("company_id","account_id","year_month");--> statement-breakpoint
CREATE INDEX "account_monthly_balances_company_month_idx" ON "account_monthly_balances" USING btree ("company_id","year_month");--> statement-breakpoint
-- FIX-ARS Tahap 2 (ARS3-01) manual additions, same file by design
-- (pattern of 0027/0033/0038): tenant RLS + grant for the new table.
ALTER TABLE "account_monthly_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_monthly_balances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "account_monthly_balances"
  USING (company_id = app_company_id())
  WITH CHECK (company_id = app_company_id());--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_monthly_balances" TO app_user;--> statement-breakpoint
-- Backfill: isi ringkasan dari seluruh jurnal POSTED yang sudah ada,
-- diagregat per (company, account, bulan tanggal jurnal). Sesudah
-- migrasi ini ringkasan identik dengan agregat mentah journal_lines
-- untuk data lama; baris berikutnya dipelihara postJournal.
INSERT INTO "account_monthly_balances" ("company_id", "account_id", "year_month", "total_debit", "total_credit")
SELECT jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM'), sum(jl."debit"), sum(jl."credit")
FROM "journal_lines" jl
INNER JOIN "journal_entries" je ON je."id" = jl."entry_id"
WHERE je."status" = 'posted'
GROUP BY jl."company_id", jl."account_id", to_char(je."date", 'YYYY-MM')
ON CONFLICT ("company_id", "account_id", "year_month") DO UPDATE SET
  "total_debit" = EXCLUDED."total_debit",
  "total_credit" = EXCLUDED."total_credit";